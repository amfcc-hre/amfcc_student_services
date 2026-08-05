create or replace function public._gate_pass_people_json(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'student_id',s.id,
    'student_name',s.full_name,
    'registration_number',s.registration_number,
    'is_primary',gm.is_primary,
    'actual_departure_at',gm.actual_departure_at,
    'actual_return_at',gm.actual_return_at
  ) order by gm.is_primary desc,s.full_name),'[]'::jsonb)
  from public.gate_pass_members gm
  join public.students s on s.id=gm.student_id
  where gm.pass_id=p_pass_id;
$$;

revoke execute on function public._gate_pass_people_json(uuid) from public;

create or replace function public.student_services_dashboard_v3(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_students jsonb;
  v_passes jsonb;
  v_counts jsonb;
begin
  v_result:=public.student_services_dashboard_v2(p_pin);
  if coalesce(v_result->>'status','')<>'success' then return v_result; end if;

  select coalesce(jsonb_agg(
    (student_item - 'bed_rest_notes' - 'bed_rest_started_at' - 'maternity') ||
    coalesce((
      select jsonb_build_object(
        'outing_type',case
          when cm.gate_pass_id is not null then 'gate_pass'
          when cm.checkout_destination_code='1' then 'tanaka'
          when cm.checkout_destination_code='2' then 'mdh'
          when cm.checkout_destination_code='3' then 'town_other'
          when cm.checkout_destination_code='4' then 'holiday'
          else null
        end,
        'outing_label',cm.checkout_destination_label,
        'current_gate_pass_id',cm.gate_pass_id
      )
      from public.campus_movements cm
      where cm.student_id=student_item->>'student_id'
      order by cm.scanned_at desc,cm.id desc
      limit 1
    ),jsonb_build_object('outing_type',null,'outing_label',null,'current_gate_pass_id',null))
    order by student_item->>'student_name'
  ),'[]'::jsonb)
  into v_students
  from jsonb_array_elements(coalesce(v_result->'students','[]'::jsonb)) student_item;

  select coalesce(jsonb_agg(
    pass_item || jsonb_build_object(
      'people',public._gate_pass_people_json((pass_item->>'id')::uuid)
    ) order by (pass_item->>'submitted_at')::timestamptz desc
  ),'[]'::jsonb)
  into v_passes
  from jsonb_array_elements(coalesce(v_result->'gate_passes','[]'::jsonb)) pass_item;

  v_counts:=coalesce(v_result->'counts','{}'::jsonb)-'maternity';

  v_result:=jsonb_set(v_result,'{students}',v_students,true);
  v_result:=jsonb_set(v_result,'{gate_passes}',v_passes,true);
  v_result:=jsonb_set(v_result,'{counts}',v_counts,true);

  return v_result || jsonb_build_object(
    'medical_visibility','bed_rest_permission_only',
    'can_view_pass_details',true
  );
end;
$$;

create or replace function public.admin_services_dashboard_v2(p_pin text,p_term_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_passes jsonb;
begin
  v_result:=public.admin_services_dashboard(p_pin,p_term_id);
  if coalesce(v_result->>'status','')<>'success' then return v_result; end if;

  select coalesce(jsonb_agg(
    pass_item || jsonb_build_object(
      'people',public._gate_pass_people_json((pass_item->>'id')::uuid)
    ) order by (pass_item->>'submitted_at')::timestamptz desc
  ),'[]'::jsonb)
  into v_passes
  from jsonb_array_elements(coalesce(v_result->'gate_passes','[]'::jsonb)) pass_item;

  v_result:=jsonb_set(v_result,'{gate_passes}',v_passes,true);
  return v_result || jsonb_build_object(
    'current_academic_year',public._current_academic_year(),
    'medical_visibility','admin_full'
  );
end;
$$;

create or replace function public.dashboard_gate_pass_review_details(p_pin text,p_pass_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_auth jsonb;
  v_access text;
  v_pass public.gate_passes%rowtype;
  v_student public.students%rowtype;
  v_approvals jsonb;
begin
  v_auth:=public.student_services_dashboard_v3(p_pin);
  if coalesce(v_auth->>'status','')<>'success' then
    return jsonb_build_object('status','unauthorized','message','Management or Student Leadership password required.');
  end if;
  v_access:=v_auth->>'access_level';

  select * into v_pass from public.gate_passes where id=p_pass_id;
  if not found then return jsonb_build_object('status','not_found','message','Gate pass not found.'); end if;
  select * into v_student from public.students where id=v_pass.student_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'role',a.approver_role,'decision',a.decision,'comments',a.comments,'decided_at',a.decided_at
  ) order by a.decided_at),'[]'::jsonb)
  into v_approvals
  from public.gate_pass_approvals a where a.pass_id=p_pass_id;

  return jsonb_build_object(
    'status','success','access_level',v_access,'can_decide',(v_access='management'),
    'pass',jsonb_build_object(
      'id',v_pass.id,'student_name',v_student.full_name,
      'registration_number',v_student.registration_number,
      'destination',v_pass.destination,'reason',v_pass.reason,
      'contact_details',case when v_access='management' then v_pass.contact_details else null end,
      'departure_at',v_pass.departure_at,'expected_return_at',v_pass.expected_return_at,
      'status',v_pass.status,'people',public._gate_pass_people_json(v_pass.id),
      'approvals',v_approvals
    )
  );
