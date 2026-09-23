-- Allow Student Leadership to save an incomplete duty week and return later.
-- Keep the original RPC signature for compatibility with cached clients.

create or replace function public.ops_save_service_duties(
  p_session_token text,
  p_week_start date,
  p_bell_student_id text,
  p_kitchen_department_id uuid,
  p_toilet_department_id uuid,
  p_kitchen_students jsonb,
  p_toilet_students jsonb,
  p_actor_student_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_catalog'
as $function$
declare
  v_context record;
  v_week_start date;
  v_next_week date;
  v_actor_name text;
  v_input_count integer;
  v_valid_count integer;
  v_male_count integer;
  v_female_count integer;
  v_kitchen_department_id uuid;
  v_toilet_department_id uuid;
begin
  select * into v_context from private.ops_session_context(p_session_token);
  if v_context.actor_role <> 'student_leadership' then
    raise exception 'Only Student Leadership can set bell, kitchen, and toilet duty.'
      using errcode = '42501';
  end if;

  if p_actor_student_id is null then
    v_actor_name := 'Student Leadership';
  else
    select s.full_name into v_actor_name
    from public.ops_student_leadership_roles l
    join public.students s on s.id=l.student_id
    where l.student_id=p_actor_student_id and l.active and s.is_active
    order by l.display_order
    limit 1;
  end if;
  if v_actor_name is null then
    return jsonb_build_object('status','invalid','message','Choose the Student Leadership member entering this roster.');
  end if;

  if p_week_start is null then
    return jsonb_build_object('status','invalid','message','Choose the week beginning Monday.');
  end if;
  v_week_start := p_week_start - (extract(isodow from p_week_start)::integer - 1);
  if v_week_start < current_date - 14 or v_week_start > current_date + 730 then
    return jsonb_build_object('status','invalid','message','Choose a current or future duty week.');
  end if;
  v_next_week := v_week_start + 7;

  if p_bell_student_id is not null
     and not exists(select 1 from public.students where id=p_bell_student_id and is_active) then
    return jsonb_build_object('status','invalid','message','Choose an active student as bell ringer.');
  end if;

  select id into v_kitchen_department_id
  from public.ops_departments
  where slug='kitchen' and active and workspace_enabled
  limit 1;
  select id into v_toilet_department_id
  from public.ops_departments
  where slug='toilets' and active and workspace_enabled
  limit 1;
  if v_kitchen_department_id is null or v_toilet_department_id is null then
    return jsonb_build_object('status','invalid','message','Kitchen or Toilets is missing from the department setup.');
  end if;

  if jsonb_typeof(coalesce(p_kitchen_students,'null'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_toilet_students,'null'::jsonb)) <> 'array' then
    return jsonb_build_object('status','invalid','message','Duty students must be selected from the exact-name lists.');
  end if;
  if jsonb_array_length(p_kitchen_students) > 4 or jsonb_array_length(p_toilet_students) > 4 then
    return jsonb_build_object('status','invalid','message','Kitchen and toilet duty can each contain up to four students.');
  end if;

  select count(distinct nullif(btrim(item.value #>> '{}'),''))
    into v_input_count
  from jsonb_array_elements(p_kitchen_students) item(value);
  select count(*),
         count(*) filter (where lower(btrim(s.gender))='male'),
         count(*) filter (where lower(btrim(s.gender))='female')
    into v_valid_count,v_male_count,v_female_count
  from public.students s
  where s.is_active and s.id in (
    select nullif(btrim(item.value #>> '{}'),'')
    from jsonb_array_elements(p_kitchen_students) item(value)
  );
  if v_input_count <> jsonb_array_length(p_kitchen_students) or v_valid_count <> v_input_count then
    return jsonb_build_object('status','invalid','message','Every kitchen-duty name must be one exact active student record.');
  end if;
  if v_male_count + v_female_count <> v_valid_count then
    return jsonb_build_object('status','invalid','message','Every kitchen-duty student must have Male or Female recorded.');
  end if;
  if v_male_count > 2 or v_female_count > 2 then
    return jsonb_build_object('status','invalid','message','Kitchen duty can contain up to 2 men and 2 women.');
  end if;

  select count(distinct nullif(btrim(item.value #>> '{}'),''))
    into v_input_count
  from jsonb_array_elements(p_toilet_students) item(value);
  select count(*),
         count(*) filter (where lower(btrim(s.gender))='male'),
         count(*) filter (where lower(btrim(s.gender))='female')
    into v_valid_count,v_male_count,v_female_count
  from public.students s
  where s.is_active and s.id in (
    select nullif(btrim(item.value #>> '{}'),'')
    from jsonb_array_elements(p_toilet_students) item(value)
  );
  if v_input_count <> jsonb_array_length(p_toilet_students) or v_valid_count <> v_input_count then
    return jsonb_build_object('status','invalid','message','Every toilet-duty name must be one exact active student record.');
  end if;
  if v_male_count + v_female_count <> v_valid_count then
    return jsonb_build_object('status','invalid','message','Every toilet-duty student must have Male or Female recorded.');
  end if;
  if v_male_count > 2 or v_female_count > 2 then
    return jsonb_build_object('status','invalid','message','Toilet duty can contain up to 2 men and 2 women.');
  end if;

  insert into public.ops_service_duty_weeks(
    week_start,bell_ringer_student_id,kitchen_department_id,toilet_department_id,
    updated_by_student_id,updated_by_role
  ) values(
    v_week_start,p_bell_student_id,v_kitchen_department_id,v_toilet_department_id,
    p_actor_student_id,'student_leadership'
  )
  on conflict(week_start) do update set
    bell_ringer_student_id=excluded.bell_ringer_student_id,
    kitchen_department_id=excluded.kitchen_department_id,
    toilet_department_id=excluded.toilet_department_id,
    updated_by_student_id=excluded.updated_by_student_id,
    updated_by_role='student_leadership',
    updated_at=now();

  delete from public.ops_service_duty_members
  where week_start=v_week_start and duty_type in ('kitchen','toilet');

  insert into public.ops_service_duty_members(
    week_start,duty_type,student_id,assignment_source,sort_order
  )
  select v_week_start,'kitchen',item.value #>> '{}','manual',item.ordinality::integer
  from jsonb_array_elements(p_kitchen_students) with ordinality item(value,ordinality);

  insert into public.ops_service_duty_members(
    week_start,duty_type,student_id,assignment_source,sort_order
  )
  select v_week_start,'toilet',item.value #>> '{}','manual',item.ordinality::integer
  from jsonb_array_elements(p_toilet_students) with ordinality item(value,ordinality);

  insert into public.ops_service_duty_weeks(
    week_start,updated_by_student_id,updated_by_role
  ) values(v_next_week,p_actor_student_id,'student_leadership')
  on conflict(week_start) do update set updated_at=now();

  delete from public.ops_service_duty_members
  where week_start=v_next_week and duty_type='toilet'
    and assignment_source='kitchen_rotation';

  insert into public.ops_service_duty_members(
    week_start,duty_type,student_id,assignment_source,sort_order
  )
  select v_next_week,'toilet',m.student_id,'kitchen_rotation',m.sort_order
  from public.ops_service_duty_members m
  where m.week_start=v_week_start and m.duty_type='kitchen'
  on conflict(week_start,duty_type,student_id) do nothing;

  perform private.ops_audit(
    v_context.actor_role,v_context.actor_department_id,v_actor_name,
    'save_service_duties','service_duty_week',v_week_start::text,
    jsonb_build_object(
      'week_start',v_week_start,
      'next_toilet_week',v_next_week,
      'bell_entered',p_bell_student_id is not null,
      'kitchen_count',jsonb_array_length(p_kitchen_students),
      'toilet_count',jsonb_array_length(p_toilet_students),
      'partial_save',jsonb_array_length(p_kitchen_students) < 4
        or jsonb_array_length(p_toilet_students) < 4
        or p_bell_student_id is null
    )
  );

  return jsonb_build_object(
    'status','success',
    'week_start',v_week_start,
    'next_toilet_week',v_next_week
  );
end
$function$;

grant execute on function public.ops_save_service_duties(text,date,text,uuid,uuid,jsonb,jsonb,text) to anon, authenticated;

notify pgrst, 'reload schema';
