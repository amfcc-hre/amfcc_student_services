-- AMFCC Student Services Platform v5
-- Adds Student Leadership operational edits, changes the kitchen PIN,
-- and registers Tasha-Adel Zulu (26073).

-- 1. Add the new first-year student without assuming a generated ID.
INSERT INTO public.students (id, registration_number, full_name, is_active)
SELECT gen_random_uuid()::text, 26073, 'Tasha-Adel Zulu', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.students WHERE registration_number = 26073
);

UPDATE public.students
SET full_name = 'Tasha-Adel Zulu', is_active = true
WHERE registration_number = 26073;

-- 2. Kitchen staff PIN is now 1958.
CREATE OR REPLACE FUNCTION public.staff_check_in(
  p_pin text,
  p_registration_number text,
  p_meal_session text,
  p_service_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_pin <> '1958' THEN
    RAISE EXCEPTION 'Incorrect PIN';
  END IF;
  RETURN public._perform_meal_check_in(
    p_registration_number,
    p_meal_session,
    p_service_date,
    'staff'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_dashboard(
  p_pin text,
  p_service_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_counts jsonb;
  v_lunch integer;
  v_supper integer;
BEGIN
  IF p_pin <> '1958' THEN
    RETURN jsonb_build_object('status','unauthorized','message','Incorrect PIN.');
  END IF;

  SELECT jsonb_build_object(
    'Breakfast', count(*) FILTER (WHERE meal_session='Breakfast'),
    'Lunch', count(*) FILTER (WHERE meal_session='Lunch'),
    'Break-fast 4pm', count(*) FILTER (WHERE meal_session='Break-fast 4pm'),
    'Supper', count(*) FILTER (WHERE meal_session='Supper')
  ) INTO v_counts
  FROM public.check_ins
  WHERE service_date=p_service_date;

  SELECT count(DISTINCT student_id) INTO v_lunch
  FROM public.check_ins
  WHERE service_date=p_service_date AND meal_session='Breakfast';

  SELECT count(DISTINCT student_id) INTO v_supper
  FROM public.check_ins
  WHERE service_date=p_service_date
    AND meal_session IN ('Breakfast','Break-fast 4pm');

  RETURN jsonb_build_object(
    'status','success',
    'counts',v_counts,
    'lunch_to_cook',v_lunch,
    'supper_to_cook',v_supper
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_export(
  p_pin text,
  p_scope text,
  p_service_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_pin <> '1958' THEN RAISE EXCEPTION 'Incorrect PIN'; END IF;
  IF p_scope NOT IN ('today','all') THEN RAISE EXCEPTION 'Invalid export scope'; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.service_date,q.checked_in_at),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT c.service_date,c.meal_session,
           s.registration_number::text AS registration_number,
           s.full_name,c.checked_in_at,c.check_in_source
    FROM public.check_ins c
    JOIN public.students s ON s.id=c.student_id
    WHERE p_scope='all' OR c.service_date=p_service_date
  ) q;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_clear_day(
  p_pin text,
  p_service_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_deleted integer;
BEGIN
  IF p_pin <> '1958' THEN RAISE EXCEPTION 'Incorrect PIN'; END IF;
  DELETE FROM public.check_ins WHERE service_date=p_service_date;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object(
    'status','cleared',
    'deleted',v_deleted,
    'service_date',p_service_date
  );
END;
$$;

-- 3. Management and Student Leadership can correct campus status.
CREATE OR REPLACE FUNCTION public.dashboard_update_student_campus_status(
  p_pin text,
  p_registration_number text,
  p_direction text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_access_level text;
  v_student public.students%rowtype;
  v_device_id uuid;
  v_last_direction text;
  v_direction text := upper(trim(coalesce(p_direction,'')));
BEGIN
  v_access_level := CASE
    WHEN p_pin='0593' THEN 'management'
    WHEN p_pin='1960' THEN 'student_leadership'
    ELSE NULL
  END;

  IF v_access_level IS NULL THEN
    RETURN jsonb_build_object('status','unauthorized','message','Incorrect password.');
  END IF;

  IF v_direction NOT IN ('IN','OUT') THEN
    RETURN jsonb_build_object('status','invalid','message','Choose On Campus or Off Campus.');
  END IF;

  SELECT * INTO v_student
  FROM public.students
  WHERE registration_number::text = regexp_replace(coalesce(p_registration_number,''),'\D','','g')
    AND is_active=true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found','message','Student not found.');
  END IF;

  SELECT id INTO v_device_id
  FROM public.gate_devices
  WHERE is_active=true
  ORDER BY created_at NULLS LAST
  LIMIT 1;

  IF v_device_id IS NULL THEN
    RETURN jsonb_build_object('status','configuration_error','message','No active gate device is configured.');
  END IF;

  SELECT direction INTO v_last_direction
  FROM public.campus_movements
  WHERE student_id=v_student.id
  ORDER BY scanned_at DESC,id DESC
  LIMIT 1;

  IF v_last_direction IS NOT DISTINCT FROM v_direction THEN
    RETURN jsonb_build_object(
      'status','same_status',
      'message',CASE WHEN v_direction='IN'
        THEN 'Student is already marked on campus.'
        ELSE 'Student is already marked off campus.' END,
      'student_name',v_student.full_name,
      'registration_number',v_student.registration_number,
      'direction',v_direction
    );
  END IF;

  INSERT INTO public.campus_movements(
    student_id,direction,gate_device_id,movement_source,
    corrected_by,correction_note
  ) VALUES (
    v_student.id,v_direction,v_device_id,'administrative_update',
    v_access_level,
    coalesce(nullif(trim(coalesce(p_note,'')),''),
      CASE WHEN v_direction='IN'
        THEN 'Campus status updated from the Administrative Dashboard.'
        ELSE 'Campus status updated from the Administrative Dashboard.' END)
  );

  INSERT INTO public.audit_log(
    event_type,entity_type,entity_id,actor_role,action,details
  ) VALUES (
    'campus_status','student',v_student.id,v_access_level,
    CASE WHEN v_direction='IN' THEN 'marked_on_campus' ELSE 'marked_off_campus' END,
    jsonb_build_object('registration_number',v_student.registration_number,'note',p_note)
  );

  RETURN jsonb_build_object(
    'status','success',
    'message',CASE WHEN v_direction='IN'
      THEN 'Student marked on campus.'
      ELSE 'Student marked off campus.' END,
    'student_name',v_student.full_name,
    'registration_number',v_student.registration_number,
    'direction',v_direction,
    'access_level',v_access_level
  );
END;
$$;

-- 4. Management and Student Leadership can edit basic accommodation.
CREATE OR REPLACE FUNCTION public.dashboard_update_student_accommodation(
  p_pin text,
  p_registration_number text,
  p_residence text,
  p_room text DEFAULT NULL,
  p_bed text DEFAULT NULL,
  p_allocation_status text DEFAULT 'allocated',
  p_remove boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_access_level text;
  v_student public.students%rowtype;
  v_status text := lower(trim(coalesce(p_allocation_status,'allocated')));
  v_updated integer;
BEGIN
  v_access_level := CASE
    WHEN p_pin='0593' THEN 'management'
    WHEN p_pin='1960' THEN 'student_leadership'
    ELSE NULL
  END;

  IF v_access_level IS NULL THEN
    RETURN jsonb_build_object('status','unauthorized','message','Incorrect password.');
  END IF;

  SELECT * INTO v_student
  FROM public.students
  WHERE registration_number::text = regexp_replace(coalesce(p_registration_number,''),'\D','','g')
    AND is_active=true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found','message','Student not found.');
  END IF;

  IF coalesce(p_remove,false) THEN
    UPDATE public.accommodation_allocations
    SET is_active=false,
        allocation_status='cancelled',
        ended_at=now(),
        updated_at=now(),
        notes=concat_ws(' ',nullif(notes,''),'Removed from the Administrative Dashboard.')
    WHERE student_id=v_student.id AND is_active=true;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    INSERT INTO public.audit_log(
      event_type,entity_type,entity_id,actor_role,action,details
    ) VALUES (
      'accommodation','student',v_student.id,v_access_level,'accommodation_removed',
      jsonb_build_object('registration_number',v_student.registration_number,'rows_updated',v_updated)
    );

    RETURN jsonb_build_object(
      'status','success','message','Accommodation removed.',
      'student_name',v_student.full_name,
      'registration_number',v_student.registration_number,
      'removed',true
    );
  END IF;

  IF nullif(trim(coalesce(p_residence,'')),'') IS NULL THEN
    RETURN jsonb_build_object('status','invalid','message','Enter a residence or choose Remove accommodation.');
  END IF;

  IF v_status NOT IN ('waiting','allocated','checked_in','checked_out','cancelled') THEN
    RETURN jsonb_build_object('status','invalid','message','Choose a valid accommodation status.');
  END IF;

  UPDATE public.accommodation_allocations
  SET residence=trim(p_residence),
      room=nullif(trim(coalesce(p_room,'')),''),
      bed=nullif(trim(coalesce(p_bed,'')),''),
      allocation_status=v_status,
      allocated_by_role=v_access_level,
      updated_at=now(),
      ended_at=CASE WHEN v_status='cancelled' THEN now() ELSE NULL END,
      is_active=(v_status<>'cancelled')
  WHERE student_id=v_student.id AND is_active=true;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated=0 AND v_status<>'cancelled' THEN
    INSERT INTO public.accommodation_allocations(
      student_id,residence,room,bed,allocation_status,is_active,
      allocated_by_role,allocated_at,updated_at
    ) VALUES (
      v_student.id,trim(p_residence),nullif(trim(coalesce(p_room,'')),''),
      nullif(trim(coalesce(p_bed,'')),''),v_status,true,
      v_access_level,now(),now()
    );
  END IF;

  INSERT INTO public.audit_log(
    event_type,entity_type,entity_id,actor_role,action,details
  ) VALUES (
    'accommodation','student',v_student.id,v_access_level,'accommodation_updated',
    jsonb_build_object(
      'registration_number',v_student.registration_number,
      'residence',trim(p_residence),
      'room',nullif(trim(coalesce(p_room,'')),''),
      'bed',nullif(trim(coalesce(p_bed,'')),''),
      'allocation_status',v_status
    )
  );

  RETURN jsonb_build_object(
    'status','success','message','Accommodation updated.',
    'student_name',v_student.full_name,
    'registration_number',v_student.registration_number,
    'residence',trim(p_residence),
    'room',nullif(trim(coalesce(p_room,'')),''),
    'bed',nullif(trim(coalesce(p_bed,'')),''),
    'allocation_status',v_status,
    'access_level',v_access_level
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_update_student_campus_status(text,text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_update_student_accommodation(text,text,text,text,text,text,boolean) TO anon,authenticated;
