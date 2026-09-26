-- Route gate-pass email by purpose and stop movement alerts.
-- School Administration and Management receive action-required mail only.
-- Applicants and Student Leadership receive outcomes, with applicants also
-- retaining their submission confirmation.

create or replace function private.pass_queue_email(p_pass_id uuid,p_event_type text)
returns integer
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_settings private.pass_email_settings%rowtype;
  v_pass public.gate_passes%rowtype;
  v_student public.students%rowtype;
  v_contact private.pass_requester_contacts%rowtype;
  v_recipient record;
  v_people jsonb;
  v_payload jsonb;
  v_event_label text;
  v_subject text;
  v_event_key uuid:=gen_random_uuid();
  v_count integer:=0;
begin
  if p_event_type not in ('submitted','pending','approved','rejected','cancelled','expired') then
    return 0;
  end if;

  select * into v_settings from private.pass_email_settings where singleton=true;
  if not found or not v_settings.enabled then return 0; end if;

  select * into v_pass from public.gate_passes where id=p_pass_id;
  if not found then return 0; end if;

  select * into v_student from public.students where id=v_pass.student_id;
  select * into v_contact from private.pass_requester_contacts where pass_id=p_pass_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name',s.full_name,'registration_number',s.registration_number,'is_primary',gm.is_primary
  ) order by gm.is_primary desc,s.full_name),'[]'::jsonb)
  into v_people
  from public.gate_pass_members gm
  join public.students s on s.id=gm.student_id
  where gm.pass_id=p_pass_id;

  v_event_label:=case p_event_type
    when 'submitted' then 'Request received'
    when 'pending' then 'Pending review'
    when 'approved' then 'Approved'
    when 'rejected' then 'Rejected'
    when 'cancelled' then 'Cancelled'
    when 'expired' then 'Overdue or expired'
  end;
  v_subject:='AMFCC Gate Pass: '||v_event_label||' - '||coalesce(v_student.full_name,'Student');
  v_payload:=jsonb_build_object(
    'pass_id',v_pass.id,'event_type',p_event_type,'event_label',v_event_label,'status',v_pass.status,
    'student_name',v_student.full_name,'registration_number',v_student.registration_number,
    'destination',v_pass.destination,'reason',v_pass.reason,'contact_details',v_pass.contact_details,
    'departure_at',v_pass.departure_at,'expected_return_at',v_pass.expected_return_at,
    'actual_departure_at',v_pass.actual_departure_at,'actual_return_at',v_pass.actual_return_at,
    'cancellation_reason',v_pass.cancellation_reason,'people',v_people
  );

  for v_recipient in
    select lower(trim(r.email)) as email,min(r.recipient_group) as recipient_group
    from (
      select unnest(v_settings.admin_emails) as email,'administrator'::text as recipient_group
      union all select unnest(v_settings.management_emails),'management'::text
      union all select unnest(v_settings.student_leadership_emails),'student_leadership'::text
      union all select v_contact.requester_email,'student'::text
    ) r
    where nullif(trim(r.email),'') is not null
      and r.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and (
        (p_event_type in ('submitted','pending') and r.recipient_group in ('administrator','management'))
        or (p_event_type='submitted' and r.recipient_group='student')
        or (p_event_type in ('approved','rejected','cancelled','expired')
            and r.recipient_group in ('student_leadership','student'))
      )
    group by lower(trim(r.email))
  loop
    insert into private.pass_email_outbox(event_key,pass_id,event_type,recipient_group,recipient_email,subject,payload)
    values(v_event_key,p_pass_id,p_event_type,v_recipient.recipient_group,v_recipient.email,v_subject,v_payload)
    on conflict(event_key,recipient_email) do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;

  return v_count;
end
$function$;

revoke all on function private.pass_queue_email(uuid,text) from public;

notify pgrst, 'reload schema';
