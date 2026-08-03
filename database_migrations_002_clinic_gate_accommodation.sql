-- AMFCC Student Services Platform v3
-- Adds maternity and clinic bed-rest statuses, accommodation basics,
-- controlled non-pass checkout destinations, and two dashboard access levels.

-- 1. Remove withdrawn students and related operational records.
DO $$
DECLARE
  v_student_ids text[];
BEGIN
  SELECT array_agg(id) INTO v_student_ids
  FROM public.students
  WHERE registration_number IN (26024, 26025);

  IF v_student_ids IS NOT NULL THEN
    DELETE FROM public.audit_log
    WHERE entity_type = 'student' AND entity_id = ANY(v_student_ids);

    DELETE FROM public.gate_passes WHERE student_id = ANY(v_student_ids);
    DELETE FROM public.gate_duty_records WHERE student_id = ANY(v_student_ids);
    DELETE FROM public.campus_movements WHERE student_id = ANY(v_student_ids);
    DELETE FROM public.check_ins WHERE student_id = ANY(v_student_ids);
    DELETE FROM public.students WHERE id = ANY(v_student_ids);
  END IF;
END $$;

-- 2. Student support statuses, including maternity and bed rest.
CREATE TABLE IF NOT EXISTS public.student_support_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  status_type text NOT NULL CHECK (status_type IN ('maternity','bed_rest','other')),
  status_label text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expected_end_at timestamptz,
  ended_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  set_by_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS student_support_statuses_one_active_type
ON public.student_support_statuses(student_id, status_type)
WHERE is_active = true;

ALTER TABLE public.student_support_statuses ENABLE ROW LEVEL SECURITY;

-- 3. Basic accommodation allocation structure.
CREATE TABLE IF NOT EXISTS public.accommodation_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id text NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  residence text NOT NULL,
  room text,
  bed text,
  term_label text,
  allocation_status text NOT NULL DEFAULT 'allocated'
    CHECK (allocation_status IN ('waiting','allocated','checked_in','checked_out','cancelled')),
  is_active boolean NOT NULL DEFAULT true,
  allocated_by_role text,
  allocated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS accommodation_allocations_one_active
ON public.accommodation_allocations(student_id)
WHERE is_active = true;

ALTER TABLE public.accommodation_allocations ENABLE ROW LEVEL SECURITY;

-- 4. Store approved non-pass checkout destinations on movement records.
ALTER TABLE public.campus_movements
  ADD COLUMN IF NOT EXISTS checkout_destination_code text,
  ADD COLUMN IF NOT EXISTS checkout_destination_label text;

ALTER TABLE public.campus_movements
  DROP CONSTRAINT IF EXISTS campus_movements_movement_source_check;

ALTER TABLE public.campus_movements
  ADD CONSTRAINT campus_movements_movement_source_check
  CHECK (movement_source IN ('scanner','camera','manual','administrative_update'));

-- 5. Apply current maternity and accommodation information.
INSERT INTO public.student_support_statuses
  (student_id,status_type,status_label,started_at,is_active,notes,set_by_role)
SELECT s.id,'maternity','Maternity',now(),true,
       'Off campus for the foreseeable future.','management'
FROM public.students s
WHERE s.registration_number IN (26045,26061,26062)
  AND NOT EXISTS (
    SELECT 1 FROM public.student_support_statuses x
    WHERE x.student_id=s.id AND x.status_type='maternity' AND x.is_active=true
  );

INSERT INTO public.accommodation_allocations
  (student_id,residence,term_label,allocation_status,is_active,allocated_by_role,notes)
SELECT s.id,'Bhagi','Term 2 2026','allocated',true,'management',
       'Confirmed by AMFCC administration.'
FROM public.students s
WHERE s.registration_number=25005
  AND NOT EXISTS (
    SELECT 1 FROM public.accommodation_allocations a
    WHERE a.student_id=s.id AND a.is_active=true
  );

-- 6. Correct current campus status for maternity, Shilla Shomai and Chapwanya.
WITH device AS (
  SELECT id FROM public.gate_devices WHERE is_active=true ORDER BY created_at NULLS LAST LIMIT 1
), targets AS (
  SELECT s.id,
         CASE WHEN s.registration_number=25005 THEN 'IN' ELSE 'OUT' END AS required_direction
  FROM public.students s
  WHERE s.registration_number IN (25005,26045,26054,26061,26062)
), latest AS (
  SELECT DISTINCT ON (cm.student_id) cm.student_id,cm.direction
  FROM public.campus_movements cm
  JOIN targets t ON t.id=cm.student_id
  ORDER BY cm.student_id,cm.scanned_at DESC,cm.id DESC
)
INSERT INTO public.campus_movements
  (student_id,direction,gate_device_id,movement_source,correction_note)
