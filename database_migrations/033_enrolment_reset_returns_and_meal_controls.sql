-- Reset term-enrolment submissions, allow Admin Office returns, and add meal feature controls.

alter table public.term_registrations
  drop constraint if exists term_registrations_status_check;

alter table public.term_registrations
  add constraint term_registrations_status_check check (status in (
    'not_started','started','returned','student_submitted','waiting_accommodation','ready_final','completed'
  ));

create or replace function private.tr_default_form_schema()
returns jsonb
language sql immutable
set search_path='pg_catalog'
as $function$
select jsonb_build_object(
  'configured',true,
  'student',jsonb_build_array(
    jsonb_build_object('id','gender','label','Gender','type','select','required',true,'options',jsonb_build_array('Male','Female')),
    jsonb_build_object('id','marital_status','label','Marital status','type','select','required',true,'options',jsonb_build_array('Single','Married','Widowed','Divorced')),
    jsonb_build_object('id','spouse_location','label','If married, where is your spouse?','type','text','required',false,'show_when',jsonb_build_object('field','marital_status','equals','Married')),
    jsonb_build_object('id','identity_number','label','ID number / passport number','type','text','required',true),
    jsonb_build_object('id','student_email','label','Student email','type','email','required',true),
    jsonb_build_object('id','student_phone','label','Student phone number','type','tel','required',true),
    jsonb_build_object('id','sponsor_name','label','Sponsor name','type','text','required',false),
    jsonb_build_object('id','sponsor_contact','label','Sponsor contact number','type','tel','required',false),
    jsonb_build_object('id','accommodation_type','label','Type of accommodation','type','select','required',false,'options',jsonb_build_array('Shared','Married')),
    jsonb_build_object('id','accommodation_hostel','label','Hostel allocated','type','text','required',false,'show_when',jsonb_build_object('field','accommodation_type','equals','Shared')),
    jsonb_build_object('id','accommodation_room','label','Room number','type','text','required',false,'show_when',jsonb_build_object('field','accommodation_type','equals','Shared')),
    jsonb_build_object('id','shared_occupants','label','Number of occupants in room','type','number','required',false,'show_when',jsonb_build_object('field','accommodation_type','equals','Shared'))
  ),
  'admin',jsonb_build_array(
    jsonb_build_object('id','official_date_of_arrival','label','Official date of arrival','type','date','required',true)
  ),
  'fees',jsonb_build_array(
    jsonb_build_object('id','arrears_previous_terms','label','Arrears from previous term(s)','type','number','required',true),
    jsonb_build_object('id','amount_paid_current_term','label','Amount paid for the current term','type','number','required',true),
    jsonb_build_object('id','outstanding_balance','label','Outstanding balance','type','number','required',true),
    jsonb_build_object('id','payment_plan','label','Payment plan','type','textarea','required',false),
    jsonb_build_object('id','fees_certified_by','label','Fees certified by','type','text','required',true)
  ),
  'accommodation',jsonb_build_array(
    jsonb_build_object('id','accommodation_type','label','Type of accommodation','type','select','required',true,'options',jsonb_build_array('Shared','Married')),
    jsonb_build_object('id','accommodation_hostel','label','Hostel allocated','type','text','required',false),
    jsonb_build_object('id','accommodation_room','label','Room number','type','text','required',false),
    jsonb_build_object('id','shared_occupants','label','Number of occupants in room','type','number','required',false),
    jsonb_build_object('id','accommodation_certified_by','label','Accommodation certified by','type','text','required',true)
  ),
  'final',jsonb_build_array(
    jsonb_build_object('id','principal_signature','label','Principal / authorised signatory','type','text','required',false)
  )
)
$function$;

update public.academic_terms
set registration_form_schema=private.tr_default_form_schema(),updated_at=now();

