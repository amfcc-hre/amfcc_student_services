-- Support two bell ringers per week and load the 2026 third-term rotation.

alter table public.ops_service_duty_weeks
  add column if not exists bell_ringer_2_student_id text
  references public.students(id);

create index if not exists ops_service_duty_weeks_bell_2_idx
  on public.ops_service_duty_weeks(bell_ringer_2_student_id);

create or replace function public.ops_save_service_duties_pair(
  p_session_token text,
  p_week_start date,
  p_bell_student_id text,
  p_bell_student_2_id text,
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
  v_result jsonb;
  v_week_start date;
begin
  select * into v_context from private.ops_session_context(p_session_token);
  if v_context.actor_role <> 'student_leadership' then
    raise exception 'Only Student Leadership can set bell, kitchen, and toilet duty.'
      using errcode = '42501';
  end if;

  if p_bell_student_2_id is not null
     and not exists (
       select 1 from public.students
       where id=p_bell_student_2_id and is_active
     ) then
    return jsonb_build_object('status','invalid','message','Choose an active student as the second bell ringer.');
  end if;
  if p_bell_student_id is not null
     and p_bell_student_id = p_bell_student_2_id then
    return jsonb_build_object('status','invalid','message','Choose two different bell ringers.');
  end if;

  v_result := public.ops_save_service_duties(
    p_session_token,
    p_week_start,
    p_bell_student_id,
    p_kitchen_department_id,
    p_toilet_department_id,
    p_kitchen_students,
    p_toilet_students,
    p_actor_student_id
  );

  if coalesce(v_result->>'status','') = 'success' then
    v_week_start := p_week_start - (extract(isodow from p_week_start)::integer - 1);
    update public.ops_service_duty_weeks
    set bell_ringer_2_student_id=p_bell_student_2_id,
        updated_at=now()
    where week_start=v_week_start;
  end if;

  return v_result || jsonb_build_object('bell_ringer_2_student_id',p_bell_student_2_id);
end
$function$;

revoke all on function public.ops_save_service_duties_pair(text,date,text,text,uuid,uuid,jsonb,jsonb,text) from public;
grant execute on function public.ops_save_service_duties_pair(text,date,text,text,uuid,uuid,jsonb,jsonb,text) to anon, authenticated;

create or replace function public.ops_duties_dashboard(
  p_session_token text,
  p_from_week date default current_date,
  p_to_week date default (current_date + 120)
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_catalog'
as $function$
declare
  v_context record;
  v_department_slug text;
  v_from date;
  v_to date;
begin
  select * into v_context from private.ops_session_context(p_session_token);

  if v_context.actor_role = 'department' then
    select d.slug into v_department_slug
    from public.ops_departments d
    where d.id = v_context.actor_department_id;
  end if;

  if v_context.actor_role not in ('student_leadership','management','administrator')
     and not (v_context.actor_role = 'department' and v_department_slug = 'security') then
    raise exception 'Duties access requires Student Leadership, Management, School Administration, or Security.'
      using errcode = '42501';
  end if;

  v_from := coalesce(p_from_week,current_date)
    - (extract(isodow from coalesce(p_from_week,current_date))::integer - 1);
  v_to := least(
    coalesce(p_to_week,v_from + 120)
      - (extract(isodow from coalesce(p_to_week,v_from + 120))::integer - 1),
    v_from + 364
  );

  return jsonb_build_object(
    'status','success',
    'current_week',current_date - (extract(isodow from current_date)::integer - 1),
    'permissions',jsonb_build_object(
      'can_manage_weekly',v_context.actor_role = 'student_leadership',
      'can_manage_gate',v_context.actor_role = 'student_leadership'
        or (v_context.actor_role = 'department' and v_department_slug = 'security')
    ),
    'weeks',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'week_start',w.week_start,
        'week_end',w.week_start + 6,
        'prefect_on_duty',r.prefect_on_duty,
        'prefect_student_id',r.prefect_student_id,
        'prefect_registration_number',pod_student.registration_number,
        'senior_prefect_on_duty',r.senior_prefect_on_duty,
        'senior_prefect_student_id',r.senior_prefect_student_id,
        'senior_prefect_registration_number',senior_student.registration_number,
        'bell_ringer_student_id',sdw.bell_ringer_student_id,
        'bell_ringer_2_student_id',sdw.bell_ringer_2_student_id,
        'bell_ringer',nullif(concat_ws(' and ',bell.full_name,bell_2.full_name),''),
        'bell_ringer_2',bell_2.full_name,
        'bell_ringer_registration_number',bell.registration_number,
        'bell_ringer_2_registration_number',bell_2.registration_number,
        'bell_ringers',coalesce((
          select jsonb_agg(jsonb_build_object(
            'student_id',s.id,
            'registration_number',s.registration_number,
            'full_name',s.full_name
          ) order by selected.sort_order)
          from (values
            (sdw.bell_ringer_student_id,1),
            (sdw.bell_ringer_2_student_id,2)
          ) selected(student_id,sort_order)
          join public.students s on s.id=selected.student_id
        ),'[]'::jsonb),
        'kitchen_department_id',sdw.kitchen_department_id,
        'kitchen_department',kd.name,
        'toilet_department_id',sdw.toilet_department_id,
        'toilet_department',td.name,
        'kitchen_people',coalesce((
          select jsonb_agg(jsonb_build_object(
            'student_id',m.student_id,
            'registration_number',s.registration_number,
            'full_name',s.full_name,
            'assignment_source',m.assignment_source
          ) order by m.sort_order,s.full_name)
          from public.ops_service_duty_members m
          join public.students s on s.id=m.student_id
          where m.week_start=w.week_start and m.duty_type='kitchen'
        ),'[]'::jsonb),
        'toilet_people',coalesce((
          select jsonb_agg(jsonb_build_object(
            'student_id',m.student_id,
            'registration_number',s.registration_number,
            'full_name',s.full_name,
            'assignment_source',m.assignment_source
          ) order by m.sort_order,s.full_name)
          from public.ops_service_duty_members m
          join public.students s on s.id=m.student_id
          where m.week_start=w.week_start and m.duty_type='toilet'
        ),'[]'::jsonb)
      ) order by w.week_start),'[]'::jsonb)
      from (
        select week_start from public.ops_weekly_duty_roster
        where week_start between v_from and v_to
        union
        select week_start from public.ops_service_duty_weeks
        where week_start between v_from and v_to
      ) w
      left join public.ops_weekly_duty_roster r on r.week_start=w.week_start
      left join public.students pod_student on pod_student.id=r.prefect_student_id
      left join public.students senior_student on senior_student.id=r.senior_prefect_student_id
      left join public.ops_service_duty_weeks sdw on sdw.week_start=w.week_start
      left join public.students bell on bell.id=sdw.bell_ringer_student_id
      left join public.students bell_2 on bell_2.id=sdw.bell_ringer_2_student_id
      left join public.ops_departments kd on kd.id=sdw.kitchen_department_id
      left join public.ops_departments td on td.id=sdw.toilet_department_id
    ),
    'gate_assignments',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'duty_date',g.duty_date,
        'slot_code',g.slot_code,
        'student_id',g.student_id,
        'registration_number',s.registration_number,
        'student_name',s.full_name,
        'updated_at',g.updated_at
      ) order by g.duty_date,
        case g.slot_code when '22_00' then 1 when '00_02' then 2 else 3 end
      ),'[]'::jsonb)
      from public.ops_gate_duty_assignments g
      join public.students s on s.id=g.student_id
      where g.duty_date between v_from and v_to + 6
    )
  );
