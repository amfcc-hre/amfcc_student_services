-- Separate gate-pass email routing for School Administration and Management.

alter table private.pass_email_settings
  add column if not exists management_emails text[] not null default '{}'::text[];

alter table private.pass_email_outbox
  drop constraint if exists pass_email_outbox_recipient_group_check;
alter table private.pass_email_outbox
  add constraint pass_email_outbox_recipient_group_check
  check(recipient_group in ('administrator','management','student_leadership','student'));

-- Management recipient addresses are configured privately through IT Admin.

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
  if p_event_type not in ('submitted','pending','approved','rejected','cancelled','departed','returned','expired') then return 0; end if;
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
    when 'departed' then 'Departure recorded'
    when 'returned' then 'Return recorded'
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

create or replace function public.system_control_pass_email_settings(p_session_token text)
returns jsonb
language plpgsql security definer
set search_path='public','private','cron','pg_catalog'
as $function$
declare
  v_context record;
  v_settings private.pass_email_settings%rowtype;
  v_queued integer;
  v_failed integer;
  v_schedule_ready boolean;
begin
  select * into v_context from private.system_session_context(p_session_token,array['it_admin']);
  if not found then return jsonb_build_object('status','unauthorized','message','IT Administrator access is required.'); end if;
  select * into v_settings from private.pass_email_settings where singleton=true;
  select count(*) filter(where status in ('queued','sending')),count(*) filter(where status='failed' and attempts>=5)
  into v_queued,v_failed from private.pass_email_outbox;
  select exists(select 1 from cron.job where jobname='amfcc-pass-email-worker' and active) into v_schedule_ready;
  return jsonb_build_object(
    'status','success','enabled',v_settings.enabled,'from_email',v_settings.from_email,
    'admin_emails',to_jsonb(v_settings.admin_emails),'management_emails',to_jsonb(v_settings.management_emails),
    'student_leadership_emails',to_jsonb(v_settings.student_leadership_emails),
    'queued_count',v_queued,'failed_count',v_failed,'automatic_dispatch_ready',v_schedule_ready,
    'updated_at',v_settings.updated_at
  );
end
$function$;

create or replace function public.system_control_update_pass_email_settings(
  p_session_token text,p_enabled boolean,p_admin_emails text[],p_management_emails text[],
  p_student_leadership_emails text[],p_actor_name text
) returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_context record;
  v_admin text[]:=private.pass_normalize_email_list(p_admin_emails);
  v_management text[]:=private.pass_normalize_email_list(p_management_emails);
  v_leadership text[]:=private.pass_normalize_email_list(p_student_leadership_emails);
  v_bad_email text;
begin
  select * into v_context from private.system_session_context(p_session_token,array['it_admin']);
  if not found then return jsonb_build_object('status','unauthorized','message','IT Administrator access is required.'); end if;
  if nullif(trim(coalesce(p_actor_name,'')),'') is null then return jsonb_build_object('status','invalid','message','Enter your name for the audit record.'); end if;
  if cardinality(v_admin)>20 or cardinality(v_management)>20 or cardinality(v_leadership)>20 then
    return jsonb_build_object('status','invalid','message','Use no more than 20 recipients in each group.');
  end if;
  select email into v_bad_email from unnest(v_admin||v_management||v_leadership) as e(email)
  where length(email)>254 or email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' limit 1;
  if found then return jsonb_build_object('status','invalid','message','Check this email address: '||v_bad_email); end if;
  if coalesce(p_enabled,false) and (cardinality(v_admin)=0 or cardinality(v_management)=0 or cardinality(v_leadership)=0) then
    return jsonb_build_object('status','invalid','message','Add at least one School Administration, Management, and Student Leadership recipient before enabling email.');
  end if;
  update private.pass_email_settings set enabled=coalesce(p_enabled,false),from_email='it@amfcc.ac.zw',
    admin_emails=v_admin,management_emails=v_management,student_leadership_emails=v_leadership,
    updated_at=now(),updated_by=trim(p_actor_name) where singleton=true;
  insert into public.audit_log(event_type,entity_type,entity_id,actor_role,action,details)
  values('settings','pass_email','global','it_admin','pass_email_settings_updated',jsonb_build_object(
    'actor_name',trim(p_actor_name),'enabled',coalesce(p_enabled,false),'from_email','it@amfcc.ac.zw',
    'admin_recipient_count',cardinality(v_admin),'management_recipient_count',cardinality(v_management),
    'student_leadership_recipient_count',cardinality(v_leadership)
  ));
  return jsonb_build_object('status','success','enabled',coalesce(p_enabled,false),'from_email','it@amfcc.ac.zw',
    'admin_recipient_count',cardinality(v_admin),'management_recipient_count',cardinality(v_management),
    'student_leadership_recipient_count',cardinality(v_leadership));
end
$function$;

-- Compatibility wrapper for older cached IT Admin pages.
create or replace function public.system_control_update_pass_email_settings(
  p_session_token text,p_enabled boolean,p_admin_emails text[],p_student_leadership_emails text[],p_actor_name text
) returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare v_management text[];
begin
  select management_emails into v_management from private.pass_email_settings where singleton=true;
  return public.system_control_update_pass_email_settings(
    p_session_token,p_enabled,p_admin_emails,coalesce(v_management,'{}'::text[]),p_student_leadership_emails,p_actor_name
  );
end
$function$;

revoke all on function private.pass_queue_email(uuid,text) from public;
revoke all on function public.system_control_pass_email_settings(text) from public;
revoke all on function public.system_control_update_pass_email_settings(text,boolean,text[],text[],text[],text) from public;
revoke all on function public.system_control_update_pass_email_settings(text,boolean,text[],text[],text) from public;
grant execute on function public.system_control_pass_email_settings(text) to anon,authenticated;
grant execute on function public.system_control_update_pass_email_settings(text,boolean,text[],text[],text[],text) to anon,authenticated;
grant execute on function public.system_control_update_pass_email_settings(text,boolean,text[],text[],text) to anon,authenticated;