create or replace function private.tr_status_label(p_status text)
returns text
language sql immutable security definer
set search_path='pg_catalog'
as $function$
select case p_status
  when 'not_started' then 'Not started'
  when 'started' then 'Started'
  when 'returned' then 'Additional information requested'
  when 'student_submitted' then 'Waiting for Admin Office'
  when 'waiting_accommodation' then 'Waiting for Accommodation'
  when 'ready_final' then 'Ready for final check'
  when 'completed' then 'Registration complete'
  else 'Not started'
end
$function$;

create or replace function private.tr_student_start(p_registration_number text,p_resume_token text default null)
returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog','extensions'
as $function$
declare
  v_digits text:=regexp_replace(coalesce(p_registration_number,''),'\D','','g');
  v_student public.students%rowtype;
  v_term public.academic_terms%rowtype;
  v_reg public.term_registrations%rowtype;
  v_token text;
begin
  if v_digits!~'^\d{5}$' then return jsonb_build_object('status','invalid','message','Enter your five-digit registration number.'); end if;
  select * into v_student from public.students where registration_number::text=v_digits and is_active=true limit 1;
  if not found then return jsonb_build_object('status','not_found','message','This active student registration number was not found.'); end if;
  select * into v_term from public.academic_terms where registration_is_open=true order by registration_opened_at desc nulls last,id desc limit 1;
  if not found then return jsonb_build_object('status','closed','message','Term registration is not open right now.'); end if;
  select * into v_reg from public.term_registrations where student_id=v_student.id and term_id=v_term.id for update;
  if not found then v_reg:=private.tr_seed_registration(v_student,v_term); end if;
  if v_reg.resume_token_hash is not null then
    if nullif(p_resume_token,'') is null or private.tr_token_hash(p_resume_token)<>v_reg.resume_token_hash then
      return jsonb_build_object('status','resume_token_required','message','This registration was already started on another browser. Please continue on that browser or ask the Admin Office to reset access.','student_name',v_student.full_name,'registration_number',v_student.registration_number,'term_name',v_term.term_name,'status_label',private.tr_status_label(v_reg.status));
    end if;
    return jsonb_build_object('status','success','student_name',v_student.full_name,'registration_number',v_student.registration_number,'term_id',v_term.id,'term_name',v_term.term_name,'form_schema',v_term.registration_form_schema,'student_answers',v_reg.student_answers,'resume_token',p_resume_token,'registration_status',v_reg.status,'status_label',private.tr_status_label(v_reg.status),'is_locked',v_reg.student_locked,'return_reason',v_reg.reopen_reason);
  end if;
  if v_reg.student_locked then
    return jsonb_build_object('status','locked','message','This registration has already been submitted and cannot be changed by the student.','student_name',v_student.full_name,'registration_number',v_student.registration_number,'term_name',v_term.term_name,'status_label',private.tr_status_label(v_reg.status));
  end if;
  v_token:=private.tr_new_token();
  update public.term_registrations set resume_token_hash=private.tr_token_hash(v_token),student_started_at=coalesce(student_started_at,now()),status=case when status='returned' then 'returned' else 'started' end,updated_at=now() where id=v_reg.id returning * into v_reg;
  perform private.tr_write_history(v_reg.id,'student','registration_started','student',null,null,null);
  return jsonb_build_object('status','success','student_name',v_student.full_name,'registration_number',v_student.registration_number,'term_id',v_term.id,'term_name',v_term.term_name,'form_schema',v_term.registration_form_schema,'student_answers',v_reg.student_answers,'resume_token',v_token,'registration_status',v_reg.status,'status_label',private.tr_status_label(v_reg.status),'is_locked',false,'return_reason',v_reg.reopen_reason);
end
$function$;

create or replace function private.tr_student_submit(p_registration_number text,p_resume_token text,p_answers jsonb)
returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_digits text:=regexp_replace(coalesce(p_registration_number,''),'\D','','g');
  v_reg public.term_registrations%rowtype;
  v_term public.academic_terms%rowtype;
  v_filtered jsonb;
  v_missing jsonb;
  v_before jsonb;
  v_status text;
  v_accommodation text;