SELECT t.id,t.required_direction,d.id,'administrative_update',
       CASE WHEN t.required_direction='IN'
            THEN 'Accommodation correction: student confirmed in Bhagi.'
            ELSE 'Administrative campus-status correction.' END
FROM targets t
CROSS JOIN device d
LEFT JOIN latest l ON l.student_id=t.id
WHERE l.direction IS DISTINCT FROM t.required_direction;

-- 7. Gate checkout enforcement with three approved no-pass destinations.
DROP FUNCTION IF EXISTS public.gate_record_movement_v3(text,text,text,text);

CREATE OR REPLACE FUNCTION public.gate_record_movement_v3(
  p_device_token text,
  p_registration_number text,
  p_direction text,
  p_source text DEFAULT 'scanner',
  p_checkout_option text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
DECLARE
  v_device public.gate_devices%rowtype;
  v_student public.students%rowtype;
  v_last public.campus_movements%rowtype;
  v_pass public.gate_passes%rowtype;
  v_pilot boolean;
  v_pass_message text;
  v_has_pass boolean := false;
  v_checkout_code text;
  v_checkout_label text;
  v_source text := lower(coalesce(p_source,'scanner'));
BEGIN
  SELECT * INTO v_device
  FROM public.gate_devices
  WHERE token_hash=encode(digest(p_device_token,'sha256'),'hex')
    AND is_active=true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','unauthorized','message','This device is not authorised for gate scanning.');
  END IF;

  IF upper(p_direction) NOT IN ('IN','OUT') THEN
    RETURN jsonb_build_object('status','invalid_direction','message','Choose IN or OUT.');
  END IF;

  IF v_source NOT IN ('scanner','manual') THEN v_source:='scanner'; END IF;

  SELECT * INTO v_student
  FROM public.students
  WHERE registration_number::text=regexp_replace(coalesce(p_registration_number,''),'\D','','g')
    AND is_active=true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found','message','Student not found.');
  END IF;

  SELECT * INTO v_last
  FROM public.campus_movements
  WHERE student_id=v_student.id
  ORDER BY scanned_at DESC,id DESC
  LIMIT 1;

  IF FOUND AND v_last.direction=upper(p_direction) THEN
    IF v_last.scanned_at>now()-interval '30 seconds' THEN
      RETURN jsonb_build_object(
        'status','duplicate','message','Duplicate scan ignored.',
        'student_name',v_student.full_name,
        'registration_number',v_student.registration_number,
        'direction',v_last.direction,
        'last_scanned_at',v_last.scanned_at
      );
    END IF;

    RETURN jsonb_build_object(
      'status','same_status',
      'message',CASE WHEN upper(p_direction)='IN'
                     THEN 'Student is already marked on campus.'
                     ELSE 'Student is already marked off campus.' END,
      'student_name',v_student.full_name,
      'registration_number',v_student.registration_number,
      'direction',v_last.direction,
      'last_scanned_at',v_last.scanned_at
    );
  END IF;

  IF upper(p_direction)='OUT' THEN
    SELECT * INTO v_pass
    FROM public.gate_passes
    WHERE student_id=v_student.id
      AND status='approved'
      AND departure_at BETWEEN now()-interval '12 hours' AND now()+interval '12 hours'
      AND expected_return_at>now()
    ORDER BY departure_at
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.gate_passes
      SET status='departed',actual_departure_at=now(),updated_at=now()
      WHERE id=v_pass.id;

      INSERT INTO public.gate_pass_status_history
        (pass_id,previous_status,new_status,actor_role,notes)
      VALUES
        (v_pass.id,'approved','departed','gate_terminal','Student scanned out at the gate.');

      v_has_pass:=true;
      v_checkout_label:=v_pass.destination;
      v_pass_message:='Personal gate pass verified.';
    ELSE
      v_checkout_code:=trim(coalesce(p_checkout_option,''));
      v_checkout_label:=CASE v_checkout_code
        WHEN '1' THEN 'Tanaka/Amalinda Shops'
        WHEN '2' THEN 'MDH'
        WHEN '3' THEN 'Town/Other'
        ELSE NULL
      END;

      IF v_checkout_label IS NULL THEN
        RETURN jsonb_build_object(
          'status','destination_required',
          'message','No approved gate pass. Select 1, 2 or 3 before scanning again.',
          'student_name',v_student.full_name,
          'registration_number',v_student.registration_number,
          'direction','OUT',
          'options',jsonb_build_array(
            jsonb_build_object('code','1','label','Tanaka/Amalinda Shops'),
            jsonb_build_object('code','2','label','MDH'),
            jsonb_build_object('code','3','label','Town/Other')
          )
        );
      END IF;

      v_pass_message:='Checked out to '||v_checkout_label||' without a personal gate pass.';
    END IF;
  ELSE
    SELECT * INTO v_pass
    FROM public.gate_passes
    WHERE student_id=v_student.id AND status='departed'
    ORDER BY actual_departure_at DESC NULLS LAST,departure_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.gate_passes
      SET status='returned',actual_return_at=now(),updated_at=now()
      WHERE id=v_pass.id;

      INSERT INTO public.gate_pass_status_history
        (pass_id,previous_status,new_status,actor_role,notes)
      VALUES
        (v_pass.id,'departed','returned','gate_terminal','Student scanned back in at the gate.');

      v_has_pass:=true;
      v_pass_message:='Return linked to the personal gate pass.';
    ELSE
      v_pass_message:='Campus movement recorded.';
    END IF;
  END IF;

  INSERT INTO public.campus_movements
    (student_id,direction,gate_device_id,movement_source,gate_pass_id,
     checkout_destination_code,checkout_destination_label)
  VALUES
    (v_student.id,upper(p_direction),v_device.id,v_source,
     CASE WHEN v_has_pass THEN v_pass.id ELSE NULL END,
     v_checkout_code,v_checkout_label);

  UPDATE public.gate_devices SET last_seen_at=now() WHERE id=v_device.id;

  SELECT coalesce((setting_value #>> '{}')::boolean,false) INTO v_pilot
  FROM public.system_settings WHERE setting_key='gate_pass_pilot_mode';

  INSERT INTO public.audit_log
    (event_type,entity_type,entity_id,actor_role,action,details)
  VALUES
    ('campus_movement','student',v_student.id,'gate_terminal',lower(p_direction),
     jsonb_build_object(
       'device_id',v_device.id,
       'source',v_source,
       'gate_pass_id',CASE WHEN v_has_pass THEN v_pass.id ELSE NULL END,
       'checkout_destination_code',v_checkout_code,
       'checkout_destination_label',v_checkout_label
     ));

  RETURN jsonb_build_object(
    'status','success',
    'message',v_pass_message,
    'student_name',v_student.full_name,
    'registration_number',v_student.registration_number,
    'direction',upper(p_direction),
    'scanned_at',now(),
    'gate_pass_id',CASE WHEN v_has_pass THEN v_pass.id ELSE NULL END,
    'gate_pass_status',CASE WHEN v_has_pass THEN 'verified' ELSE 'not_linked' END,
    'checkout_destination_code',v_checkout_code,
    'checkout_destination_label',v_checkout_label,
    'paper_pass_pilot_mode',v_pilot
  );
END;
$$;

-- 8. Clinic functions.
CREATE OR REPLACE FUNCTION public.clinic_search_students(
  p_pin text,
  p_query text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_students jsonb;
  v_query text := trim(coalesce(p_query,''));
BEGIN
  IF p_pin <> '1957' THEN
    RETURN jsonb_build_object('status','unauthorized','message','Incorrect clinic password.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'student_id',q.id,
    'registration_number',q.registration_number,
    'student_name',q.full_name,
    'on_bed_rest',q.on_bed_rest,
    'bed_rest_started_at',q.started_at,
    'bed_rest_notes',q.notes,
    'campus_status',q.campus_status,
    'residence',q.residence,
    'room',q.room
  ) ORDER BY q.full_name),'[]'::jsonb)
  INTO v_students
  FROM (
    SELECT s.id,s.registration_number,s.full_name,
           (br.id IS NOT NULL) AS on_bed_rest,
           br.started_at,br.notes,
           coalesce(cm.direction,'UNKNOWN') AS campus_status,
           aa.residence,aa.room
    FROM public.students s
    LEFT JOIN LATERAL (
      SELECT x.id,x.started_at,x.notes
      FROM public.student_support_statuses x
      WHERE x.student_id=s.id AND x.status_type='bed_rest' AND x.is_active=true
      ORDER BY x.started_at DESC LIMIT 1
    ) br ON true
    LEFT JOIN LATERAL (
      SELECT m.direction
      FROM public.campus_movements m
      WHERE m.student_id=s.id
      ORDER BY m.scanned_at DESC,m.id DESC LIMIT 1
    ) cm ON true
    LEFT JOIN LATERAL (
      SELECT a.residence,a.room
      FROM public.accommodation_allocations a
      WHERE a.student_id=s.id AND a.is_active=true
      ORDER BY a.allocated_at DESC LIMIT 1
    ) aa ON true
    WHERE s.is_active=true
      AND (
        v_query='' OR
        s.full_name ILIKE '%'||v_query||'%' OR
        (regexp_replace(v_query,'\D','','g')<>'' AND s.registration_number::text LIKE '%'||regexp_replace(v_query,'\D','','g')||'%')
      )
    ORDER BY s.full_name
    LIMIT 80
  ) q;

  RETURN jsonb_build_object('status','success','students',v_students);
END;
$$;

CREATE OR REPLACE FUNCTION public.clinic_set_bed_rest(
  p_pin text,
  p_registration_number text,
  p_action text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_student public.students%rowtype;
  v_action text := lower(trim(coalesce(p_action,'')));
BEGIN
  IF p_pin <> '1957' THEN
    RETURN jsonb_build_object('status','unauthorized','message','Incorrect clinic password.');
  END IF;

  SELECT * INTO v_student
  FROM public.students
  WHERE registration_number::text=regexp_replace(coalesce(p_registration_number,''),'\D','','g')
    AND is_active=true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found','message','Student not found.');
  END IF;

  IF v_action='start' THEN
    UPDATE public.student_support_statuses
    SET status_label='Bed Rest',started_at=now(),expected_end_at=NULL,ended_at=NULL,
        is_active=true,notes=nullif(trim(coalesce(p_notes,'')),''),
        set_by_role='clinic',updated_at=now()
    WHERE student_id=v_student.id AND status_type='bed_rest' AND is_active=true;

    IF NOT FOUND THEN
      INSERT INTO public.student_support_statuses
        (student_id,status_type,status_label,started_at,is_active,notes,set_by_role)
      VALUES
        (v_student.id,'bed_rest','Bed Rest',now(),true,
         nullif(trim(coalesce(p_notes,'')),''),'clinic');
    END IF;

    INSERT INTO public.audit_log
      (event_type,entity_type,entity_id,actor_role,action,details)
    VALUES
      ('clinic','student',v_student.id,'clinic','bed_rest_started',
       jsonb_build_object('notes',p_notes));

    RETURN jsonb_build_object(
      'status','success','message','Student placed on bed rest.',
      'student_name',v_student.full_name,
      'registration_number',v_student.registration_number,
      'on_bed_rest',true
    );
  ELSIF v_action='clear' THEN
    UPDATE public.student_support_statuses
    SET is_active=false,ended_at=now(),updated_at=now()
    WHERE student_id=v_student.id AND status_type='bed_rest' AND is_active=true;

    INSERT INTO public.audit_log
      (event_type,entity_type,entity_id,actor_role,action,details)
    VALUES
      ('clinic','student',v_student.id,'clinic','bed_rest_cleared',
       jsonb_build_object('notes',p_notes));

    RETURN jsonb_build_object(
      'status','success','message','Student removed from bed rest.',
      'student_name',v_student.full_name,
      'registration_number',v_student.registration_number,
      'on_bed_rest',false
    );
  ELSE
    RETURN jsonb_build_object('status','invalid','message','Choose start or clear.');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.clinic_active_bed_rest(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_rows jsonb;
BEGIN
  IF p_pin <> '1957' THEN
    RETURN jsonb_build_object('status','unauthorized','message','Incorrect clinic password.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'student_id',s.id,
    'registration_number',s.registration_number,
    'student_name',s.full_name,
    'started_at',x.started_at,
    'notes',x.notes,
    'residence',aa.residence,
    'room',aa.room
  ) ORDER BY x.started_at DESC),'[]'::jsonb)
  INTO v_rows
  FROM public.student_support_statuses x
  JOIN public.students s ON s.id=x.student_id AND s.is_active=true
  LEFT JOIN LATERAL (
    SELECT a.residence,a.room
    FROM public.accommodation_allocations a
    WHERE a.student_id=s.id AND a.is_active=true
    ORDER BY a.allocated_at DESC LIMIT 1
  ) aa ON true
  WHERE x.status_type='bed_rest' AND x.is_active=true;

  RETURN jsonb_build_object('status','success','students',v_rows);
END;
$$;

-- 9. Administrative dashboard supports Management and Student Leadership passwords.
CREATE OR REPLACE FUNCTION public.student_services_dashboard(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_access_level text;
  v_students jsonb;
  v_recent jsonb;
  v_passes jsonb;
  v_duty jsonb;
  v_settings jsonb;
  v_on integer;
  v_off integer;
  v_unknown integer;
  v_pending integer;
  v_approved integer;
  v_overdue integer;
  v_bed_rest integer;
  v_maternity integer;
BEGIN
  v_access_level := CASE
    WHEN p_pin='0593' THEN 'management'
    WHEN p_pin='1960' THEN 'student_leadership'
    ELSE NULL
  END;

  IF v_access_level IS NULL THEN
    RETURN jsonb_build_object('status','unauthorized','message','Incorrect password.');
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (cm.student_id)
           cm.student_id,cm.direction,cm.scanned_at,gd.device_name,gd.location
    FROM public.campus_movements cm
    JOIN public.gate_devices gd ON gd.id=cm.gate_device_id
    ORDER BY cm.student_id,cm.scanned_at DESC,cm.id DESC
  ), roster AS (
    SELECT s.id,s.registration_number,s.full_name,
           coalesce(l.direction,'UNKNOWN') status,
           l.scanned_at,l.device_name,l.location,
           (br.id IS NOT NULL) AS bed_rest,
           br.started_at AS bed_rest_started_at,
           br.notes AS bed_rest_notes,
           (mat.id IS NOT NULL) AS maternity,
           aa.residence,aa.room,aa.bed,aa.allocation_status
    FROM public.students s
    LEFT JOIN latest l ON l.student_id=s.id
    LEFT JOIN LATERAL (
      SELECT x.id,x.started_at,x.notes
      FROM public.student_support_statuses x
      WHERE x.student_id=s.id AND x.status_type='bed_rest' AND x.is_active=true
      ORDER BY x.started_at DESC LIMIT 1
    ) br ON true
    LEFT JOIN LATERAL (
      SELECT x.id
      FROM public.student_support_statuses x
      WHERE x.student_id=s.id AND x.status_type='maternity' AND x.is_active=true
      ORDER BY x.started_at DESC LIMIT 1
    ) mat ON true
    LEFT JOIN LATERAL (
      SELECT a.residence,a.room,a.bed,a.allocation_status
      FROM public.accommodation_allocations a
      WHERE a.student_id=s.id AND a.is_active=true
      ORDER BY a.allocated_at DESC LIMIT 1
    ) aa ON true
    WHERE s.is_active=true
  )
  SELECT count(*) FILTER(WHERE status='IN'),
         count(*) FILTER(WHERE status='OUT'),
         count(*) FILTER(WHERE status='UNKNOWN'),
         count(*) FILTER(WHERE bed_rest),
         count(*) FILTER(WHERE maternity),
         coalesce(jsonb_agg(jsonb_build_object(
           'student_id',id,
           'registration_number',registration_number,
           'student_name',full_name,
           'status',status,
           'last_movement_at',scanned_at,
           'device_name',device_name,
           'location',location,
           'bed_rest',bed_rest,
           'bed_rest_started_at',bed_rest_started_at,
           'bed_rest_notes',bed_rest_notes,
           'maternity',maternity,
           'residence',residence,
           'room',room,
           'bed',bed,
           'accommodation_status',allocation_status
         ) ORDER BY full_name),'[]'::jsonb)
  INTO v_on,v_off,v_unknown,v_bed_rest,v_maternity,v_students
  FROM roster;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,
    'registration_number',x.registration_number,
    'student_name',x.full_name,
    'direction',x.direction,
    'scanned_at',x.scanned_at,
    'device_name',x.device_name,
    'location',x.location,
    'gate_pass_id',x.gate_pass_id,
    'checkout_destination_code',x.checkout_destination_code,
    'checkout_destination_label',x.checkout_destination_label
  ) ORDER BY x.scanned_at DESC),'[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT cm.id,s.registration_number,s.full_name,cm.direction,cm.scanned_at,
           gd.device_name,gd.location,cm.gate_pass_id,
           cm.checkout_destination_code,cm.checkout_destination_label
    FROM public.campus_movements cm
    JOIN public.students s ON s.id=cm.student_id
    JOIN public.gate_devices gd ON gd.id=cm.gate_device_id
    ORDER BY cm.scanned_at DESC,cm.id DESC
    LIMIT 150
  ) x;

  SELECT count(*) FILTER(WHERE status='pending'),
         count(*) FILTER(WHERE status='approved'),
         count(*) FILTER(WHERE status='departed' AND expected_return_at<now())
  INTO v_pending,v_approved,v_overdue
  FROM public.gate_passes;

  SELECT coalesce(jsonb_agg(item ORDER BY submitted_at DESC),'[]'::jsonb)
  INTO v_passes
  FROM (
    SELECT p.submitted_at,
      jsonb_build_object(
        'id',p.id,
        'student_id',p.student_id,
        'student_name',s.full_name,
        'registration_number',s.registration_number,
        'destination',p.destination,
        'reason',p.reason,
        'contact_details',p.contact_details,
        'departure_at',p.departure_at,
        'expected_return_at',p.expected_return_at,
        'submitted_at',p.submitted_at,
        'status',p.status,
        'final_approved_at',p.final_approved_at,
        'actual_departure_at',p.actual_departure_at,
        'actual_return_at',p.actual_return_at,
        'paper_pass_checked',p.paper_pass_checked,
        'cancellation_reason',p.cancellation_reason,
        'overdue',(p.status='departed' AND p.expected_return_at<now()),
        'approvals',coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'role',a.approver_role,
            'decision',a.decision,
            'comments',a.comments,
            'decided_at',a.decided_at
          ) ORDER BY a.decided_at)
          FROM public.gate_pass_approvals a
          WHERE a.pass_id=p.id
        ),'[]'::jsonb),
        'waiting_on',CASE
          WHEN p.status<>'pending' THEN NULL
          WHEN NOT EXISTS(
            SELECT 1 FROM public.gate_pass_approvals a
            WHERE a.pass_id=p.id AND a.approver_role='administrator' AND a.decision='approved'
          ) THEN 'School Administrator'
          WHEN NOT EXISTS(
            SELECT 1 FROM public.gate_pass_approvals a
            WHERE a.pass_id=p.id AND a.approver_role IN ('principal','dean','director') AND a.decision='approved'
          ) THEN 'Principal, Dean or Director'
          ELSE NULL
        END
      ) item
    FROM public.gate_passes p
    JOIN public.students s ON s.id=p.student_id
    ORDER BY p.submitted_at DESC
    LIMIT 300
  ) q;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,
    'student_name',x.full_name,
    'registration_number',x.registration_number,
    'direction',x.direction,
    'scanned_at',x.scanned_at,
    'source',x.record_source
  ) ORDER BY x.scanned_at DESC),'[]'::jsonb)
  INTO v_duty
  FROM (
    SELECT g.id,s.full_name,s.registration_number,g.direction,g.scanned_at,g.record_source
    FROM public.gate_duty_records g
    JOIN public.students s ON s.id=g.student_id
    WHERE (g.scanned_at AT TIME ZONE 'Africa/Harare')::date=(now() AT TIME ZONE 'Africa/Harare')::date
    ORDER BY g.scanned_at DESC
    LIMIT 200
  ) x;

  IF v_access_level='management' THEN
    SELECT coalesce(jsonb_object_agg(setting_key,setting_value),'{}'::jsonb)
    INTO v_settings
    FROM public.system_settings;
  ELSE
    v_settings:='{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'status','success',
    'access_level',v_access_level,
    'can_review_passes',(v_access_level='management'),
    'can_manage_settings',(v_access_level='management'),
    'counts',jsonb_build_object(
      'on_campus',v_on,
      'off_campus',v_off,
      'unknown',v_unknown,
      'pending_passes',v_pending,
      'approved_passes',v_approved,
      'overdue_passes',v_overdue,
      'bed_rest',v_bed_rest,
      'maternity',v_maternity
    ),
    'students',v_students,
    'recent_movements',v_recent,
    'gate_passes',v_passes,
    'gate_duty_today',v_duty,
    'settings',v_settings
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.campus_dashboard(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v jsonb;
BEGIN
  v:=public.student_services_dashboard(p_pin);
  IF coalesce(v->>'status','')<>'success' THEN RETURN v; END IF;
  RETURN jsonb_build_object(
    'status','success',
    'access_level',v->'access_level',
    'counts',v->'counts',
    'students',v->'students',
    'recent_movements',v->'recent_movements'
  );
END;
$$;

-- 10. Management-only pass decisions and settings.
CREATE OR REPLACE FUNCTION public.dashboard_gate_pass_decision(
  p_pin text,
  p_pass_id uuid,
  p_actor_role text,
  p_decision text,
  p_comments text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pass public.gate_passes%rowtype;
  v_old_status text;
  v_new_status text;
  v_admin_ok boolean;
  v_senior_ok boolean;
BEGIN
  IF p_pin<>'0593' THEN
    RETURN jsonb_build_object('status','unauthorized','message','Management password required.');
  END IF;
  IF p_actor_role NOT IN ('administrator','principal','dean','director') THEN
    RETURN jsonb_build_object('status','invalid','message','Choose the approving or rejecting role.');
  END IF;
  IF p_decision NOT IN ('approved','rejected','cancelled') THEN
    RETURN jsonb_build_object('status','invalid','message','Choose Approve, Reject or Cancel.');
  END IF;

  SELECT * INTO v_pass FROM public.gate_passes WHERE id=p_pass_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','message','Gate pass not found.'); END IF;
  v_old_status:=v_pass.status;

  INSERT INTO public.gate_pass_approvals(pass_id,approver_role,decision,comments,decided_at)
  VALUES(p_pass_id,p_actor_role,p_decision,nullif(trim(coalesce(p_comments,'')),''),now())
  ON CONFLICT(pass_id,approver_role) DO UPDATE
    SET decision=excluded.decision,comments=excluded.comments,decided_at=excluded.decided_at;

  IF p_decision='cancelled' THEN
    v_new_status:='cancelled';
    UPDATE public.gate_passes
    SET status=v_new_status,cancelled_at=now(),cancelled_by_role=p_actor_role,
        cancellation_reason=nullif(trim(coalesce(p_comments,'')),''),updated_at=now()
    WHERE id=p_pass_id;
  ELSIF p_decision='rejected' THEN
    v_new_status:='rejected';
    UPDATE public.gate_passes SET status=v_new_status,updated_at=now() WHERE id=p_pass_id;
  ELSE
    SELECT exists(
      SELECT 1 FROM public.gate_pass_approvals
      WHERE pass_id=p_pass_id AND approver_role='administrator' AND decision='approved'
    ) INTO v_admin_ok;
    SELECT exists(
      SELECT 1 FROM public.gate_pass_approvals
      WHERE pass_id=p_pass_id AND approver_role IN ('principal','dean','director') AND decision='approved'
    ) INTO v_senior_ok;

    IF v_admin_ok AND v_senior_ok THEN
      v_new_status:='approved';
      UPDATE public.gate_passes
      SET status='approved',final_approved_at=coalesce(final_approved_at,now()),updated_at=now()
      WHERE id=p_pass_id;
    ELSE
      v_new_status:='pending';
      UPDATE public.gate_passes SET status='pending',updated_at=now() WHERE id=p_pass_id;
    END IF;
  END IF;

  INSERT INTO public.gate_pass_status_history
    (pass_id,previous_status,new_status,actor_role,notes)
  VALUES
    (p_pass_id,v_old_status,v_new_status,p_actor_role,nullif(trim(coalesce(p_comments,'')),''));

  INSERT INTO public.audit_log
    (event_type,entity_type,entity_id,actor_role,action,details)
  VALUES
    ('gate_pass','gate_pass',p_pass_id::text,p_actor_role,p_decision,
     jsonb_build_object('previous_status',v_old_status,'new_status',v_new_status,'comments',p_comments));

  RETURN jsonb_build_object(
    'status','success','pass_id',p_pass_id,'pass_status',v_new_status,
    'actor_role',p_actor_role,'decision',p_decision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.student_services_update_setting(
  p_pin text,
  p_setting_key text,
  p_setting_value jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_pin<>'0593' THEN
    RETURN jsonb_build_object('status','unauthorized','message','Management password required.');
  END IF;
  IF p_setting_key NOT IN (
    'gate_pass_pilot_mode','gate_pass_pilot_started_at',
    'gate_pass_pilot_ends_at','gate_terminal_result_seconds'
  ) THEN
    RETURN jsonb_build_object('status','invalid','message','This setting cannot be changed from the application.');
  END IF;

  INSERT INTO public.system_settings(setting_key,setting_value,updated_at)
  VALUES(p_setting_key,p_setting_value,now())
  ON CONFLICT(setting_key) DO UPDATE
    SET setting_value=excluded.setting_value,updated_at=now();

  INSERT INTO public.audit_log
    (event_type,entity_type,entity_id,actor_role,action,details)
  VALUES
    ('settings','system_setting',p_setting_key,'administrator','updated',
     jsonb_build_object('value',p_setting_value));

  RETURN jsonb_build_object(
    'status','success','setting_key',p_setting_key,'setting_value',p_setting_value
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.student_services_export(
  p_pin text,
  p_report text,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_pin NOT IN ('0593','1960') THEN
    RETURN jsonb_build_object('status','unauthorized','message','Incorrect password.');
  END IF;
  IF p_start_date IS NULL THEN p_start_date:=current_date-30; END IF;
  IF p_end_date IS NULL THEN p_end_date:=current_date; END IF;

  IF p_report='campus' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.scanned_at DESC),'[]'::jsonb)
    INTO v_result
    FROM (
      SELECT cm.scanned_at,s.registration_number,s.full_name,cm.direction,
             cm.movement_source,gd.device_name,cm.gate_pass_id,
             cm.checkout_destination_code,cm.checkout_destination_label
      FROM public.campus_movements cm
      JOIN public.students s ON s.id=cm.student_id
      JOIN public.gate_devices gd ON gd.id=cm.gate_device_id
      WHERE (cm.scanned_at AT TIME ZONE 'Africa/Harare')::date BETWEEN p_start_date AND p_end_date
    ) q;
  ELSIF p_report='passes' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.submitted_at DESC),'[]'::jsonb)
    INTO v_result
    FROM (
      SELECT p.submitted_at,s.registration_number,s.full_name,p.destination,p.reason,
             p.departure_at,p.expected_return_at,p.status,p.final_approved_at,
             p.actual_departure_at,p.actual_return_at,p.contact_details
      FROM public.gate_passes p
      JOIN public.students s ON s.id=p.student_id
      WHERE (p.submitted_at AT TIME ZONE 'Africa/Harare')::date BETWEEN p_start_date AND p_end_date
    ) q;
  ELSIF p_report='gate_duty' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.scanned_at DESC),'[]'::jsonb)
    INTO v_result
    FROM (
      SELECT g.scanned_at,s.registration_number,s.full_name,g.direction,g.record_source,gd.device_name
      FROM public.gate_duty_records g
      JOIN public.students s ON s.id=g.student_id
      JOIN public.gate_devices gd ON gd.id=g.gate_device_id
      WHERE (g.scanned_at AT TIME ZONE 'Africa/Harare')::date BETWEEN p_start_date AND p_end_date
    ) q;
  ELSIF p_report='meals' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.checked_in_at DESC),'[]'::jsonb)
    INTO v_result
    FROM (
      SELECT c.service_date,c.checked_in_at,s.registration_number,s.full_name,
             c.meal_session,c.check_in_source
      FROM public.check_ins c
      JOIN public.students s ON s.id=c.student_id
      WHERE c.service_date BETWEEN p_start_date AND p_end_date
    ) q;
  ELSE
    RETURN jsonb_build_object('status','invalid','message','Unknown report type.');
  END IF;

  RETURN jsonb_build_object('status','success','report',p_report,'rows',v_result);
END;
$$;

-- 11. Function permissions for browser RPC calls.
GRANT EXECUTE ON FUNCTION public.gate_record_movement_v3(text,text,text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clinic_search_students(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clinic_set_bed_rest(text,text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clinic_active_bed_rest(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.student_services_dashboard(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campus_dashboard(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_gate_pass_decision(text,uuid,text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.student_services_update_setting(text,text,jsonb) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.student_services_export(text,text,date,date) TO anon,authenticated;
