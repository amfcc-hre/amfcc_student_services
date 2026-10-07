CREATE TABLE private.student_registration_categories (
 student_id text PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,
 category text NOT NULL CHECK(category IN ('standard','executive_missions')),
 source text,
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.student_registration_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.student_registration_categories FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.tr_is_exempt(p_student_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,private,pg_catalog
AS $$ SELECT EXISTS(SELECT 1 FROM private.student_registration_categories c WHERE c.student_id=p_student_id AND c.category='executive_missions') $$;
REVOKE ALL ON FUNCTION private.tr_is_exempt(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.tr_requirements(p_student_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,private,pg_catalog
AS $$ SELECT jsonb_build_object('registration_category',CASE WHEN private.tr_is_exempt(p_student_id) THEN 'executive_missions' ELSE 'standard' END,
 'sponsor_required',NOT private.tr_is_exempt(p_student_id),'admin_office_required',NOT private.tr_is_exempt(p_student_id)) $$;
REVOKE ALL ON FUNCTION private.tr_requirements(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.tr_student_form_schema(p_schema jsonb,p_student_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,private,pg_catalog
AS $$ SELECT CASE WHEN private.tr_is_exempt(p_student_id) THEN jsonb_set(p_schema,'{student}',
 COALESCE((SELECT jsonb_agg(f ORDER BY ord) FROM jsonb_array_elements(p_schema->'student') WITH ORDINALITY a(f,ord)
 WHERE f->>'id' NOT IN ('sponsor_name','sponsor_contact')),'[]'::jsonb)) ELSE p_schema END $$;
REVOKE ALL ON FUNCTION private.tr_student_form_schema(jsonb,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.tr_set_registration_category(p_session_token text,p_student_id text,p_category text,p_actor_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_catalog
AS $$
DECLARE v_role text;v_before jsonb;v_after jsonb;v_row record;
BEGIN
 v_role:=private.registration_session_context(p_session_token,true);
 IF v_role<>'it_admin' THEN RAISE EXCEPTION 'IT Administration access is required to change registration exemptions.' USING ERRCODE='42501'; END IF;
 IF p_category IS NULL OR p_category NOT IN ('standard','executive_missions') THEN RETURN jsonb_build_object('status','invalid','message','Choose Standard or Executive / missions.'); END IF;
 IF nullif(btrim(p_actor_name),'') IS NULL THEN RETURN jsonb_build_object('status','invalid','message','Enter your name for the audit record.'); END IF;
 PERFORM 1 FROM public.students WHERE id=p_student_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','message','Student record not found.'); END IF;
 v_before:=private.tr_requirements(p_student_id);
 INSERT INTO private.student_registration_categories(student_id,category,source,updated_by) VALUES(p_student_id,p_category,'IT Administration',btrim(p_actor_name))
 ON CONFLICT(student_id) DO UPDATE SET category=excluded.category,source=excluded.source,updated_by=excluded.updated_by,updated_at=now();
 v_after:=private.tr_requirements(p_student_id);
 FOR v_row IN SELECT id,status,completed_at FROM public.term_registrations WHERE student_id=p_student_id ORDER BY id FOR UPDATE LOOP
  IF v_row.completed_at IS NULL AND v_row.status IN ('student_submitted','waiting_accommodation','ready_final') THEN PERFORM private.tr_recalculate(v_row.id); END IF;
  PERFORM private.tr_write_history(v_row.id,v_role,'registration_category_changed','requirements',v_before,v_after,btrim(p_actor_name));
 END LOOP;
 RETURN jsonb_build_object('status','success','message','Registration category updated.')||v_after;
END $$;
REVOKE ALL ON FUNCTION private.tr_set_registration_category(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.tr_set_registration_category(text,text,text,text) TO anon,authenticated,service_role;
CREATE FUNCTION public.registration_admin_set_category(p_session_token text,p_student_id text,p_category text,p_actor_name text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=public,private,pg_catalog
AS $$ SELECT private.tr_set_registration_category(p_session_token,p_student_id,p_category,p_actor_name) $$;
REVOKE ALL ON FUNCTION public.registration_admin_set_category(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registration_admin_set_category(text,text,text,text) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.tr_admin_dashboard(p_pin text, p_term_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_actor text:=private.tr_actor_from_pin(p_pin);
  v_term public.academic_terms%rowtype;
  v_terms jsonb;
  v_rows jsonb;
  v_summary jsonb;
begin
  if v_actor<>'administrator' then
    return jsonb_build_object('status','unauthorized','message','School Administration access required.');
  end if;

  if p_term_id is null then
    select * into v_term
    from public.academic_terms
    order by registration_is_open desc,is_current desc,academic_year desc,term_number desc
    limit 1;
  else
    select * into v_term
    from public.academic_terms
    where id=p_term_id;
  end if;

  if not found then
    return jsonb_build_object('status','not_found','message','No academic term is configured.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'academic_year',t.academic_year,
    'term_number',t.term_number,
    'term_name',t.term_name,
    'fees_due_date',t.fees_due_date,
    'is_current',t.is_current,
    'registration_is_open',t.registration_is_open,
    'form_configured',coalesce((t.registration_form_schema->>'configured')::boolean,false),
    'expected',(select count(*) from public.term_registrations r where r.term_id=t.id),
    'started',(select count(*) from public.term_registrations r where r.term_id=t.id and r.student_started_at is not null),
    'submitted',(select count(*) from public.term_registrations r where r.term_id=t.id and r.student_submitted_at is not null),
    'completed',(select count(*) from public.term_registrations r where r.term_id=t.id and r.completed_at is not null)
  ) order by t.academic_year desc,t.term_number desc),'[]'::jsonb)
  into v_terms
  from public.academic_terms t;

  select jsonb_build_object(
    'expected',count(*),
    'not_started',count(*) filter(where status='not_started'),
    'started',count(*) filter(where status='started'),
    'returned',count(*) filter(where status='returned'),
    'submitted',count(*) filter(where student_submitted_at is not null),
    'waiting_admin',count(*) filter(where status='student_submitted' and not private.tr_is_exempt(student_id) and not admin_office_complete),
    'waiting_fees',count(*) filter(where student_submitted_at is not null and (private.tr_is_exempt(student_id) or admin_office_complete) and not fees_complete),
    'waiting_accommodation',count(*) filter(where status='waiting_accommodation' or (student_submitted_at is not null and (private.tr_is_exempt(student_id) or admin_office_complete) and fees_complete and not accommodation_complete)),
    'ready_final',count(*) filter(where status='ready_final'),
    'completed',count(*) filter(where status='completed' or completed_at is not null)
  )
  into v_summary
  from public.term_registrations
  where term_id=v_term.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',tr.id,
    'student_name',tr.student_name_snapshot,'registration_category',private.tr_requirements(tr.student_id)->>'registration_category','sponsor_required',not private.tr_is_exempt(tr.student_id),'admin_office_required',not private.tr_is_exempt(tr.student_id),
    'registration_number',tr.registration_number_snapshot,
    'class_year',tr.class_year_snapshot,
    'campus_status',private.tr_current_campus_status(tr.student_id),
    'status',tr.status,
    'status_label',private.tr_status_label(tr.status),
    'stage',
      case
        when tr.completed_at is not null or tr.status='completed' then 'completed'
        when tr.status='not_started' then 'student_not_started'
        when tr.status='started' then 'student_form'
        when tr.status='returned' then 'returned_to_student'
        when not private.tr_is_exempt(tr.student_id) and not tr.admin_office_complete then 'administrators_office'
        when not tr.fees_complete then 'fees'
        when tr.status='waiting_accommodation' or not tr.accommodation_complete then 'accommodation'
        when tr.status='ready_final' then 'final_administration'
        else 'final_administration'
      end,
    'stage_label',
      case
        when tr.completed_at is not null or tr.status='completed' then 'Completed'
        when tr.status='not_started' then 'Student has not started'
        when tr.status='started' then 'Student completing form'
        when tr.status='returned' then 'Returned to student'
        when not private.tr_is_exempt(tr.student_id) and not tr.admin_office_complete then 'Administrator''s Office review'
        when not tr.fees_complete then 'Fees review'
        when tr.status='waiting_accommodation' or not tr.accommodation_complete then 'Accommodation'
        when tr.status='ready_final' then 'Final administration'
        else 'Final administration'
      end,
    'student_started_at',tr.student_started_at,
    'student_submitted_at',tr.student_submitted_at,
    'admin_office_complete',tr.admin_office_complete,
    'fees_complete',tr.fees_complete,
    'accommodation_mode',tr.accommodation_mode,
    'accommodation_residence',tr.accommodation_residence,
    'accommodation_room',tr.accommodation_room,
    'accommodation_complete',tr.accommodation_complete,
    'completed_at',tr.completed_at,
    'updated_at',tr.updated_at
  ) order by tr.student_name_snapshot),'[]'::jsonb)
  into v_rows
  from public.term_registrations tr
  where tr.term_id=v_term.id;

  return jsonb_build_object(
    'status','success',
    'selected_term',jsonb_build_object(
      'id',v_term.id,
      'academic_year',v_term.academic_year,
      'term_number',v_term.term_number,
      'term_name',v_term.term_name,
      'fees_due_date',v_term.fees_due_date,
      'registration_is_open',v_term.registration_is_open,
      'form_configured',coalesce((v_term.registration_form_schema->>'configured')::boolean,false),
      'form_schema',v_term.registration_form_schema
    ),
    'terms',v_terms,
    'summary',v_summary,
    'registrations',v_rows
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.tr_admin_finalize(p_pin text, p_registration_id uuid, p_final_answers jsonb, p_staff_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$ declare v_actor text:=private.tr_actor_from_pin(p_pin); v_reg public.term_registrations%rowtype; v_term public.academic_terms%rowtype; v_final jsonb; v_missing jsonb; v_before jsonb; begin if v_actor<>'administrator' then return jsonb_build_object('status','unauthorized','message','School Administration access required.'); end if; select * into v_reg from public.term_registrations where id=p_registration_id for update; if not found then return jsonb_build_object('status','not_found','message','Registration not found.'); end if; if v_reg.completed_at is not null then return jsonb_build_object('status','locked','message','This registration is already complete.'); end if; if v_reg.student_submitted_at is null or (not private.tr_is_exempt(v_reg.student_id) and not v_reg.admin_office_complete) or not v_reg.fees_complete or not v_reg.accommodation_complete then return jsonb_build_object('status','not_ready','message','Complete all required Student, Administration, Fees and Accommodation sections first.'); end if; select * into v_term from public.academic_terms where id=v_reg.term_id; v_final:=private.tr_filter_answers(v_term.registration_form_schema->'final',coalesce(p_final_answers,'{}'::jsonb)); v_missing:=private.tr_missing_required(v_term.registration_form_schema->'final',v_final); if jsonb_array_length(v_missing)>0 then return jsonb_build_object('status','missing','message','Complete all required final check fields.','missing',v_missing); end if; v_before:=jsonb_build_object('final_answers',v_reg.final_answers,'status',v_reg.status,'staff_note',v_reg.staff_note); update public.term_registrations set final_answers=v_final,staff_note=coalesce(nullif(trim(coalesce(p_staff_note,'')),''),staff_note),completed_at=now(),completed_by_role='administrator',student_locked=true,status='completed',updated_at=now() where id=v_reg.id; perform private.tr_write_history(v_reg.id,'administrator','registration_completed','final',v_before,jsonb_build_object('final_answers',v_final,'status','completed','completed_at',now()),p_staff_note); insert into public.audit_log(event_type,entity_type,entity_id,actor_role,action,details) values('term_registration','term_registration',v_reg.id::text,'administrator','registration_completed',jsonb_build_object('student_id',v_reg.student_id,'term_id',v_reg.term_id,'registration_number',v_reg.registration_number_snapshot)); return jsonb_build_object('status','success','message','Registration complete.','status_label','Registration complete','completed_at',now()); end $function$;

CREATE OR REPLACE FUNCTION private.tr_admin_get(p_pin text, p_registration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$ declare v_actor text:=private.tr_actor_from_pin(p_pin); v_reg public.term_registrations%rowtype; v_term public.academic_terms%rowtype; v_fee public.student_term_fee_status%rowtype; v_history jsonb; begin if v_actor<>'administrator' then return jsonb_build_object('status','unauthorized','message','School Administration access required.'); end if; select * into v_reg from public.term_registrations where id=p_registration_id; if not found then return jsonb_build_object('status','not_found','message','Registration not found.'); end if; select * into v_term from public.academic_terms where id=v_reg.term_id; select * into v_fee from public.student_term_fee_status where student_id=v_reg.student_id and term_id=v_reg.term_id; select coalesce(jsonb_agg(jsonb_build_object('changed_at',h.changed_at,'actor_role',h.actor_role,'action',h.action,'section',h.section,'note',h.note) order by h.changed_at desc),'[]'::jsonb) into v_history from public.term_registration_history h where h.registration_id=v_reg.id; return jsonb_build_object('status','success','term',jsonb_build_object('id',v_term.id,'term_name',v_term.term_name,'academic_year',v_term.academic_year,'form_schema',v_term.registration_form_schema),'registration',to_jsonb(v_reg)||private.tr_requirements(v_reg.student_id)||jsonb_build_object('status_label',private.tr_status_label(v_reg.status),'campus_status',private.tr_current_campus_status(v_reg.student_id)),'fees_paid',coalesce(v_fee.fees_paid,false),'fee_notes',v_fee.notes,'history',v_history); end $function$;

CREATE OR REPLACE FUNCTION private.tr_recalculate(p_registration_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$ declare v_status text; begin select case when completed_at is not null then 'completed' when student_submitted_at is null and student_started_at is null then 'not_started' when student_submitted_at is null then 'started' when (not private.tr_is_exempt(student_id) and not admin_office_complete) or not fees_complete then 'student_submitted' when not accommodation_complete then 'waiting_accommodation' else 'ready_final' end into v_status from public.term_registrations where id=p_registration_id; update public.term_registrations set status=v_status,updated_at=now() where id=p_registration_id; return v_status; end $function$;

CREATE OR REPLACE FUNCTION private.tr_student_save(p_registration_number text, p_resume_token text, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_digits text:=regexp_replace(coalesce(p_registration_number,''),'\D','','g');
  v_reg public.term_registrations%rowtype;
  v_term public.academic_terms%rowtype;
  v_filtered jsonb;
  v_before jsonb;
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
    return jsonb_build_object('status','locked','message','Your form has already been submitted.');
  end if;
  select * into v_term from public.academic_terms where id=v_reg.term_id;
  v_filtered:=private.tr_filter_answers(private.tr_student_form_schema(v_term.registration_form_schema,v_reg.student_id)->'student',coalesce(p_answers,'{}'::jsonb));
  if coalesce(v_filtered->>'marital_status','')<>'Married' then v_filtered:=v_filtered-'spouse_location'; end if;
  if coalesce(v_filtered->>'accommodation_type','')<>'Shared' then
    v_filtered:=v_filtered-'accommodation_hostel'-'accommodation_room'-'shared_occupants';
  end if;
  v_before:=v_reg.student_answers;
  update public.term_registrations set student_answers=v_filtered,updated_at=now()
  where id=v_reg.id;
  perform private.tr_write_history(v_reg.id,'student','answers_saved','student',v_before,v_filtered,null);
  return jsonb_build_object('status','success','message','Saved.','student_answers',v_filtered,'status_label',private.tr_status_label(v_reg.status));
end
$function$;

CREATE OR REPLACE FUNCTION private.tr_student_start(p_registration_number text, p_resume_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog', 'extensions'
AS $function$
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
    return jsonb_build_object('status','success','student_name',v_student.full_name,'registration_number',v_student.registration_number,'term_id',v_term.id,'term_name',v_term.term_name,'registration_category',private.tr_requirements(v_student.id)->>'registration_category','sponsor_required',not private.tr_is_exempt(v_student.id),'admin_office_required',not private.tr_is_exempt(v_student.id),'form_schema',private.tr_student_form_schema(v_term.registration_form_schema,v_student.id),'student_answers',v_reg.student_answers,'resume_token',p_resume_token,'registration_status',v_reg.status,'status_label',private.tr_status_label(v_reg.status),'is_locked',v_reg.student_locked,'return_reason',v_reg.reopen_reason);
  end if;
  if v_reg.student_locked then
    return jsonb_build_object('status','locked','message','This registration has already been submitted and cannot be changed by the student.','student_name',v_student.full_name,'registration_number',v_student.registration_number,'term_name',v_term.term_name,'status_label',private.tr_status_label(v_reg.status));
  end if;
  v_token:=private.tr_new_token();
  update public.term_registrations set resume_token_hash=private.tr_token_hash(v_token),student_started_at=coalesce(student_started_at,now()),status=case when status='returned' then 'returned' else 'started' end,updated_at=now() where id=v_reg.id returning * into v_reg;
  perform private.tr_write_history(v_reg.id,'student','registration_started','student',null,null,null);
  return jsonb_build_object('status','success','student_name',v_student.full_name,'registration_number',v_student.registration_number,'term_id',v_term.id,'term_name',v_term.term_name,'registration_category',private.tr_requirements(v_student.id)->>'registration_category','sponsor_required',not private.tr_is_exempt(v_student.id),'admin_office_required',not private.tr_is_exempt(v_student.id),'form_schema',private.tr_student_form_schema(v_term.registration_form_schema,v_student.id),'student_answers',v_reg.student_answers,'resume_token',v_token,'registration_status',v_reg.status,'status_label',private.tr_status_label(v_reg.status),'is_locked',false,'return_reason',v_reg.reopen_reason);
end
$function$;

CREATE OR REPLACE FUNCTION private.tr_student_submit(p_registration_number text, p_resume_token text, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
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
  v_filtered:=private.tr_filter_answers(private.tr_student_form_schema(v_term.registration_form_schema,v_reg.student_id)->'student',coalesce(p_answers,'{}'::jsonb));
  if coalesce(v_filtered->>'marital_status','')<>'Married' then v_filtered:=v_filtered-'spouse_location'; end if;
  v_accommodation:=coalesce(v_filtered->>'accommodation_type','');
  if v_accommodation<>'Shared' then v_filtered:=v_filtered-'accommodation_hostel'-'accommodation_room'-'shared_occupants'; end if;
  v_missing:=private.tr_missing_required(private.tr_student_form_schema(v_term.registration_form_schema,v_reg.student_id)->'student',v_filtered);
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
  if not private.tr_is_exempt(v_reg.student_id) then
    perform private.tr_sync_sponsor(v_reg.student_id,v_reg.term_id,v_filtered->>'sponsor_name',v_filtered->>'sponsor_contact','student');
  end if;
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

CREATE OR REPLACE FUNCTION public.ops_term_enrolment_dashboard(p_session_token text, p_term_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_context record;
  v_department_slug text;
  v_term public.academic_terms%rowtype;
  v_terms jsonb;
  v_summary jsonb;
  v_rows jsonb;
begin
  select * into v_context
  from private.ops_session_context(p_session_token);

  if v_context.actor_role='department' then
    select slug into v_department_slug
    from public.ops_departments
    where id=v_context.actor_department_id;
  end if;

  if not (
    v_context.actor_role='administrator'
    or (v_context.actor_role='department' and v_department_slug='administrators-office')
  ) then
    raise exception 'School Administration or Administrator''s Office access is required.'
      using errcode='42501';
  end if;

  if p_term_id is null then
    select * into v_term
    from public.academic_terms
    order by registration_is_open desc,is_current desc,academic_year desc,term_number desc
    limit 1;
  else
    select * into v_term
    from public.academic_terms
    where id=p_term_id;
  end if;

  if not found then
    return jsonb_build_object('status','not_found','message','No academic term is configured.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'academic_year',t.academic_year,
    'term_number',t.term_number,
    'term_name',t.term_name,
    'registration_is_open',t.registration_is_open,
    'is_current',t.is_current,
    'expected',(select count(*) from public.term_registrations r where r.term_id=t.id),
    'completed',(select count(*) from public.term_registrations r where r.term_id=t.id and r.completed_at is not null)
  ) order by t.academic_year desc,t.term_number desc),'[]'::jsonb)
  into v_terms
  from public.academic_terms t;

  select jsonb_build_object(
    'expected',count(*),
    'not_started',count(*) filter(where status='not_started'),
    'started',count(*) filter(where status='started'),
    'returned',count(*) filter(where status='returned'),
    'student_submitted',count(*) filter(where status='student_submitted'),
    'waiting_accommodation',count(*) filter(where status='waiting_accommodation'),
    'ready_final',count(*) filter(where status='ready_final'),
    'completed',count(*) filter(where status='completed' or completed_at is not null)
  )
  into v_summary
  from public.term_registrations
  where term_id=v_term.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',tr.id,
    'student_id',tr.student_id,
    'student_name',tr.student_name_snapshot,'registration_category',private.tr_requirements(tr.student_id)->>'registration_category','sponsor_required',not private.tr_is_exempt(tr.student_id),'admin_office_required',not private.tr_is_exempt(tr.student_id),
    'registration_number',tr.registration_number_snapshot,
    'class_year',tr.class_year_snapshot,
    'status',tr.status,
    'status_label',private.tr_status_label(tr.status),
    'stage',
      case
        when tr.completed_at is not null or tr.status='completed' then 'completed'
        when tr.status='not_started' then 'student_not_started'
        when tr.status='started' then 'student_form'
        when tr.status='returned' then 'returned_to_student'
        when not private.tr_is_exempt(tr.student_id) and not tr.admin_office_complete then 'administrators_office'
        when not tr.fees_complete then 'fees'
        when tr.status='waiting_accommodation' or not tr.accommodation_complete then 'accommodation'
        when tr.status='ready_final' then 'final_administration'
        else 'final_administration'
      end,
    'stage_label',
      case
        when tr.completed_at is not null or tr.status='completed' then 'Completed'
        when tr.status='not_started' then 'Student has not started'
        when tr.status='started' then 'Student completing form'
        when tr.status='returned' then 'Returned to student'
        when not private.tr_is_exempt(tr.student_id) and not tr.admin_office_complete then 'Administrator''s Office review'
        when not tr.fees_complete then 'Fees review'
        when tr.status='waiting_accommodation' or not tr.accommodation_complete then 'Accommodation'
        when tr.status='ready_final' then 'Final administration'
        else 'Final administration'
      end,
    'student_started_at',tr.student_started_at,
    'student_submitted_at',tr.student_submitted_at,
    'admin_office_complete',tr.admin_office_complete,
    'admin_office_completed_at',tr.admin_office_completed_at,
    'fees_complete',tr.fees_complete,
    'fees_completed_at',tr.fees_completed_at,
    'accommodation_complete',tr.accommodation_complete,
    'accommodation_completed_at',tr.accommodation_completed_at,
    'completed_at',tr.completed_at,
    'updated_at',tr.updated_at
  ) order by tr.student_name_snapshot),'[]'::jsonb)
  into v_rows
  from public.term_registrations tr
  where tr.term_id=v_term.id;

  return jsonb_build_object(
    'status','success',
    'selected_term',jsonb_build_object(
      'id',v_term.id,
      'academic_year',v_term.academic_year,
      'term_number',v_term.term_number,
      'term_name',v_term.term_name,
      'registration_is_open',v_term.registration_is_open,
      'is_current',v_term.is_current
    ),
    'terms',v_terms,
    'summary',v_summary,
    'registrations',v_rows
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.registration_admin_bootstrap(p_session_token text, p_term_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_role text:=private.registration_session_context(p_session_token,false);
  v_term public.academic_terms%rowtype;
  v_terms jsonb;
  v_rows jsonb;
  v_summary jsonb;
begin
  if p_term_id is null then
    select * into v_term from public.academic_terms
    order by registration_is_open desc,is_current desc,academic_year desc,term_number desc limit 1;
  else select * into v_term from public.academic_terms where id=p_term_id; end if;
  if not found then return jsonb_build_object('status','not_found','message','No academic term is configured.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'academic_year',t.academic_year,'term_number',t.term_number,'term_name',t.term_name,
    'registration_is_open',t.registration_is_open,'is_current',t.is_current,
    'expected',(select count(*) from public.term_registrations r where r.term_id=t.id),
    'submitted',(select count(*) from public.term_registrations r where r.term_id=t.id and r.student_submitted_at is not null),
    'completed',(select count(*) from public.term_registrations r where r.term_id=t.id and r.completed_at is not null)
  ) order by t.academic_year desc,t.term_number desc),'[]'::jsonb) into v_terms
  from public.academic_terms t;
  select jsonb_build_object(
    'expected',count(*),'not_started',count(*) filter(where status='not_started'),
    'draft',count(*) filter(where status='started'),'submitted',count(*) filter(where student_submitted_at is not null),
    'waiting_admin',count(*) filter(where student_submitted_at is not null and completed_at is null),
    'completed',count(*) filter(where completed_at is not null)
  ) into v_summary from public.term_registrations where term_id=v_term.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',tr.id,'student_id',tr.student_id,'student_name',tr.student_name_snapshot,'registration_category',private.tr_requirements(tr.student_id)->>'registration_category','sponsor_required',not private.tr_is_exempt(tr.student_id),'admin_office_required',not private.tr_is_exempt(tr.student_id),
    'registration_number',tr.registration_number_snapshot,'class_year',tr.class_year_snapshot,
    'status',tr.status,'status_label',private.tr_status_label(tr.status),
    'student_started_at',tr.student_started_at,'student_submitted_at',tr.student_submitted_at,
    'admin_office_complete',tr.admin_office_complete,'fees_complete',tr.fees_complete,
    'accommodation_complete',tr.accommodation_complete,'completed_at',tr.completed_at,
    'accommodation_type',coalesce(tr.accommodation_answers->>'accommodation_type',tr.student_answers->>'accommodation_type'),
    'accommodation_residence',tr.accommodation_residence,'accommodation_room',tr.accommodation_room,
    'sponsor_name',sts.sponsor_name_snapshot,'sponsor_phone',sts.sponsor_phone_snapshot,
    'arrears',coalesce(fs.arrears_previous_terms,0),'amount_paid',coalesce(fs.amount_paid_current_term,0),
    'outstanding_balance',coalesce(fs.outstanding_balance,0),
    'residency_status',coalesce(ip.residency_status,'not_recorded'),'country',ip.country,
    'passport_expiry_date',ip.passport_expiry_date,
    'document_count',(select count(*) from public.student_immigration_documents d where d.student_id=tr.student_id and d.confirmed_at is not null)
  ) order by tr.student_name_snapshot),'[]'::jsonb) into v_rows
  from public.term_registrations tr
  left join public.student_term_sponsors sts on sts.student_id=tr.student_id and sts.term_id=tr.term_id
  left join public.student_term_fee_status fs on fs.student_id=tr.student_id and fs.term_id=tr.term_id
  left join public.student_immigration_profiles ip on ip.student_id=tr.student_id
  where tr.term_id=v_term.id;
  return jsonb_build_object(
    'status','success','role',v_role,'can_edit',v_role<>'management',
    'can_manage_term',v_role in('administrator','it_admin'),
    'selected_term',jsonb_build_object('id',v_term.id,'academic_year',v_term.academic_year,'term_number',v_term.term_number,
      'term_name',v_term.term_name,'registration_is_open',v_term.registration_is_open,'form_schema',v_term.registration_form_schema),
    'terms',v_terms,'summary',v_summary,'registrations',v_rows
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.registration_admin_get(p_session_token text, p_registration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_role text:=private.registration_session_context(p_session_token,false);
  v_reg public.term_registrations%rowtype;
  v_term public.academic_terms%rowtype;
  v_fee jsonb;
  v_sponsor jsonb;
  v_immigration jsonb;
  v_documents jsonb;
  v_history jsonb;
begin
  select * into v_reg from public.term_registrations where id=p_registration_id;
  if not found then return jsonb_build_object('status','not_found','message','Enrolment record not found.'); end if;
  select * into v_term from public.academic_terms where id=v_reg.term_id;
  select to_jsonb(f) into v_fee from public.student_term_fee_status f where f.student_id=v_reg.student_id and f.term_id=v_reg.term_id;
  select to_jsonb(s)||jsonb_build_object('sponsor_name_snapshot',sts.sponsor_name_snapshot,'sponsor_phone_snapshot',sts.sponsor_phone_snapshot)
    into v_sponsor from public.student_term_sponsors sts join public.sponsors s on s.id=sts.sponsor_id
    where sts.student_id=v_reg.student_id and sts.term_id=v_reg.term_id;
  select to_jsonb(ip) into v_immigration from public.student_immigration_profiles ip where ip.student_id=v_reg.student_id;
  select coalesce(jsonb_agg(to_jsonb(d)-'storage_path' order by d.uploaded_at desc),'[]'::jsonb) into v_documents
    from public.student_immigration_documents d where d.student_id=v_reg.student_id and d.confirmed_at is not null;
  select coalesce(jsonb_agg(jsonb_build_object('changed_at',h.changed_at,'actor_role',h.actor_role,'action',h.action,'section',h.section,'note',h.note) order by h.changed_at desc),'[]'::jsonb)
    into v_history from public.term_registration_history h where h.registration_id=v_reg.id;
  return jsonb_build_object('status','success','role',v_role,'can_edit',v_role<>'management',
    'term',jsonb_build_object('id',v_term.id,'term_name',v_term.term_name,'academic_year',v_term.academic_year,'term_number',v_term.term_number,'form_schema',v_term.registration_form_schema),
    'registration',to_jsonb(v_reg)||private.tr_requirements(v_reg.student_id)||jsonb_build_object('status_label',private.tr_status_label(v_reg.status)),
    'fee',coalesce(v_fee,'{}'::jsonb),'sponsor',coalesce(v_sponsor,'{}'::jsonb),
    'immigration',coalesce(v_immigration,'{}'::jsonb),'documents',v_documents,'history',v_history);
end
$function$;

CREATE OR REPLACE FUNCTION public.registration_admin_save_record(p_session_token text, p_registration_id uuid, p_admin_answers jsonb, p_fees_answers jsonb, p_accommodation_answers jsonb, p_final_answers jsonb, p_staff_note text DEFAULT NULL::text, p_finalize boolean DEFAULT false, p_actor_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_role text:=private.registration_session_context(p_session_token,true);
  v_reg public.term_registrations%rowtype;
  v_term public.academic_terms%rowtype;
  v_admin jsonb; v_fees jsonb; v_accommodation jsonb; v_final jsonb;
  v_admin_missing jsonb; v_fees_missing jsonb; v_accommodation_missing jsonb;
  v_admin_complete boolean; v_fees_complete boolean; v_accommodation_complete boolean;
  v_type text; v_status text;
begin
  select * into v_reg from public.term_registrations where id=p_registration_id for update;
  if not found then return jsonb_build_object('status','not_found','message','Enrolment record not found.'); end if;
  if v_reg.completed_at is not null then return jsonb_build_object('status','locked','message','This enrolment is already complete.'); end if;
  select * into v_term from public.academic_terms where id=v_reg.term_id;
  v_admin:=private.tr_filter_answers(v_term.registration_form_schema->'admin',coalesce(p_admin_answers,'{}'::jsonb));
  v_fees:=private.tr_filter_answers(v_term.registration_form_schema->'fees',coalesce(p_fees_answers,'{}'::jsonb));
  v_accommodation:=private.tr_filter_answers(v_term.registration_form_schema->'accommodation',coalesce(p_accommodation_answers,'{}'::jsonb));
  v_final:=private.tr_filter_answers(v_term.registration_form_schema->'final',coalesce(p_final_answers,'{}'::jsonb));
  v_type:=coalesce(v_accommodation->>'accommodation_type',v_reg.student_answers->>'accommodation_type','');
  v_accommodation:=v_accommodation||jsonb_build_object('accommodation_type',v_type);
  if v_type<>'Shared' then v_accommodation:=v_accommodation-'accommodation_hostel'-'accommodation_room'-'shared_occupants'; end if;
  v_admin_missing:=private.tr_missing_required(v_term.registration_form_schema->'admin',v_admin);
  v_fees_missing:=private.tr_missing_required(v_term.registration_form_schema->'fees',v_fees);
  v_accommodation_missing:=private.tr_missing_required(v_term.registration_form_schema->'accommodation',v_accommodation);
  if v_type='Shared' then
    if nullif(btrim(coalesce(v_accommodation->>'accommodation_hostel','')),'') is null then v_accommodation_missing:=v_accommodation_missing||jsonb_build_array(jsonb_build_object('id','accommodation_hostel','label','Hostel allocated')); end if;
    if nullif(btrim(coalesce(v_accommodation->>'accommodation_room','')),'') is null then v_accommodation_missing:=v_accommodation_missing||jsonb_build_array(jsonb_build_object('id','accommodation_room','label','Room number')); end if;
    if coalesce((v_accommodation->>'shared_occupants')::numeric,0)<1 then v_accommodation_missing:=v_accommodation_missing||jsonb_build_array(jsonb_build_object('id','shared_occupants','label','Number of occupants')); end if;
  elsif v_type<>'Married' then
    v_accommodation_missing:=v_accommodation_missing||jsonb_build_array(jsonb_build_object('id','accommodation_type','label','Accommodation type'));
  end if;
  if private.tr_is_exempt(v_reg.student_id) then
    v_admin:=v_reg.admin_answers;
    v_admin_missing:='[]'::jsonb;
    v_admin_complete:=v_reg.admin_office_complete;
  else v_admin_complete:=jsonb_array_length(v_admin_missing)=0; end if;
  v_fees_complete:=jsonb_array_length(v_fees_missing)=0;
  v_accommodation_complete:=jsonb_array_length(v_accommodation_missing)=0;
  if p_finalize and (v_reg.student_submitted_at is null or (not private.tr_is_exempt(v_reg.student_id) and not v_admin_complete) or not v_fees_complete or not v_accommodation_complete) then
    return jsonb_build_object('status','not_ready','message','Complete all required student, Administration, Fees and Accommodation sections before finalising.',
      'admin_missing',v_admin_missing,'fees_missing',v_fees_missing,'accommodation_missing',v_accommodation_missing);
  end if;
  update public.term_registrations set
    admin_answers=v_admin,fees_answers=v_fees,accommodation_answers=v_accommodation,final_answers=v_final,
    admin_office_complete=v_admin_complete,
    admin_office_completed_at=case when private.tr_is_exempt(v_reg.student_id) then admin_office_completed_at when v_admin_complete then coalesce(admin_office_completed_at,now()) else null end,
    admin_office_completed_by_role=case when private.tr_is_exempt(v_reg.student_id) then admin_office_completed_by_role when v_admin_complete then v_role else null end,
    fees_complete=v_fees_complete,
    fees_completed_at=case when v_fees_complete then coalesce(fees_completed_at,now()) else null end,
    fees_completed_by_role=case when v_fees_complete then v_role else null end,
    accommodation_mode=case when v_type='Shared' then 'on_campus' when v_type='Married' then 'off_campus' else 'unconfirmed' end,
    accommodation_residence=case when v_type='Shared' then nullif(btrim(v_accommodation->>'accommodation_hostel'),'') else null end,
    accommodation_room=case when v_type='Shared' then nullif(btrim(v_accommodation->>'accommodation_room'),'') else null end,
    accommodation_complete=v_accommodation_complete,
    accommodation_completed_at=case when v_accommodation_complete then coalesce(accommodation_completed_at,now()) else null end,
    accommodation_completed_by_role=case when v_accommodation_complete then v_role else null end,
    staff_note=nullif(btrim(coalesce(p_staff_note,'')),''),updated_at=now()
  where id=v_reg.id;
  insert into public.student_term_fee_status(
    student_id,term_id,fees_paid,notes,updated_by_role,arrears_previous_terms,amount_paid_current_term,outstanding_balance,payment_plan
  ) values(
    v_reg.student_id,v_reg.term_id,coalesce((v_fees->>'outstanding_balance')::numeric,0)<=0,
    nullif(btrim(coalesce(p_staff_note,'')),''),v_role,
    coalesce((v_fees->>'arrears_previous_terms')::numeric,0),coalesce((v_fees->>'amount_paid_current_term')::numeric,0),
    coalesce((v_fees->>'outstanding_balance')::numeric,0),nullif(btrim(v_fees->>'payment_plan'),'')
  ) on conflict(student_id,term_id) do update set
    fees_paid=excluded.fees_paid,notes=excluded.notes,updated_by_role=excluded.updated_by_role,
    arrears_previous_terms=excluded.arrears_previous_terms,amount_paid_current_term=excluded.amount_paid_current_term,
    outstanding_balance=excluded.outstanding_balance,payment_plan=excluded.payment_plan,updated_at=now();
  update public.accommodation_allocations set is_active=false,allocation_status='checked_out',ended_at=now(),updated_at=now()
  where student_id=v_reg.student_id and is_active and v_type='Married';
  if v_type='Shared' and nullif(btrim(v_accommodation->>'accommodation_hostel'),'') is not null then
    update public.accommodation_allocations set is_active=false,ended_at=now(),updated_at=now()
    where student_id=v_reg.student_id and is_active;
    insert into public.accommodation_allocations(student_id,residence,room,term_label,allocation_status,is_active,allocated_by_role,notes)
    values(v_reg.student_id,btrim(v_accommodation->>'accommodation_hostel'),nullif(btrim(v_accommodation->>'accommodation_room'),''),v_term.term_name,'allocated',true,v_role,'Updated from term enrolment');
  end if;
  v_status:=private.tr_recalculate(v_reg.id);
  if p_finalize then
    update public.term_registrations set completed_at=now(),completed_by_role=v_role,status='completed',student_locked=true,updated_at=now() where id=v_reg.id;
    v_status:='completed';
  end if;
  perform private.tr_write_history(v_reg.id,v_role,case when p_finalize then 'registration_completed' else 'admin_sections_saved' end,'administration',
    null,jsonb_build_object('admin',v_admin,'fees',v_fees,'accommodation',v_accommodation,'final',v_final),p_actor_name);
  return jsonb_build_object('status','success','message',case when p_finalize then 'Enrolment completed.' else 'Administration sections saved.' end,
    'registration_status',v_status,'status_label',private.tr_status_label(v_status));
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('status','invalid','message','Check that every fee amount and occupant count is a valid number.');
end
$function$;

NOTIFY pgrst,'reload schema';