begin
  select tr.* into v_reg
  from public.term_registrations tr
  join public.students s on s.id=tr.student_id
  join public.academic_terms t on t.id=tr.term_id
  where s.registration_number::text=v_digits and s.is_active and t.registration_is_open
  for update of tr;
  if not found then return jsonb_build_object('status','not_found','message','No open enrolment was found.'); end if;
  if v_reg.resume_token_hash is null or private.tr_token_hash(p_resume_token)<>v_reg.resume_token_hash then
    return jsonb_build_object('status','unauthorized','message','Open this enrolment from the browser where you started it.');
  end if;
  if v_reg.student_locked or v_reg.student_submitted_at is not null then
    return jsonb_build_object('status','locked','message','This enrolment has already been submitted.','status_label',private.tr_status_label(v_reg.status));
  end if;
  select * into v_term from public.academic_terms where id=v_reg.term_id;
  v_filtered:=private.tr_filter_answers(v_term.registration_form_schema->'student',coalesce(p_answers,'{}'::jsonb));
  if coalesce(v_filtered->>'marital_status','')<>'Married' then v_filtered:=v_filtered-'spouse_location'; end if;
  v_accommodation:=coalesce(v_filtered->>'accommodation_type','');
  if v_accommodation<>'Shared' then v_filtered:=v_filtered-'accommodation_hostel'-'accommodation_room'-'shared_occupants'; end if;
  v_missing:=private.tr_missing_required(v_term.registration_form_schema->'student',v_filtered);
  if coalesce(v_filtered->>'marital_status','')='Married' and nullif(btrim(coalesce(v_filtered->>'spouse_location','')),'') is null then
    v_missing:=v_missing||jsonb_build_array(jsonb_build_object('id','spouse_location','label','Where your spouse is'));
  end if;
  if nullif(btrim(coalesce(v_filtered->>'student_email','')),'') is not null
     and v_filtered->>'student_email' !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('status','invalid','message','Enter a valid student email address.');
  end if;
  if jsonb_array_length(v_missing)>0 then
    return jsonb_build_object('status','missing','message','Please complete the required student information.','missing',v_missing);
  end if;
  v_before:=v_reg.student_answers;
  perform private.tr_sync_sponsor(v_reg.student_id,v_reg.term_id,v_filtered->>'sponsor_name',v_filtered->>'sponsor_contact','student');
  update public.term_registrations set
    student_answers=v_filtered,student_submitted_at=now(),student_locked=true,
    accommodation_mode=case when v_accommodation='Shared' then 'on_campus' when v_accommodation='Married' then 'off_campus' else 'unconfirmed' end,
    accommodation_residence=case when v_accommodation='Shared' then nullif(btrim(v_filtered->>'accommodation_hostel'),'') else null end,
    accommodation_room=case when v_accommodation='Shared' then nullif(btrim(v_filtered->>'accommodation_room'),'') else null end,
    accommodation_bed=null,
    accommodation_answers=case when v_accommodation='' then '{}'::jsonb else jsonb_strip_nulls(jsonb_build_object(
      'accommodation_type',v_accommodation,
      'accommodation_hostel',case when v_accommodation='Shared' then nullif(v_filtered->>'accommodation_hostel','') end,
      'accommodation_room',case when v_accommodation='Shared' then nullif(v_filtered->>'accommodation_room','') end,
      'shared_occupants',case when v_accommodation='Shared' then v_filtered->'shared_occupants' end
    )) end,
    reopened_at=null,reopened_by_role=null,reopen_reason=null,updated_at=now()
  where id=v_reg.id;
  v_status:=private.tr_recalculate(v_reg.id);
  perform private.tr_write_history(v_reg.id,'student','student_section_submitted','student',v_before,v_filtered,null);
  return jsonb_build_object('status','success','message','Your term enrolment has been submitted.','registration_status',v_status,'status_label',private.tr_status_label(v_status));