end;
$$;

create or replace function public.dashboard_update_student_campus_status_v2(
  p_pin text,
  p_registration_number text,
  p_direction text,
  p_outing_type text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_auth jsonb;
  v_access text;
  v_student public.students%rowtype;
  v_device_id uuid;
  v_direction text:=upper(trim(coalesce(p_direction,'')));
  v_outing text:=lower(trim(coalesce(p_outing_type,'')));
  v_last public.campus_movements%rowtype;
  v_code text;
  v_label text;
  v_pass_id uuid;
  v_pass_status text;
  v_pass_destination text;
  v_member_id bigint;
  v_all_returned boolean;
begin
  v_auth:=public.student_services_dashboard_v3(p_pin);
  if coalesce(v_auth->>'status','')<>'success' then
    return jsonb_build_object('status','unauthorized','message','Incorrect password.');
  end if;
  v_access:=v_auth->>'access_level';

  if v_direction not in ('IN','OUT') then
    return jsonb_build_object('status','invalid','message','Choose On Campus or Off Campus.');
  end if;
  if v_outing not in ('','gate_pass','tanaka','mdh','town_other','holiday') then
    return jsonb_build_object('status','invalid','message','Choose a valid outing type.');
  end if;

  select * into v_student from public.students
  where registration_number::text=regexp_replace(coalesce(p_registration_number,''),'\D','','g')
    and is_active=true limit 1;
  if not found then return jsonb_build_object('status','not_found','message','Student not found.'); end if;

  select id into v_device_id from public.gate_devices where is_active=true order by created_at nulls last limit 1;
  if v_device_id is null then return jsonb_build_object('status','configuration_error','message','No active gate device is configured.'); end if;

  select * into v_last from public.campus_movements
  where student_id=v_student.id order by scanned_at desc,id desc limit 1;

  if v_direction='IN' then
    if found and v_last.direction='IN' then
      return jsonb_build_object('status','same_status','message','Student is already marked on campus.',
        'student_name',v_student.full_name,'registration_number',v_student.registration_number,'direction','IN');
    end if;

    select p.id,p.status,gm.id into v_pass_id,v_pass_status,v_member_id
    from public.gate_passes p
    join public.gate_pass_members gm on gm.pass_id=p.id
    where gm.student_id=v_student.id
      and gm.actual_departure_at is not null and gm.actual_return_at is null
    order by gm.actual_departure_at desc limit 1
    for update of p,gm;

    if found then
      update public.gate_pass_members set actual_return_at=now(),updated_at=now() where id=v_member_id;
      select not exists(
        select 1 from public.gate_pass_members
        where pass_id=v_pass_id and actual_departure_at is not null and actual_return_at is null
      ) into v_all_returned;
      if v_all_returned then
        update public.gate_passes set status='returned',actual_return_at=now(),updated_at=now() where id=v_pass_id;
        if v_pass_status<>'returned' then
          insert into public.gate_pass_status_history(pass_id,previous_status,new_status,actor_role,notes)
          values(v_pass_id,v_pass_status,'returned',v_access,'Campus return corrected from dashboard.');
        end if;
      end if;
    end if;
  else
    v_code:=case v_outing when 'gate_pass' then 'PASS' when 'tanaka' then '1' when 'mdh' then '2' when 'town_other' then '3' when 'holiday' then '4' else null end;
    v_label:=case v_outing when 'tanaka' then 'Tanaka/Amalinda Shops' when 'mdh' then 'MDH' when 'town_other' then 'Town/Other' when 'holiday' then 'Holiday' else null end;

    if v_outing='gate_pass' then
      select p.id,p.status,p.destination,gm.id
      into v_pass_id,v_pass_status,v_pass_destination,v_member_id
      from public.gate_passes p
      join public.gate_pass_members gm on gm.pass_id=p.id
      where gm.student_id=v_student.id
        and p.status in ('approved','departed')
        and p.expected_return_at>now()
        and p.departure_at<=now()+interval '24 hours'
      order by case when p.status='departed' then 0 else 1 end,
        abs(extract(epoch from (p.departure_at-now())))
      limit 1 for update of p,gm;

      if not found then
        return jsonb_build_object('status','no_gate_pass','message','No active approved gate pass was found for this student.');
      end if;

      v_label:='Gate pass — '||v_pass_destination;
      update public.gate_pass_members
      set actual_departure_at=coalesce(actual_departure_at,now()),actual_return_at=null,updated_at=now()
      where id=v_member_id;
      update public.gate_passes
      set status='departed',actual_departure_at=coalesce(actual_departure_at,now()),actual_return_at=null,updated_at=now()
      where id=v_pass_id;
      if v_pass_status<>'departed' then
        insert into public.gate_pass_status_history(pass_id,previous_status,new_status,actor_role,notes)
        values(v_pass_id,v_pass_status,'departed',v_access,'Outing type changed to Gate pass from dashboard.');
      end if;
    end if;

    if v_last.id is not null and v_last.direction='OUT'
       and coalesce(v_last.checkout_destination_code,'')=coalesce(v_code,'')
       and coalesce(v_last.gate_pass_id::text,'')=coalesce(v_pass_id::text,'') then
      return jsonb_build_object('status','same_status','message','Student is already marked off campus with this outing type.',
        'student_name',v_student.full_name,'registration_number',v_student.registration_number,
        'direction','OUT','outing_type',nullif(v_outing,''),'outing_label',v_label,'gate_pass_id',v_pass_id);
    end if;
  end if;

  insert into public.campus_movements(
    student_id,direction,gate_device_id,movement_source,corrected_by,correction_note,
    gate_pass_id,checkout_destination_code,checkout_destination_label
  ) values(
    v_student.id,v_direction,v_device_id,'administrative_update',v_access,
    coalesce(nullif(trim(coalesce(p_note,'')),''),'Campus status updated from a dashboard.'),
    v_pass_id,case when v_direction='OUT' then v_code else null end,
    case when v_direction='OUT' then v_label else null end
  );

  insert into public.audit_log(event_type,entity_type,entity_id,actor_role,action,details)
  values('campus_status','student',v_student.id,v_access,
    case when v_direction='IN' then 'marked_on_campus' else 'marked_off_campus' end,
    jsonb_build_object('registration_number',v_student.registration_number,'note',p_note,
      'outing_type',nullif(v_outing,''),'outing_label',v_label,'gate_pass_id',v_pass_id));

  return jsonb_build_object('status','success',
    'message',case when v_direction='IN' then 'Student marked on campus.' else 'Student marked off campus.' end,
    'student_name',v_student.full_name,'registration_number',v_student.registration_number,
    'direction',v_direction,'access_level',v_access,'outing_type',nullif(v_outing,''),
    'outing_label',v_label,'gate_pass_id',v_pass_id);
end;
$$;

create or replace function public.student_movements_export_v2(p_pin text,p_period text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admin_auth jsonb;
  v_dashboard_auth jsonb;
  v_result jsonb;
  v_rows jsonb;
  v_is_admin boolean:=false;
begin
  v_admin_auth:=public.admin_services_dashboard(p_pin,null);
  if coalesce(v_admin_auth->>'status','')='success' then
    v_is_admin:=true;
  else
    v_dashboard_auth:=public.student_services_dashboard_v3(p_pin);
    if coalesce(v_dashboard_auth->>'status','')<>'success' then
      return jsonb_build_object('status','unauthorized','message','Incorrect password.');
    end if;
  end if;

  v_result:=public.student_movements_export(p_pin,p_period);
  if coalesce(v_result->>'status','')<>'success' then return v_result; end if;

  if not v_is_admin then
    select coalesce(jsonb_agg(row_item-'maternity'-'bed_rest_started_at'),'[]'::jsonb)
    into v_rows from jsonb_array_elements(coalesce(v_result->'rows','[]'::jsonb)) row_item;
    v_result:=jsonb_set(v_result,'{rows}',v_rows,true);
    v_result:=v_result || jsonb_build_object('medical_visibility','bed_rest_permission_only');
  else
    v_result:=v_result || jsonb_build_object('medical_visibility','admin_full');
  end if;

  return v_result;
end;
$$;

grant execute on function public.student_services_dashboard_v3(text) to anon,authenticated;
grant execute on function public.admin_services_dashboard_v2(text,bigint) to anon,authenticated;
grant execute on function public.dashboard_gate_pass_review_details(text,uuid) to anon,authenticated;
grant execute on function public.dashboard_update_student_campus_status_v2(text,text,text,text,text) to anon,authenticated;
grant execute on function public.student_movements_export_v2(text,text) to anon,authenticated;
