-- Gate-pass rejection and cancellation comments are optional.
-- Empty comments remain stored as NULL while the decision and audit history are retained.

CREATE OR REPLACE FUNCTION public.admin_review_gate_pass(p_pin text, p_pass_id uuid, p_departure_at timestamp with time zone, p_expected_return_at timestamp with time zone, p_decision text DEFAULT NULL::text, p_comments text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_auth jsonb;
  v_pass public.gate_passes%rowtype;
  v_old_status text;
  v_new_status text;
  v_admin boolean;
  v_senior boolean;
  v_holiday boolean := false;
  v_schedule_changed boolean;
BEGIN
  v_auth:=public.admin_services_dashboard(p_pin,NULL);
  IF coalesce(v_auth->>'status','')<>'success' THEN
    RETURN jsonb_build_object('status','unauthorized','message','School Administration password required.');
  END IF;

  IF p_decision IS NOT NULL AND p_decision NOT IN ('approved','rejected','cancelled') THEN
    RETURN jsonb_build_object('status','invalid','message','Choose Approve, Reject or Cancel.');
  END IF;


  IF p_departure_at IS NULL OR p_expected_return_at IS NULL OR p_expected_return_at<=p_departure_at THEN
    RETURN jsonb_build_object('status','invalid','message','Expected return must be later than departure.');
  END IF;

  IF p_expected_return_at<=now() THEN
    RETURN jsonb_build_object('status','invalid','message','Expected return must be in the future.');
  END IF;

  SELECT * INTO v_pass FROM public.gate_passes WHERE id=p_pass_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','message','Gate pass not found.'); END IF;

  IF v_pass.status IN ('departed','returned','expired') THEN
    RETURN jsonb_build_object('status','invalid','message','Dates cannot be changed after travel has started or finished.');
  END IF;

  IF EXISTS(
    WITH current_people AS (
      SELECT student_id FROM public.gate_pass_members WHERE pass_id=p_pass_id
    )
    SELECT 1
    FROM current_people cp
    JOIN public.gate_pass_members other_member ON other_member.student_id=cp.student_id
    JOIN public.gate_passes other_pass ON other_pass.id=other_member.pass_id
    WHERE other_pass.id<>p_pass_id
      AND other_pass.status IN ('pending','approved','departed')
      AND tstzrange(other_pass.departure_at,other_pass.expected_return_at,'[]')
          && tstzrange(p_departure_at,p_expected_return_at,'[]')
  ) THEN
    RETURN jsonb_build_object('status','schedule_conflict','message','One of the people on this pass has another active pass that overlaps these dates.');
  END IF;

  v_old_status:=v_pass.status;
  v_schedule_changed:=v_pass.departure_at IS DISTINCT FROM p_departure_at OR v_pass.expected_return_at IS DISTINCT FROM p_expected_return_at;

  UPDATE public.gate_passes
  SET departure_at=p_departure_at,expected_return_at=p_expected_return_at,updated_at=now()
  WHERE id=p_pass_id;

  IF p_decision IS NULL THEN
    INSERT INTO public.audit_log(event_type,entity_type,entity_id,actor_role,action,details)
    VALUES('gate_pass','gate_pass',p_pass_id::text,'administrator','schedule_updated',jsonb_build_object(
      'old_departure_at',v_pass.departure_at,'new_departure_at',p_departure_at,
      'old_expected_return_at',v_pass.expected_return_at,'new_expected_return_at',p_expected_return_at,
      'comments',p_comments
    ));
    RETURN jsonb_build_object('status','success','pass_id',p_pass_id,'pass_status',v_old_status,'schedule_updated',v_schedule_changed,'decision',NULL);
  END IF;

  INSERT INTO public.gate_pass_approvals(pass_id,approver_role,decision,comments,decided_at)
  VALUES(p_pass_id,'administrator',p_decision,nullif(trim(coalesce(p_comments,'')),''),now())
  ON CONFLICT(pass_id,approver_role) DO UPDATE
  SET decision=excluded.decision,comments=excluded.comments,decided_at=excluded.decided_at;

  SELECT coalesce((setting_value #>> '{}')::boolean,false) INTO v_holiday
  FROM public.system_settings WHERE setting_key='school_holiday_mode';

  IF p_decision='cancelled' THEN
    v_new_status:='cancelled';
    UPDATE public.gate_passes SET status=v_new_status,cancelled_at=now(),cancelled_by_role='administrator',cancellation_reason=nullif(trim(coalesce(p_comments,'')),''),updated_at=now() WHERE id=p_pass_id;
  ELSIF p_decision='rejected' THEN
    v_new_status:='rejected';
    UPDATE public.gate_passes SET status=v_new_status,updated_at=now() WHERE id=p_pass_id;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.gate_pass_approvals WHERE pass_id=p_pass_id AND approver_role='administrator' AND decision='approved') INTO v_admin;
    SELECT EXISTS(SELECT 1 FROM public.gate_pass_approvals WHERE pass_id=p_pass_id AND approver_role IN ('principal','dean','director') AND decision='approved') INTO v_senior;
    IF v_admin AND (v_holiday OR v_senior) THEN
      v_new_status:='approved';
      UPDATE public.gate_passes SET status='approved',final_approved_at=coalesce(final_approved_at,now()),updated_at=now() WHERE id=p_pass_id;
    ELSE
      v_new_status:='pending';
      UPDATE public.gate_passes SET status='pending',updated_at=now() WHERE id=p_pass_id;
    END IF;
  END IF;

  INSERT INTO public.gate_pass_status_history(pass_id,previous_status,new_status,actor_role,notes)
  VALUES(p_pass_id,v_old_status,v_new_status,'administrator',concat_ws(' ',nullif(trim(coalesce(p_comments,'')),''),CASE WHEN v_schedule_changed THEN 'Departure or return time was updated during review.' END));

  INSERT INTO public.audit_log(event_type,entity_type,entity_id,actor_role,action,details)
  VALUES('gate_pass','gate_pass',p_pass_id::text,'administrator',p_decision,jsonb_build_object(
    'previous_status',v_old_status,'new_status',v_new_status,'comments',p_comments,
    'school_holiday_mode',v_holiday,'schedule_updated',v_schedule_changed,
    'old_departure_at',v_pass.departure_at,'new_departure_at',p_departure_at,
    'old_expected_return_at',v_pass.expected_return_at,'new_expected_return_at',p_expected_return_at
  ));

  RETURN jsonb_build_object('status','success','pass_id',p_pass_id,'pass_status',v_new_status,'actor_role','administrator','decision',p_decision,'schedule_updated',v_schedule_changed,'school_holiday_mode',v_holiday);
END;
$function$
;