end
$function$;

create or replace function public.registration_admin_return_for_information(
  p_session_token text,
  p_registration_id uuid,
  p_request text,
  p_actor_name text default null
) returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_role text:=private.registration_session_context(p_session_token,true);
  v_reg public.term_registrations%rowtype;
  v_request text:=nullif(btrim(coalesce(p_request,'')),'');
begin
  if v_request is null then return jsonb_build_object('status','invalid','message','Describe the additional information needed.'); end if;
  select * into v_reg from public.term_registrations where id=p_registration_id for update;
  if not found then return jsonb_build_object('status','not_found','message','Enrolment record not found.'); end if;
  if v_reg.completed_at is not null then return jsonb_build_object('status','locked','message','A completed enrolment cannot be returned.'); end if;
  if v_reg.student_submitted_at is null then return jsonb_build_object('status','invalid','message','This student has not submitted the form.'); end if;
  update public.term_registrations set
    status='returned',student_locked=false,student_submitted_at=null,resume_token_hash=null,
    reopened_at=now(),reopened_by_role=v_role,reopen_reason=v_request,updated_at=now()
  where id=v_reg.id;
  perform private.tr_write_history(v_reg.id,v_role,'additional_information_requested','student',v_reg.student_answers,v_reg.student_answers,v_request);
  insert into public.audit_log(event_type,entity_type,entity_id,actor_role,action,details)
  values('term_registration','term_registration',v_reg.id::text,v_role,'returned_for_information',jsonb_build_object('request',v_request,'actor_name',nullif(btrim(coalesce(p_actor_name,'')),'')));
  return jsonb_build_object('status','success','message','The form was returned to the student.','registration_status','returned','status_label',private.tr_status_label('returned'));
end
$function$;

revoke all on function public.registration_admin_return_for_information(text,uuid,text,text) from public;
grant execute on function public.registration_admin_return_for_information(text,uuid,text,text) to anon,authenticated;

insert into public.system_settings(setting_key,setting_value,updated_at)
values ('meal_check_in_enabled','false'::jsonb,now()),('meal_collection_enabled','false'::jsonb,now())
on conflict(setting_key) do update set setting_value='false'::jsonb,updated_at=now();