end
$function$;

create or replace function public.student_duties_board(p_week_start date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_week_start date;
  v_result jsonb;
begin
  v_week_start := coalesce(p_week_start,current_date)
    - (extract(isodow from coalesce(p_week_start,current_date))::integer - 1);

  select jsonb_build_object(
    'status','success',
    'week_start',v_week_start,
    'week_end',v_week_start + 6,
    'prefect_on_duty',r.prefect_on_duty,
    'senior_prefect_on_duty',r.senior_prefect_on_duty,
    'bell_ringer',nullif(concat_ws(' and ',bell.full_name,bell_2.full_name),''),
    'bell_ringers',coalesce((
      select jsonb_agg(s.full_name order by selected.sort_order)
      from (values
        (sdw.bell_ringer_student_id,1),
        (sdw.bell_ringer_2_student_id,2)
      ) selected(student_id,sort_order)
      join public.students s on s.id=selected.student_id
    ),'[]'::jsonb),
    'kitchen_department',kd.name,
    'toilet_department',td.name,
    'kitchen_people',coalesce((
      select jsonb_agg(s.full_name order by m.sort_order,s.full_name)
      from public.ops_service_duty_members m
      join public.students s on s.id=m.student_id
      where m.week_start=v_week_start and m.duty_type='kitchen'
    ),'[]'::jsonb),
    'toilet_people',coalesce((
      select jsonb_agg(s.full_name order by m.sort_order,s.full_name)
      from public.ops_service_duty_members m
      join public.students s on s.id=m.student_id
      where m.week_start=v_week_start and m.duty_type='toilet'
    ),'[]'::jsonb),
    'gate_assignments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'duty_date',g.duty_date,
        'slot_code',g.slot_code,
        'student_name',s.full_name
      ) order by g.duty_date,
        case g.slot_code when '22_00' then 1 when '00_02' then 2 else 3 end
      )
      from public.ops_gate_duty_assignments g
      join public.students s on s.id=g.student_id
      where g.duty_date between v_week_start and v_week_start + 6
    ),'[]'::jsonb)
  ) into v_result
  from (select v_week_start week_start) w
  left join public.ops_weekly_duty_roster r on r.week_start=w.week_start
  left join public.ops_service_duty_weeks sdw on sdw.week_start=w.week_start
  left join public.students bell on bell.id=sdw.bell_ringer_student_id
  left join public.students bell_2 on bell_2.id=sdw.bell_ringer_2_student_id
  left join public.ops_departments kd on kd.id=sdw.kitchen_department_id
  left join public.ops_departments td on td.id=sdw.toilet_department_id;

  return v_result;
