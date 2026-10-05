-- Rotate the existing registration capability while preserving the saved draft.
CREATE OR REPLACE FUNCTION private.tr_student_takeover(p_registration_number text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_catalog'
AS $function$
DECLARE
  v_digits text := regexp_replace(coalesce(p_registration_number,''),'\D','','g');
  v_student public.students%rowtype;
  v_term public.academic_terms%rowtype;
  v_reg public.term_registrations%rowtype;
BEGIN
  IF v_digits !~ '^\d{5}$' THEN
    RETURN jsonb_build_object('status','invalid','message','Enter your five-digit registration number.');
  END IF;
  SELECT * INTO v_student FROM public.students
    WHERE registration_number::text=v_digits AND is_active=true LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found','message','This active student registration number was not found.');
  END IF;
  SELECT * INTO v_term FROM public.academic_terms WHERE registration_is_open=true
    ORDER BY registration_opened_at DESC NULLS LAST,id DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','closed','message','Term registration is not open right now.');
  END IF;
  SELECT * INTO v_reg FROM public.term_registrations
    WHERE student_id=v_student.id AND term_id=v_term.id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN private.tr_student_start(p_registration_number,NULL);
  END IF;
  IF v_reg.student_locked OR v_reg.student_submitted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status','locked','message','This enrolment has already been submitted. Ask Administration if it needs to be changed.');
  END IF;
  -- Save and submit take the same row lock and validate the token under that lock.
  -- Clearing the hash and starting again happen in one transaction.
  UPDATE public.term_registrations SET resume_token_hash=NULL,updated_at=now() WHERE id=v_reg.id;
  PERFORM private.tr_write_history(v_reg.id,'student','student_sessions_ended','student',NULL,NULL,
    'Student ended previous registration sessions and continued in a new session. Saved draft retained.');
  RETURN private.tr_student_start(p_registration_number,NULL)
    || jsonb_build_object('sessions_ended',true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.student_term_registration_takeover(p_registration_number text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER
SET search_path TO 'private','pg_catalog'
AS $function$ SELECT private.tr_student_takeover(p_registration_number) $function$;

CREATE OR REPLACE FUNCTION private.tr_student_session_status(p_registration_number text,p_resume_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_catalog'
AS $function$
DECLARE v_reg public.term_registrations%rowtype;
BEGIN
  SELECT tr.* INTO v_reg FROM public.term_registrations tr
    JOIN public.students s ON s.id=tr.student_id
    JOIN public.academic_terms t ON t.id=tr.term_id
    WHERE s.registration_number::text=regexp_replace(coalesce(p_registration_number,''),'\D','','g')
      AND s.is_active AND t.registration_is_open;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','closed'); END IF;
  IF v_reg.resume_token_hash IS NULL OR private.tr_token_hash(p_resume_token)<>v_reg.resume_token_hash THEN
    RETURN jsonb_build_object('status','unauthorized','message','This session has ended. Registration is continuing in another page or browser.');
  END IF;
  IF v_reg.student_locked OR v_reg.student_submitted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status','locked');
  END IF;
  RETURN jsonb_build_object('status','success');
END;
$function$;

CREATE OR REPLACE FUNCTION public.student_term_registration_session_status(p_registration_number text,p_resume_token text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER
SET search_path TO 'private','pg_catalog'
AS $function$ SELECT private.tr_student_session_status(p_registration_number,p_resume_token) $function$;

REVOKE ALL ON FUNCTION private.tr_student_takeover(text),private.tr_student_session_status(text,text),
  public.student_term_registration_takeover(text),public.student_term_registration_session_status(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.tr_student_takeover(text),private.tr_student_session_status(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.student_term_registration_takeover(text),public.student_term_registration_session_status(text,text) TO anon,authenticated,service_role;

NOTIFY pgrst,'reload schema';
CREATE OR REPLACE FUNCTION private.fee_dashboard_for_term(p_term_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_term public.academic_terms%rowtype;
  v_rows jsonb;
begin
  select * into v_term from public.academic_terms where id=p_term_id;
  if not found then
    return jsonb_build_object('status','not_found','message','Academic term not found.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'registration_id',tr.id,
    'student_id',tr.student_id,
    'student_name',tr.student_name_snapshot,
    'registration_number',tr.registration_number_snapshot,
    'class_year',tr.class_year_snapshot,
    'student_email',nullif(btrim(coalesce(tr.student_answers->>'student_email','')),''),
    'fees_paid',coalesce(fs.fees_paid,false),
    'outstanding_balance',coalesce(fs.outstanding_balance,0),
    'arrears_previous_terms',coalesce(fs.arrears_previous_terms,0),
    'amount_paid_current_term',coalesce(fs.amount_paid_current_term,0),
    'payment_plan',fs.payment_plan,
    'notes',fs.notes,
    'notice_text',fs.notice_text,
    'notice_source_date',fs.notice_source_date,
    'notice_source_row',fs.notice_source_row,
    'notice_export_name',fs.notice_export_name,
    'notice_last_queued_at',fs.notice_last_queued_at,
    'notice_last_sent_at',fs.notice_last_sent_at,
    'notice_last_recipient',fs.notice_last_recipient,
    'notice_last_delivery_status',fs.notice_last_delivery_status,
    'notice_last_error',fs.notice_last_error,
    'notice_sent_count',delivery.sent_count,
    'notice_history',delivery.history,
    'fee_status',case
      when fs.student_id is null then 'not_recorded'
      when coalesce(fs.fees_paid,false) or coalesce(fs.outstanding_balance,0)<=0 then 'paid'
      else 'arrears'
    end,
    'send_eligible',(
      fs.student_id is not null
      and not coalesce(fs.fees_paid,false)
      and coalesce(fs.outstanding_balance,0)>0
      and nullif(btrim(coalesce(fs.notice_text,'')),'') is not null
      and lower(btrim(coalesce(tr.student_answers->>'student_email',''))) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    )
  ) order by tr.student_name_snapshot),'[]'::jsonb)
  into v_rows
  from public.term_registrations tr
  left join public.student_term_fee_status fs
    on fs.student_id=tr.student_id and fs.term_id=tr.term_id
  left join lateral (
    select (select count(*) from private.fee_notice_outbox o
      where o.student_id=tr.student_id and o.term_id=tr.term_id and not o.is_test and o.status='sent') as sent_count,
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',h.id,'status',h.status,'created_at',h.created_at,'sent_at',h.sent_at,
        'recipient_email',h.recipient_email,'last_error',h.last_error,
        'requested_by_role',h.requested_by_role,'requested_by_name',h.requested_by_name
      ) order by h.created_at desc,h.id desc)
      from (select o.* from private.fee_notice_outbox o
        where o.student_id=tr.student_id and o.term_id=tr.term_id and not o.is_test
        order by o.created_at desc,o.id desc limit 20) h),'[]'::jsonb) as history
  ) delivery on true
  where tr.term_id=v_term.id;

  return jsonb_build_object(
    'status','success',
    'selected_term',jsonb_build_object(
      'id',v_term.id,'term_name',v_term.term_name,'academic_year',v_term.academic_year,
      'term_number',v_term.term_number,'fees_due_date',v_term.fees_due_date
    ),
    'registrations',v_rows
  );
end;
$function$