create or replace function private.meal_feature_enabled(p_setting_key text)
returns boolean
language sql stable security definer
set search_path='public','pg_catalog'
as $function$
  select coalesce((select (setting_value #>> '{}')::boolean from public.system_settings where setting_key=p_setting_key),false)
$function$;

create or replace function public.system_mode_status()
returns jsonb
language plpgsql stable security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_base text:=private.school_operating_mode();
  v_conference boolean:=private.conference_mode();
  v_base_label text;
  v_check_in boolean:=private.meal_feature_enabled('meal_check_in_enabled');
  v_collection boolean:=private.meal_feature_enabled('meal_collection_enabled');
begin
  v_base_label:=case v_base when 'holiday' then 'Holiday Mode' else 'School Term Mode' end;
  return jsonb_build_object(
    'status','success','mode',v_base,'base_mode',v_base,'label',v_base_label,'base_label',v_base_label,
    'combined_label',v_base_label||case when v_conference then ' + Conference Mode' else '' end,
    'holiday_mode',v_base='holiday','conference_mode',v_conference,
    'meal_deadlines_enabled',not v_conference,
    'meal_check_in_switch',v_check_in,'meal_collection_switch',v_collection,
    'meal_check_in_enabled',v_check_in and not v_conference and v_base<>'holiday',
    'meal_collection_enabled',v_collection and not v_conference,
    'manual_work_sessions_enabled',not v_conference,'tasks_are_emergencies',v_conference
  );
end
$function$;

create or replace function public.meal_planning_status(p_service_date date default null)
returns jsonb
language sql security definer
set search_path='private','pg_catalog'
as $function$
  select jsonb_build_object(
    'status','success','service_date',coalesce(p_service_date,timezone('Africa/Harare',now())::date),
    'holiday_mode',private.meal_holiday_mode(),'conference_mode',private.conference_mode(),
    'switch_enabled',private.meal_feature_enabled('meal_check_in_enabled'),
    'check_in_enabled',private.meal_feature_enabled('meal_check_in_enabled') and not private.meal_holiday_mode() and not private.conference_mode(),
    'breakfast',private.meal_plan_window(coalesce(p_service_date,timezone('Africa/Harare',now())::date),'Breakfast'),
    'break_4pm',private.meal_plan_window(coalesce(p_service_date,timezone('Africa/Harare',now())::date),'Break-fast 4pm'),
    'lunch_rule','Lunch uses the Breakfast meal number.','supper_rule','No meal number needed for Supper.'
  )
$function$;

create or replace function private.meal_plan_save(p_registration_number text,p_meal_session text,p_service_date date,p_source text)
returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_student public.students%rowtype;
  v_window jsonb;
  v_existing public.meal_plans%rowtype;
begin
  if not private.meal_feature_enabled('meal_check_in_enabled') then
    return jsonb_build_object('status','feature_disabled','message','Meal check-in is turned off.');
  end if;
  if p_registration_number !~ '^[0-9]{5}$' then return jsonb_build_object('status','invalid','message','Enter a five-digit registration number.'); end if;
  if p_meal_session not in ('Breakfast','Break-fast 4pm') then return jsonb_build_object('status','invalid','message','Meal numbers are only needed for Breakfast and the 4 PM Break.'); end if;
  if p_source not in ('student_self','staff') then return jsonb_build_object('status','invalid','message','Invalid source.'); end if;
  select * into v_student from public.students where registration_number=p_registration_number::bigint and is_active=true limit 1;
  if not found then return jsonb_build_object('status','not_found','message','This registration number is not on the active student list.'); end if;
  v_window:=private.meal_plan_window(p_service_date,p_meal_session);
  if not coalesce((v_window->>'is_today')::boolean,false) then return jsonb_build_object('status','wrong_day','message','Meal numbers can only be entered for today.'); end if;
  if not coalesce((v_window->>'is_open')::boolean,false) then return jsonb_build_object('status','closed','full_name',v_student.full_name,'registration_number',v_student.registration_number::text,'meal_session',p_meal_session,'message','The meal-number window closed at '||(v_window->>'cutoff_label')||'.'); end if;
  select * into v_existing from public.meal_plans where student_id=v_student.id and service_date=p_service_date and meal_session=p_meal_session limit 1;
  if found then return jsonb_build_object('status','duplicate','full_name',v_student.full_name,'registration_number',v_student.registration_number::text,'meal_session',p_meal_session,'planned_at',v_existing.planned_at,'message','You are already included in this meal number.'); end if;
  begin
    insert into public.meal_plans(student_id,service_date,meal_session,plan_source) values(v_student.id,p_service_date,p_meal_session,p_source);
  exception when unique_violation then
    return jsonb_build_object('status','duplicate','full_name',v_student.full_name,'registration_number',v_student.registration_number::text,'meal_session',p_meal_session,'message','You are already included in this meal number.');
  end;
  return jsonb_build_object('status','planned','full_name',v_student.full_name,'registration_number',v_student.registration_number::text,'meal_session',p_meal_session,'cutoff_label',v_window->>'cutoff_label','message','You are included in the meal number.');
end
$function$;

create or replace function private.block_meal_collection_during_conference()
returns trigger
language plpgsql security definer
set search_path='private','public','pg_catalog'
as $function$
begin
  if not private.meal_feature_enabled('meal_collection_enabled') then
    raise exception 'Meal collection is turned off.' using errcode='P0001';
  end if;
  if private.conference_mode() then
    raise exception 'Meal collection is unavailable while Conference Mode is on.' using errcode='P0001';
  end if;
  return new;
end
$function$;

create or replace function private.set_meal_features(p_check_in_enabled boolean,p_collection_enabled boolean,p_actor_role text,p_actor_name text)
returns jsonb
language plpgsql security definer
set search_path='public','pg_catalog'
as $function$
begin
  insert into public.system_settings(setting_key,setting_value,updated_at)
  values ('meal_check_in_enabled',to_jsonb(coalesce(p_check_in_enabled,false)),now()),
         ('meal_collection_enabled',to_jsonb(coalesce(p_collection_enabled,false)),now())
  on conflict(setting_key) do update set setting_value=excluded.setting_value,updated_at=excluded.updated_at;
  insert into public.audit_log(event_type,entity_type,entity_id,actor_role,action,details)
  values('settings','meal_service','meal_features',p_actor_role,'updated',jsonb_build_object(
    'meal_check_in_enabled',coalesce(p_check_in_enabled,false),'meal_collection_enabled',coalesce(p_collection_enabled,false),'actor_name',nullif(btrim(coalesce(p_actor_name,'')),'')));
  return jsonb_build_object('status','success','meal_check_in_enabled',coalesce(p_check_in_enabled,false),'meal_collection_enabled',coalesce(p_collection_enabled,false));
end
$function$;

create or replace function public.system_control_set_meal_features(p_session_token text,p_check_in_enabled boolean,p_collection_enabled boolean,p_actor_name text)
returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare v_context record;
begin
  select * into v_context from private.system_session_context(p_session_token,array['it_admin']);
  if not found then return jsonb_build_object('status','unauthorized','message','IT Administration access is required.'); end if;
  if nullif(btrim(coalesce(p_actor_name,'')),'') is null then return jsonb_build_object('status','invalid','message','Enter your name for the audit record.'); end if;
  return private.set_meal_features(p_check_in_enabled,p_collection_enabled,v_context.role_key,p_actor_name);
end
$function$;

create or replace function public.ops_kitchen_set_meal_features(p_session_token text,p_check_in_enabled boolean,p_collection_enabled boolean,p_actor_name text)
returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare v_context record; v_slug text;
begin
  select * into v_context from private.ops_session_context(p_session_token);
  select slug into v_slug from public.ops_departments where id=v_context.actor_department_id;
  if not (v_context.actor_role='administrator' or (v_context.actor_role='department' and v_slug='kitchen')) then
    return jsonb_build_object('status','unauthorized','message','Kitchen access is required.');
  end if;
  if nullif(btrim(coalesce(p_actor_name,'')),'') is null then return jsonb_build_object('status','invalid','message','Enter your name for the audit record.'); end if;
  return private.set_meal_features(p_check_in_enabled,p_collection_enabled,case when v_context.actor_role='department' then 'kitchen' else v_context.actor_role end,p_actor_name);
end
$function$;

revoke all on function public.system_control_set_meal_features(text,boolean,boolean,text) from public;
revoke all on function public.ops_kitchen_set_meal_features(text,boolean,boolean,text) from public;
grant execute on function public.system_control_set_meal_features(text,boolean,boolean,text) to anon,authenticated;
grant execute on function public.ops_kitchen_set_meal_features(text,boolean,boolean,text) to anon,authenticated;

-- The requested one-time wipe. Student profiles, academic terms, fees, accommodation allocations,
-- immigration data, and unrelated operational records remain intact.
delete from public.term_registration_history;
delete from public.student_term_sponsors;
delete from public.term_registrations;
delete from public.sponsors s
where s.created_by_role='student'
  and not exists(select 1 from public.student_term_sponsors sts where sts.sponsor_id=s.id)
  and not exists(select 1 from public.student_immigration_profiles ip where ip.sponsor_id=s.id);
