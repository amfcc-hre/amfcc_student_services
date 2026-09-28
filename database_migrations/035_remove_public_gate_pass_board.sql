-- Remove the public pass notice board and expose only pending status in student lookup.

drop function if exists public.public_approved_gate_passes();

create or replace function public.student_gate_pass_status_v2(p_registration_number text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_student public.students%rowtype;
  v_passes jsonb;
  v_pilot boolean := false;
  v_pilot_end text;
  v_holiday boolean := false;
begin
  select * into v_student
  from public.students
  where registration_number::text=regexp_replace(coalesce(p_registration_number,''),'\D','','g')
    and is_active=true
  limit 1;

  if not found then
    return jsonb_build_object('status','not_found','message','Student registration number was not found.');
  end if;

  select coalesce((setting_value #>> '{}')::boolean,false) into v_holiday
  from public.system_settings where setting_key='school_holiday_mode';
  select coalesce((setting_value #>> '{}')::boolean,false) into v_pilot
  from public.system_settings where setting_key='gate_pass_pilot_mode';
  select setting_value #>> '{}' into v_pilot_end
  from public.system_settings where setting_key='gate_pass_pilot_ends_at';

  select coalesce(jsonb_agg(
    jsonb_build_object('status','pending')
    order by p.submitted_at desc
  ),'[]'::jsonb) into v_passes
  from public.gate_pass_members gm
  join public.gate_passes p on p.id=gm.pass_id
  where gm.student_id=v_student.id
    and p.status='pending';

  return jsonb_build_object(
    'status','success',
    'student_name',v_student.full_name,
    'registration_number',v_student.registration_number,
    'school_holiday_mode',coalesce(v_holiday,false),
    'pilot_mode',coalesce(v_pilot,false),
    'pilot_ends_at',v_pilot_end,
    'passes',v_passes
  );
end
$function$;

revoke all on function public.student_gate_pass_status_v2(text) from public;
grant execute on function public.student_gate_pass_status_v2(text) to anon, authenticated;

notify pgrst, 'reload schema';