end
$function$;

do $block$
declare
  v_count integer;
begin
  with rotation(week_start,first_name,second_name) as (
    values
      (date '2026-09-21','Cornelius Mbiri','David Kanhukamwe'),
      (date '2026-09-28','Simbarashe Zvangwari','Abraham Phiri'),
      (date '2026-10-05','Simbarashe Mangere','Sydney Zulu'),
      (date '2026-10-12','Vincent Mukundu','Aaron Jakwi'),
      (date '2026-10-19','Maxwell Makudo','Edwin Gutsa'),
      (date '2026-10-26','Tinashe Dumbujena','Godsave Rusike'),
      (date '2026-11-02','Ian Guzete','Charles Aiwansedo'),
      (date '2026-11-09','John Munjalu','Thulani Mutenje'),
      (date '2026-11-16','Franklin Ndze','Bienvu Songomalet'),
      (date '2026-11-23','Bentley Shomai','Steve Tharreo Simukai'),
      (date '2026-11-30','David Magaya','Cosmas Kamhozo'),
      (date '2026-12-07','Martin Kanengoni','Edson Makore')
  )
  select count(*) into v_count
  from rotation r
  join public.students first_student
    on first_student.full_name=r.first_name and first_student.is_active
  join public.students second_student
    on second_student.full_name=r.second_name and second_student.is_active;

  if v_count <> 12 then
    raise exception 'Bell-ringer rotation was not loaded because one or more students could not be matched uniquely.';
  end if;

  with rotation(week_start,first_name,second_name) as (
    values
      (date '2026-09-21','Cornelius Mbiri','David Kanhukamwe'),
      (date '2026-09-28','Simbarashe Zvangwari','Abraham Phiri'),
      (date '2026-10-05','Simbarashe Mangere','Sydney Zulu'),
      (date '2026-10-12','Vincent Mukundu','Aaron Jakwi'),
      (date '2026-10-19','Maxwell Makudo','Edwin Gutsa'),
      (date '2026-10-26','Tinashe Dumbujena','Godsave Rusike'),
      (date '2026-11-02','Ian Guzete','Charles Aiwansedo'),
      (date '2026-11-09','John Munjalu','Thulani Mutenje'),
      (date '2026-11-16','Franklin Ndze','Bienvu Songomalet'),
      (date '2026-11-23','Bentley Shomai','Steve Tharreo Simukai'),
      (date '2026-11-30','David Magaya','Cosmas Kamhozo'),
      (date '2026-12-07','Martin Kanengoni','Edson Makore')
  )
  insert into public.ops_service_duty_weeks(
    week_start,
    bell_ringer_student_id,
    bell_ringer_2_student_id,
    updated_by_role
  )
  select r.week_start,first_student.id,second_student.id,'student_leadership'
  from rotation r
  join public.students first_student
    on first_student.full_name=r.first_name and first_student.is_active
  join public.students second_student
    on second_student.full_name=r.second_name and second_student.is_active
  on conflict(week_start) do update set
    bell_ringer_student_id=excluded.bell_ringer_student_id,
    bell_ringer_2_student_id=excluded.bell_ringer_2_student_id,
    updated_at=now();
end
$block$;

notify pgrst, 'reload schema';
