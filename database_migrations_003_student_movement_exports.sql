-- AMFCC Student Services Platform v4
-- Student movement status exports for current status, 24 hours, 3 days and 7 days.

CREATE OR REPLACE FUNCTION public.student_movements_export(
  p_pin text,
  p_period text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_period text := lower(trim(coalesce(p_period,'current_status')));
  v_start timestamptz;
  v_label text;
  v_rows jsonb;
  v_total integer;
  v_on_campus integer;
  v_bed_rest integer;
  v_on_gate_pass integer;
BEGIN
  IF p_pin NOT IN ('0593','1960') THEN
    RETURN jsonb_build_object('status','unauthorized','message','Incorrect password.');
  END IF;

  CASE v_period
    WHEN 'current_status' THEN
      v_start := NULL;
      v_label := 'Current status';
    WHEN 'last_24_hours' THEN
      v_start := now() - interval '24 hours';
      v_label := 'Last 24 hours';
    WHEN 'last_3_days' THEN
      v_start := now() - interval '3 days';
      v_label := 'Last 3 days';
    WHEN 'past_week' THEN
      v_start := now() - interval '7 days';
      v_label := 'Past week';
    ELSE
      RETURN jsonb_build_object(
        'status','invalid',
        'message','Choose current_status, last_24_hours, last_3_days or past_week.'
      );
  END CASE;

  WITH latest_all AS (
    SELECT DISTINCT ON (cm.student_id)
      cm.student_id,
      cm.direction,
      cm.scanned_at,
      cm.checkout_destination_label,
      cm.gate_pass_id
    FROM public.campus_movements cm
    ORDER BY cm.student_id,cm.scanned_at DESC,cm.id DESC
  ), period_stats AS (
    SELECT
      cm.student_id,
      count(*)::integer AS movement_count,
      max(cm.scanned_at) AS last_movement_at
    FROM public.campus_movements cm
    WHERE v_start IS NOT NULL AND cm.scanned_at >= v_start
    GROUP BY cm.student_id
  ), period_last AS (
    SELECT DISTINCT ON (cm.student_id)
      cm.student_id,
      cm.direction,
      cm.scanned_at,
      cm.checkout_destination_label
    FROM public.campus_movements cm
    WHERE v_start IS NULL OR cm.scanned_at >= v_start
    ORDER BY cm.student_id,cm.scanned_at DESC,cm.id DESC
  ), active_bed_rest AS (
    SELECT DISTINCT ON (x.student_id)
      x.student_id,x.started_at,x.notes
    FROM public.student_support_statuses x
    WHERE x.status_type='bed_rest' AND x.is_active=true
    ORDER BY x.student_id,x.started_at DESC,x.id DESC
  ), active_maternity AS (
    SELECT DISTINCT ON (x.student_id)
      x.student_id,x.started_at
    FROM public.student_support_statuses x
    WHERE x.status_type='maternity' AND x.is_active=true
    ORDER BY x.student_id,x.started_at DESC,x.id DESC
  ), current_pass AS (
    SELECT DISTINCT ON (p.student_id)
      p.student_id,p.id,p.status,p.destination,p.departure_at,
      p.expected_return_at,p.actual_departure_at,
      (p.status='departed' AND p.expected_return_at<now()) AS overdue
    FROM public.gate_passes p
    WHERE p.status IN ('departed','approved')
    ORDER BY p.student_id,
             CASE WHEN p.status='departed' THEN 0 ELSE 1 END,
             coalesce(p.actual_departure_at,p.departure_at) DESC,
             p.submitted_at DESC
  ), current_accommodation AS (
    SELECT DISTINCT ON (a.student_id)
      a.student_id,a.residence,a.room,a.bed
    FROM public.accommodation_allocations a
    WHERE a.is_active=true
    ORDER BY a.student_id,a.allocated_at DESC,a.id DESC
  ), report_rows AS (
    SELECT
      s.registration_number,
      s.full_name AS student_name,
      CASE coalesce(la.direction,'UNKNOWN')
        WHEN 'IN' THEN 'On Campus'
        WHEN 'OUT' THEN 'Off Campus'
        ELSE 'Unknown'
      END AS current_campus_status,
      CASE WHEN la.direction='IN' THEN 'Yes' ELSE 'No' END AS on_campus,
      la.scanned_at AS latest_movement_at,
      la.direction AS latest_movement_direction,
      coalesce(la.checkout_destination_label,'') AS latest_checkout_destination,
      CASE WHEN br.student_id IS NOT NULL THEN 'Yes' ELSE 'No' END AS on_bed_rest,
      br.started_at AS bed_rest_started_at,
      CASE WHEN mat.student_id IS NOT NULL THEN 'Yes' ELSE 'No' END AS maternity,
      CASE WHEN cp.status='departed' THEN 'Yes' ELSE 'No' END AS on_gate_pass,
      coalesce(initcap(cp.status),'None') AS gate_pass_status,
      coalesce(cp.destination,'') AS gate_pass_destination,
      cp.departure_at AS gate_pass_departure_at,
      cp.expected_return_at AS gate_pass_expected_return_at,
      CASE WHEN coalesce(cp.overdue,false) THEN 'Yes' ELSE 'No' END AS gate_pass_overdue,
      CASE
        WHEN v_period='current_status' THEN NULL
        ELSE coalesce(ps.movement_count,0)
      END AS movements_in_period,
      CASE
        WHEN v_period='current_status' THEN la.scanned_at
        ELSE pl.scanned_at
      END AS last_movement_in_period,
      CASE
        WHEN v_period='current_status' THEN la.direction
        ELSE pl.direction
      END AS last_direction_in_period,
      CASE
        WHEN v_period='current_status' THEN coalesce(la.checkout_destination_label,'')
        ELSE coalesce(pl.checkout_destination_label,'')
      END AS last_destination_in_period,
      coalesce(ca.residence,'') AS residence,
      coalesce(ca.room,'') AS room,
      coalesce(ca.bed,'') AS bed
    FROM public.students s
    LEFT JOIN latest_all la ON la.student_id=s.id
    LEFT JOIN period_stats ps ON ps.student_id=s.id
    LEFT JOIN period_last pl ON pl.student_id=s.id
    LEFT JOIN active_bed_rest br ON br.student_id=s.id
    LEFT JOIN active_maternity mat ON mat.student_id=s.id
    LEFT JOIN current_pass cp ON cp.student_id=s.id
    LEFT JOIN current_accommodation ca ON ca.student_id=s.id
    WHERE s.is_active=true
  )
  SELECT
    count(*)::integer,
    count(*) FILTER(WHERE on_campus='Yes')::integer,
    count(*) FILTER(WHERE on_bed_rest='Yes')::integer,
    count(*) FILTER(WHERE on_gate_pass='Yes')::integer,
    coalesce(
      jsonb_agg(
        to_jsonb(report_rows)
        ORDER BY
          CASE WHEN on_gate_pass='Yes' THEN 0 ELSE 1 END,
          CASE WHEN on_bed_rest='Yes' THEN 0 ELSE 1 END,
          CASE WHEN on_campus='Yes' THEN 0 ELSE 1 END,
          student_name
      ),
      '[]'::jsonb
    )
  INTO v_total,v_on_campus,v_bed_rest,v_on_gate_pass,v_rows
  FROM report_rows;

  INSERT INTO public.audit_log
    (event_type,entity_type,entity_id,actor_role,action,details)
  VALUES
    ('report_export','student_movements',v_period,
     CASE WHEN p_pin='0593' THEN 'management' ELSE 'student_leadership' END,
     'exported',
     jsonb_build_object('period',v_period,'period_start',v_start,'row_count',v_total));

  RETURN jsonb_build_object(
    'status','success',
    'report','student_movements',
    'period',v_period,
    'period_label',v_label,
    'period_start',v_start,
    'generated_at',now(),
    'summary',jsonb_build_object(
      'active_students',v_total,
      'on_campus',v_on_campus,
      'on_bed_rest',v_bed_rest,
      'on_gate_pass',v_on_gate_pass
    ),
    'rows',v_rows
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.student_movements_export(text,text) TO anon,authenticated;
