-- AMFCC term enrolment, Administration Staff and Immigration records.
-- Applied through Supabase migrations; all browser access is through SECURITY DEFINER RPCs.

create table if not exists public.sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  relationship_to_student text,
  address text,
  notes text,
  created_by_role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sponsors_name_not_blank check (btrim(name) <> ''),
  constraint sponsors_phone_not_blank check (btrim(phone) <> '')
);

create unique index if not exists sponsors_name_phone_unique
  on public.sponsors (lower(btrim(name)), regexp_replace(phone, '\s+', '', 'g'));

create table if not exists public.student_term_sponsors (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.students(id) on delete cascade,
  term_id bigint not null references public.academic_terms(id) on delete cascade,
  sponsor_id uuid not null references public.sponsors(id) on delete restrict,
  sponsor_name_snapshot text not null,
  sponsor_phone_snapshot text not null,
  confirmed_at timestamptz not null default now(),
  confirmed_by_role text not null default 'student',
  unique (student_id, term_id)
);

create index if not exists student_term_sponsors_sponsor_idx
  on public.student_term_sponsors(sponsor_id);
create index if not exists student_term_sponsors_term_idx
  on public.student_term_sponsors(term_id);

create table if not exists public.student_immigration_profiles (
  student_id text primary key references public.students(id) on delete cascade,
  residency_status text not null default 'local' check (residency_status in ('local','international')),
  country text,
  nationality text,
  sponsor_id uuid references public.sponsors(id) on delete set null,
  passport_number text,
  passport_issue_date date,
  passport_expiry_date date,
  permit_type text,
  permit_number text,
  permit_issue_date date,
  permit_expiry_date date,
  next_action text,
  next_action_date date,
  notes text,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint international_country_required check (
    residency_status = 'local' or nullif(btrim(coalesce(country,'')),'') is not null
  )
);

create index if not exists student_immigration_profiles_status_idx
  on public.student_immigration_profiles(residency_status, country);
create index if not exists student_immigration_profiles_sponsor_idx
  on public.student_immigration_profiles(sponsor_id);
create index if not exists student_immigration_profiles_passport_expiry_idx
  on public.student_immigration_profiles(passport_expiry_date);
create index if not exists student_immigration_profiles_permit_expiry_idx
  on public.student_immigration_profiles(permit_expiry_date);

create table if not exists public.student_immigration_documents (
  id uuid primary key default gen_random_uuid(),
  student_id text not null references public.students(id) on delete cascade,
  document_type text not null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null default 0 check (file_size between 0 and 10485760),
  issue_date date,
  expiry_date date,
  notes text,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists student_immigration_documents_student_idx
  on public.student_immigration_documents(student_id, uploaded_at desc);
create index if not exists student_immigration_documents_expiry_idx
  on public.student_immigration_documents(expiry_date);

alter table public.student_term_fee_status
  add column if not exists arrears_previous_terms numeric(12,2) not null default 0,
  add column if not exists amount_paid_current_term numeric(12,2) not null default 0,
  add column if not exists outstanding_balance numeric(12,2) not null default 0,
  add column if not exists payment_plan text;

alter table public.sponsors enable row level security;
alter table public.student_term_sponsors enable row level security;
alter table public.student_immigration_profiles enable row level security;
alter table public.student_immigration_documents enable row level security;

revoke all on public.sponsors from anon, authenticated;
revoke all on public.student_term_sponsors from anon, authenticated;
revoke all on public.student_immigration_profiles from anon, authenticated;
revoke all on public.student_immigration_documents from anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('immigration-documents','immigration-documents',false,10485760,
       array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

insert into public.system_access_credentials(role_key,role_label,active,must_change_pin)
values('admin_staff','Administration Staff',false,false)
on conflict(role_key) do update set role_label=excluded.role_label;

update public.ops_departments set restricted_data=true,updated_at=now()
where slug='immigration';

create or replace function private.tr_default_form_schema()
returns jsonb
language sql immutable
set search_path='pg_catalog'
as $function$
select jsonb_build_object(
  'configured',true,
  'student',jsonb_build_array(
    jsonb_build_object('id','gender','label','Gender','type','select','required',true,'options',jsonb_build_array('Male','Female')),
    jsonb_build_object('id','marital_status','label','Marital status','type','select','required',true,'options',jsonb_build_array('Single','Married','Widowed','Divorced')),
    jsonb_build_object('id','spouse_location','label','If married, where is your spouse?','type','text','required',false,'show_when',jsonb_build_object('field','marital_status','equals','Married')),
    jsonb_build_object('id','identity_number','label','ID number / passport number','type','text','required',true),
    jsonb_build_object('id','sponsor_name','label','Sponsor name','type','text','required',true),
    jsonb_build_object('id','sponsor_contact','label','Sponsor contact number','type','tel','required',true),
    jsonb_build_object('id','accommodation_type','label','Type of accommodation','type','select','required',true,'options',jsonb_build_array('Shared','Married')),
    jsonb_build_object('id','accommodation_hostel','label','Hostel allocated','type','text','required',false,'show_when',jsonb_build_object('field','accommodation_type','equals','Shared')),
    jsonb_build_object('id','accommodation_room','label','Room number','type','text','required',false,'show_when',jsonb_build_object('field','accommodation_type','equals','Shared')),
    jsonb_build_object('id','shared_occupants','label','Number of occupants in room','type','number','required',false,'show_when',jsonb_build_object('field','accommodation_type','equals','Shared'))
  ),
  'admin',jsonb_build_array(
    jsonb_build_object('id','official_date_of_arrival','label','Official date of arrival','type','date','required',true)
  ),
  'fees',jsonb_build_array(
    jsonb_build_object('id','arrears_previous_terms','label','Arrears from previous term(s)','type','number','required',true),
    jsonb_build_object('id','amount_paid_current_term','label','Amount paid for the current term','type','number','required',true),
    jsonb_build_object('id','outstanding_balance','label','Outstanding balance','type','number','required',true),
    jsonb_build_object('id','payment_plan','label','Payment plan','type','textarea','required',false),
    jsonb_build_object('id','fees_certified_by','label','Fees certified by','type','text','required',true)
  ),
  'accommodation',jsonb_build_array(
    jsonb_build_object('id','accommodation_type','label','Type of accommodation','type','select','required',true,'options',jsonb_build_array('Shared','Married')),
    jsonb_build_object('id','accommodation_hostel','label','Hostel allocated','type','text','required',false),
    jsonb_build_object('id','accommodation_room','label','Room number','type','text','required',false),
    jsonb_build_object('id','shared_occupants','label','Number of occupants in room','type','number','required',false),
    jsonb_build_object('id','accommodation_certified_by','label','Accommodation certified by','type','text','required',true)
  ),
  'final',jsonb_build_array(
    jsonb_build_object('id','principal_signature','label','Principal / authorised signatory','type','text','required',false)
  )
)
$function$;

update public.academic_terms
set registration_form_schema=private.tr_default_form_schema(),updated_at=now();

create or replace function private.tr_sync_sponsor(
  p_student_id text,
  p_term_id bigint,
  p_name text,
  p_phone text,
  p_actor_role text default 'student'
) returns uuid
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare v_sponsor_id uuid;
begin
  if nullif(btrim(coalesce(p_name,'')),'') is null or nullif(btrim(coalesce(p_phone,'')),'') is null then
    return null;
  end if;
  select id into v_sponsor_id from public.sponsors
  where lower(btrim(name))=lower(btrim(p_name))
    and regexp_replace(phone,'\s+','','g')=regexp_replace(p_phone,'\s+','','g')
  limit 1;
  if v_sponsor_id is null then
    insert into public.sponsors(name,phone,created_by_role)
    values(btrim(p_name),btrim(p_phone),p_actor_role)
    returning id into v_sponsor_id;
  else
    update public.sponsors set name=btrim(p_name),phone=btrim(p_phone),updated_at=now()
    where id=v_sponsor_id;
  end if;
  insert into public.student_term_sponsors(
    student_id,term_id,sponsor_id,sponsor_name_snapshot,sponsor_phone_snapshot,confirmed_by_role
  ) values(
    p_student_id,p_term_id,v_sponsor_id,btrim(p_name),btrim(p_phone),coalesce(nullif(p_actor_role,''),'student')
  ) on conflict(student_id,term_id) do update set
    sponsor_id=excluded.sponsor_id,
    sponsor_name_snapshot=excluded.sponsor_name_snapshot,
    sponsor_phone_snapshot=excluded.sponsor_phone_snapshot,
    confirmed_at=now(),confirmed_by_role=excluded.confirmed_by_role;
  return v_sponsor_id;
end
$function$;

create or replace function private.tr_student_save(
  p_registration_number text,
  p_resume_token text,
  p_answers jsonb
) returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_digits text:=regexp_replace(coalesce(p_registration_number,''),'\D','','g');
  v_reg public.term_registrations%rowtype;
  v_term public.academic_terms%rowtype;
  v_filtered jsonb;
  v_before jsonb;
begin
  select tr.* into v_reg
  from public.term_registrations tr
  join public.students s on s.id=tr.student_id
  join public.academic_terms t on t.id=tr.term_id
  where s.registration_number::text=v_digits and s.is_active and t.registration_is_open
  for update of tr;
  if not found then return jsonb_build_object('status','not_found','message','No open enrolment was found.'); end if;
  if v_reg.resume_token_hash is null or private.tr_token_hash(p_resume_token)<>v_reg.resume_token_hash then
    return jsonb_build_object('status','unauthorized','message','Open this enrolment from the browser where you started it.');
  end if;
  if v_reg.student_locked or v_reg.student_submitted_at is not null then
    return jsonb_build_object('status','locked','message','Your form has already been submitted.');
  end if;
  select * into v_term from public.academic_terms where id=v_reg.term_id;
  v_filtered:=private.tr_filter_answers(v_term.registration_form_schema->'student',coalesce(p_answers,'{}'::jsonb));
  if coalesce(v_filtered->>'marital_status','')<>'Married' then v_filtered:=v_filtered-'spouse_location'; end if;
  if coalesce(v_filtered->>'accommodation_type','')<>'Shared' then
    v_filtered:=v_filtered-'accommodation_hostel'-'accommodation_room'-'shared_occupants';
  end if;
  v_before:=v_reg.student_answers;
  update public.term_registrations set student_answers=v_filtered,updated_at=now()
  where id=v_reg.id;
  perform private.tr_write_history(v_reg.id,'student','answers_saved','student',v_before,v_filtered,null);
  return jsonb_build_object('status','success','message','Saved.','student_answers',v_filtered,'status_label',private.tr_status_label(v_reg.status));
end
$function$;

create or replace function private.tr_student_submit(
  p_registration_number text,
  p_resume_token text,
  p_answers jsonb
) returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_digits text:=regexp_replace(coalesce(p_registration_number,''),'\D','','g');
  v_reg public.term_registrations%rowtype;
  v_term public.academic_terms%rowtype;
  v_filtered jsonb;
  v_missing jsonb;
  v_before jsonb;
  v_status text;
  v_accommodation text;
begin
  select tr.* into v_reg
  from public.term_registrations tr
  join public.students s on s.id=tr.student_id
  join public.academic_terms t on t.id=tr.term_id
  where s.registration_number::text=v_digits and s.is_active and t.registration_is_open
  for update of tr;
  if not found then return jsonb_build_object('status','not_found','message','No open enrolment was found.'); end if;
  if v_reg.resume_token_hash is null or private.tr_token_hash(p_resume_token)<>v_reg.resume_token_hash then
    return jsonb_build_object('status','unauthorized','message','Open this enrolment from the browser where you started it.');
  end if;
  if v_reg.student_locked or v_reg.student_submitted_at is not null then
    return jsonb_build_object('status','locked','message','This enrolment has already been submitted.','status_label',private.tr_status_label(v_reg.status));
  end if;
  select * into v_term from public.academic_terms where id=v_reg.term_id;
  v_filtered:=private.tr_filter_answers(v_term.registration_form_schema->'student',coalesce(p_answers,'{}'::jsonb));
  if coalesce(v_filtered->>'marital_status','')<>'Married' then v_filtered:=v_filtered-'spouse_location'; end if;
  v_accommodation:=coalesce(v_filtered->>'accommodation_type','');
  if v_accommodation<>'Shared' then v_filtered:=v_filtered-'accommodation_hostel'-'accommodation_room'-'shared_occupants'; end if;
  v_missing:=private.tr_missing_required(v_term.registration_form_schema->'student',v_filtered);
  if coalesce(v_filtered->>'marital_status','')='Married' and nullif(btrim(coalesce(v_filtered->>'spouse_location','')),'') is null then
    v_missing:=v_missing||jsonb_build_array(jsonb_build_object('id','spouse_location','label','Where your spouse is'));
  end if;
  if v_accommodation='Shared' then
    if nullif(btrim(coalesce(v_filtered->>'accommodation_hostel','')),'') is null then v_missing:=v_missing||jsonb_build_array(jsonb_build_object('id','accommodation_hostel','label','Hostel allocated')); end if;
    if nullif(btrim(coalesce(v_filtered->>'accommodation_room','')),'') is null then v_missing:=v_missing||jsonb_build_array(jsonb_build_object('id','accommodation_room','label','Room number')); end if;
    if coalesce((v_filtered->>'shared_occupants')::numeric,0)<1 then v_missing:=v_missing||jsonb_build_array(jsonb_build_object('id','shared_occupants','label','Number of occupants')); end if;
  end if;
  if jsonb_array_length(v_missing)>0 then
    return jsonb_build_object('status','missing','message','Please complete the required questions.','missing',v_missing);
  end if;
  v_before:=v_reg.student_answers;
  perform private.tr_sync_sponsor(v_reg.student_id,v_reg.term_id,v_filtered->>'sponsor_name',v_filtered->>'sponsor_contact','student');
  update public.term_registrations set
    student_answers=v_filtered,
    student_submitted_at=now(),student_locked=true,
    accommodation_mode=case when v_accommodation='Shared' then 'on_campus' else 'off_campus' end,
    accommodation_residence=case when v_accommodation='Shared' then nullif(btrim(v_filtered->>'accommodation_hostel'),'') else null end,
    accommodation_room=case when v_accommodation='Shared' then nullif(btrim(v_filtered->>'accommodation_room'),'') else null end,
    accommodation_bed=null,
    accommodation_answers=jsonb_strip_nulls(jsonb_build_object(
      'accommodation_type',v_accommodation,
      'accommodation_hostel',case when v_accommodation='Shared' then v_filtered->>'accommodation_hostel' end,
      'accommodation_room',case when v_accommodation='Shared' then v_filtered->>'accommodation_room' end,
      'shared_occupants',case when v_accommodation='Shared' then v_filtered->'shared_occupants' end
    )),updated_at=now()
  where id=v_reg.id;
  v_status:=private.tr_recalculate(v_reg.id);
  perform private.tr_write_history(v_reg.id,'student','student_section_submitted','student',v_before,v_filtered,null);
  return jsonb_build_object('status','success','message','Your term enrolment has been submitted.','registration_status',v_status,'status_label',private.tr_status_label(v_status));
end
$function$;

create or replace function public.student_term_registration_status()
returns jsonb
language sql stable security definer
set search_path='public','pg_catalog'
as $function$
  select case when t.id is null then jsonb_build_object('status','closed','registration_is_open',false)
  else jsonb_build_object(
    'status','success','registration_is_open',true,'term_id',t.id,'term_name',t.term_name,
    'academic_year',t.academic_year,'term_number',t.term_number,
    'opened_at',t.registration_opened_at
  ) end
  from (select 1) q
  left join lateral (
    select * from public.academic_terms where registration_is_open
    order by registration_opened_at desc nulls last,id desc limit 1
  ) t on true
$function$;

create or replace function public.system_control_login(p_role text,p_pin text)
returns jsonb
language plpgsql security definer
set search_path='public','private','extensions','pg_catalog'
as $function$
declare
  v_role text:=lower(trim(coalesce(p_role,'')));
  v_credential public.system_access_credentials%rowtype;
  v_token text;
begin
  if v_role not in ('administrator','it_admin','admin_staff','management') then
    return jsonb_build_object('status','unauthorized','message','Choose an authorised Administration role.');
  end if;
  select * into v_credential from public.system_access_credentials where role_key=v_role for update;
  if not found or not v_credential.active or v_credential.access_hash is null then
    return jsonb_build_object('status','unavailable','message','This access role has not been enabled yet.');
  end if;
  if v_credential.locked_until is not null and v_credential.locked_until>now() then
    return jsonb_build_object('status','locked','message','Too many incorrect attempts. Try again later.');
  end if;
  if v_credential.access_hash<>extensions.crypt(coalesce(p_pin,''),v_credential.access_hash) then
    update public.system_access_credentials set
      failed_attempts=failed_attempts+1,
      locked_until=case when failed_attempts+1>=5 then now()+interval '15 minutes' else null end,
      updated_at=now()
    where role_key=v_role;
    return jsonb_build_object('status','unauthorized','message','Incorrect PIN.');
  end if;
  update public.system_access_credentials set failed_attempts=0,locked_until=null,updated_at=now() where role_key=v_role;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.system_access_sessions(token_hash,role_key,expires_at)
  values(encode(extensions.digest(v_token,'sha256'),'hex'),v_role,now()+interval '8 hours');
  delete from public.system_access_sessions where expires_at<now()-interval '1 day' or revoked_at<now()-interval '1 day';
  return jsonb_build_object('status','success','session_token',v_token,'role',v_role,
    'display_name',v_credential.role_label,'must_change_pin',v_credential.must_change_pin,'expires_at',now()+interval '8 hours');
end
$function$;

create or replace function private.registration_session_context(p_token text,p_write boolean default false)
returns text
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare v_role text;
begin
  select c.role_key into v_role
  from private.system_session_context(p_token,array['administrator','it_admin','admin_staff','management']) c
  limit 1;
  if v_role is null then raise exception 'Your Administration session has expired.' using errcode='28000'; end if;
  if p_write and v_role='management' then raise exception 'Management access is read-only.' using errcode='42501'; end if;
  return v_role;
end
$function$;

create or replace function public.registration_admin_bootstrap(
  p_session_token text,
  p_term_id bigint default null
) returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_role text:=private.registration_session_context(p_session_token,false);
  v_term public.academic_terms%rowtype;
  v_terms jsonb;
  v_rows jsonb;
  v_summary jsonb;
begin
  if p_term_id is null then
    select * into v_term from public.academic_terms
    order by registration_is_open desc,is_current desc,academic_year desc,term_number desc limit 1;
  else select * into v_term from public.academic_terms where id=p_term_id; end if;
  if not found then return jsonb_build_object('status','not_found','message','No academic term is configured.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'academic_year',t.academic_year,'term_number',t.term_number,'term_name',t.term_name,
    'registration_is_open',t.registration_is_open,'is_current',t.is_current,
    'expected',(select count(*) from public.term_registrations r where r.term_id=t.id),
    'submitted',(select count(*) from public.term_registrations r where r.term_id=t.id and r.student_submitted_at is not null),
    'completed',(select count(*) from public.term_registrations r where r.term_id=t.id and r.completed_at is not null)
  ) order by t.academic_year desc,t.term_number desc),'[]'::jsonb) into v_terms
  from public.academic_terms t;
  select jsonb_build_object(
    'expected',count(*),'not_started',count(*) filter(where status='not_started'),
    'draft',count(*) filter(where status='started'),'submitted',count(*) filter(where student_submitted_at is not null),
    'waiting_admin',count(*) filter(where student_submitted_at is not null and completed_at is null),
    'completed',count(*) filter(where completed_at is not null)
  ) into v_summary from public.term_registrations where term_id=v_term.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',tr.id,'student_id',tr.student_id,'student_name',tr.student_name_snapshot,
    'registration_number',tr.registration_number_snapshot,'class_year',tr.class_year_snapshot,
    'status',tr.status,'status_label',private.tr_status_label(tr.status),
    'student_started_at',tr.student_started_at,'student_submitted_at',tr.student_submitted_at,
    'admin_office_complete',tr.admin_office_complete,'fees_complete',tr.fees_complete,
    'accommodation_complete',tr.accommodation_complete,'completed_at',tr.completed_at,
    'accommodation_type',coalesce(tr.accommodation_answers->>'accommodation_type',tr.student_answers->>'accommodation_type'),
    'accommodation_residence',tr.accommodation_residence,'accommodation_room',tr.accommodation_room,
    'sponsor_name',sts.sponsor_name_snapshot,'sponsor_phone',sts.sponsor_phone_snapshot,
    'arrears',coalesce(fs.arrears_previous_terms,0),'amount_paid',coalesce(fs.amount_paid_current_term,0),
    'outstanding_balance',coalesce(fs.outstanding_balance,0),
    'residency_status',coalesce(ip.residency_status,'not_recorded'),'country',ip.country,
    'passport_expiry_date',ip.passport_expiry_date,
    'document_count',(select count(*) from public.student_immigration_documents d where d.student_id=tr.student_id and d.confirmed_at is not null)
  ) order by tr.student_name_snapshot),'[]'::jsonb) into v_rows
  from public.term_registrations tr
  left join public.student_term_sponsors sts on sts.student_id=tr.student_id and sts.term_id=tr.term_id
  left join public.student_term_fee_status fs on fs.student_id=tr.student_id and fs.term_id=tr.term_id
  left join public.student_immigration_profiles ip on ip.student_id=tr.student_id
  where tr.term_id=v_term.id;
  return jsonb_build_object(
    'status','success','role',v_role,'can_edit',v_role<>'management',
    'can_manage_term',v_role in('administrator','it_admin'),
    'selected_term',jsonb_build_object('id',v_term.id,'academic_year',v_term.academic_year,'term_number',v_term.term_number,
      'term_name',v_term.term_name,'registration_is_open',v_term.registration_is_open,'form_schema',v_term.registration_form_schema),
    'terms',v_terms,'summary',v_summary,'registrations',v_rows
  );
end
$function$;

create or replace function public.registration_admin_get(
  p_session_token text,
  p_registration_id uuid
) returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_role text:=private.registration_session_context(p_session_token,false);
  v_reg public.term_registrations%rowtype;
  v_term public.academic_terms%rowtype;
  v_fee jsonb;
  v_sponsor jsonb;
  v_immigration jsonb;
  v_documents jsonb;
  v_history jsonb;
begin
  select * into v_reg from public.term_registrations where id=p_registration_id;
  if not found then return jsonb_build_object('status','not_found','message','Enrolment record not found.'); end if;
  select * into v_term from public.academic_terms where id=v_reg.term_id;
  select to_jsonb(f) into v_fee from public.student_term_fee_status f where f.student_id=v_reg.student_id and f.term_id=v_reg.term_id;
  select to_jsonb(s)||jsonb_build_object('sponsor_name_snapshot',sts.sponsor_name_snapshot,'sponsor_phone_snapshot',sts.sponsor_phone_snapshot)
    into v_sponsor from public.student_term_sponsors sts join public.sponsors s on s.id=sts.sponsor_id
    where sts.student_id=v_reg.student_id and sts.term_id=v_reg.term_id;
  select to_jsonb(ip) into v_immigration from public.student_immigration_profiles ip where ip.student_id=v_reg.student_id;
  select coalesce(jsonb_agg(to_jsonb(d)-'storage_path' order by d.uploaded_at desc),'[]'::jsonb) into v_documents
    from public.student_immigration_documents d where d.student_id=v_reg.student_id and d.confirmed_at is not null;
  select coalesce(jsonb_agg(jsonb_build_object('changed_at',h.changed_at,'actor_role',h.actor_role,'action',h.action,'section',h.section,'note',h.note) order by h.changed_at desc),'[]'::jsonb)
    into v_history from public.term_registration_history h where h.registration_id=v_reg.id;
  return jsonb_build_object('status','success','role',v_role,'can_edit',v_role<>'management',
    'term',jsonb_build_object('id',v_term.id,'term_name',v_term.term_name,'academic_year',v_term.academic_year,'term_number',v_term.term_number,'form_schema',v_term.registration_form_schema),
    'registration',to_jsonb(v_reg)||jsonb_build_object('status_label',private.tr_status_label(v_reg.status)),
    'fee',coalesce(v_fee,'{}'::jsonb),'sponsor',coalesce(v_sponsor,'{}'::jsonb),
    'immigration',coalesce(v_immigration,'{}'::jsonb),'documents',v_documents,'history',v_history);
end
$function$;

create or replace function public.registration_admin_manage_term(
  p_session_token text,
  p_academic_year integer,
  p_term_number integer,
  p_action text,
  p_actor_name text default null
) returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_role text:=private.registration_session_context(p_session_token,true);
  v_term public.academic_terms%rowtype;
  v_due date;
  v_count integer;
  v_student public.students%rowtype;
begin
  if v_role not in('administrator','it_admin') then return jsonb_build_object('status','unauthorized','message','School Administration or IT Administration access is required.'); end if;
  if p_academic_year not between 2020 and 2100 or p_term_number not between 1 and 3 then return jsonb_build_object('status','invalid','message','Choose a valid year and term.'); end if;
  v_due:=make_date(p_academic_year,case p_term_number when 1 then 1 when 2 then 5 else 9 end,case p_term_number when 1 then 15 else 5 end);
  insert into public.academic_terms(academic_year,term_number,term_name,fees_due_date,is_current,registration_form_schema)
  values(p_academic_year,p_term_number,format('Term %s %s',p_term_number,p_academic_year),v_due,false,private.tr_default_form_schema())
  on conflict(academic_year,term_number) do update set term_name=excluded.term_name,registration_form_schema=private.tr_default_form_schema(),updated_at=now()
  returning * into v_term;
  if lower(p_action)='open' then
    update public.academic_terms set registration_is_open=false,
      registration_closed_at=case when registration_is_open then now() else registration_closed_at end,
      registration_updated_by_role=case when registration_is_open then v_role else registration_updated_by_role end,updated_at=now()
    where id<>v_term.id and registration_is_open;
    update public.academic_terms set is_current=false,updated_at=now() where id<>v_term.id and is_current;
    update public.academic_terms set registration_is_open=true,registration_opened_at=now(),registration_closed_at=null,
      registration_updated_by_role=v_role,is_current=true,updated_at=now() where id=v_term.id returning * into v_term;
  elsif lower(p_action)='close' then
    update public.academic_terms set registration_is_open=false,registration_closed_at=now(),registration_updated_by_role=v_role,updated_at=now()
    where id=v_term.id returning * into v_term;
  elsif lower(p_action) not in('create','refresh_expected') then
    return jsonb_build_object('status','invalid','message','Choose Create, Open, Close or Refresh expected students.');
  end if;
  if lower(p_action) in('open','refresh_expected') then
    for v_student in select * from public.students where is_active order by full_name loop
      perform private.tr_seed_registration(v_student,v_term);
    end loop;
  end if;
  select count(*) into v_count from public.term_registrations where term_id=v_term.id;
  insert into public.audit_log(event_type,entity_type,entity_id,actor_role,action,details)
  values('term_registration','academic_term',v_term.id::text,v_role,'registration_term_'||lower(p_action),
    jsonb_build_object('term_name',v_term.term_name,'expected_students',v_count,'actor_name',nullif(btrim(coalesce(p_actor_name,'')),'')));
  return jsonb_build_object('status','success','term_id',v_term.id,'term_name',v_term.term_name,'registration_is_open',v_term.registration_is_open,'expected_students',v_count);
end
$function$;

create or replace function public.registration_admin_save_sponsor(
  p_session_token text,
  p_registration_id uuid,
  p_sponsor jsonb,
  p_actor_name text default null
) returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare v_role text:=private.registration_session_context(p_session_token,true); v_reg public.term_registrations%rowtype; v_id uuid;
begin
  select * into v_reg from public.term_registrations where id=p_registration_id;
  if not found then return jsonb_build_object('status','not_found','message','Enrolment record not found.'); end if;
  if nullif(btrim(coalesce(p_sponsor->>'name','')),'') is null or nullif(btrim(coalesce(p_sponsor->>'phone','')),'') is null then
    return jsonb_build_object('status','invalid','message','Sponsor name and contact number are required.');
  end if;
  v_id:=private.tr_sync_sponsor(v_reg.student_id,v_reg.term_id,p_sponsor->>'name',p_sponsor->>'phone',v_role);
  update public.sponsors set email=nullif(btrim(p_sponsor->>'email'),''),relationship_to_student=nullif(btrim(p_sponsor->>'relationship'),''),
    address=nullif(btrim(p_sponsor->>'address'),''),notes=nullif(btrim(p_sponsor->>'notes'),''),updated_at=now() where id=v_id;
  update public.term_registrations set student_answers=student_answers||jsonb_build_object('sponsor_name',p_sponsor->>'name','sponsor_contact',p_sponsor->>'phone'),updated_at=now() where id=v_reg.id;
  perform private.tr_write_history(v_reg.id,v_role,'sponsor_updated','sponsor',null,p_sponsor,p_actor_name);
  return jsonb_build_object('status','success','message','Sponsor saved.','sponsor_id',v_id);
end
$function$;

create or replace function public.registration_admin_save_record(
  p_session_token text,
  p_registration_id uuid,
  p_admin_answers jsonb,
  p_fees_answers jsonb,
  p_accommodation_answers jsonb,
  p_final_answers jsonb,
  p_staff_note text default null,
  p_finalize boolean default false,
  p_actor_name text default null
) returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_role text:=private.registration_session_context(p_session_token,true);
  v_reg public.term_registrations%rowtype;
  v_term public.academic_terms%rowtype;
  v_admin jsonb; v_fees jsonb; v_accommodation jsonb; v_final jsonb;
  v_admin_missing jsonb; v_fees_missing jsonb; v_accommodation_missing jsonb;
  v_admin_complete boolean; v_fees_complete boolean; v_accommodation_complete boolean;
  v_type text; v_status text;
begin
  select * into v_reg from public.term_registrations where id=p_registration_id for update;
  if not found then return jsonb_build_object('status','not_found','message','Enrolment record not found.'); end if;
  if v_reg.completed_at is not null then return jsonb_build_object('status','locked','message','This enrolment is already complete.'); end if;
  select * into v_term from public.academic_terms where id=v_reg.term_id;
  v_admin:=private.tr_filter_answers(v_term.registration_form_schema->'admin',coalesce(p_admin_answers,'{}'::jsonb));
  v_fees:=private.tr_filter_answers(v_term.registration_form_schema->'fees',coalesce(p_fees_answers,'{}'::jsonb));
  v_accommodation:=private.tr_filter_answers(v_term.registration_form_schema->'accommodation',coalesce(p_accommodation_answers,'{}'::jsonb));
  v_final:=private.tr_filter_answers(v_term.registration_form_schema->'final',coalesce(p_final_answers,'{}'::jsonb));
  v_type:=coalesce(v_accommodation->>'accommodation_type',v_reg.student_answers->>'accommodation_type','');
  v_accommodation:=v_accommodation||jsonb_build_object('accommodation_type',v_type);
  if v_type<>'Shared' then v_accommodation:=v_accommodation-'accommodation_hostel'-'accommodation_room'-'shared_occupants'; end if;
  v_admin_missing:=private.tr_missing_required(v_term.registration_form_schema->'admin',v_admin);
  v_fees_missing:=private.tr_missing_required(v_term.registration_form_schema->'fees',v_fees);
  v_accommodation_missing:=private.tr_missing_required(v_term.registration_form_schema->'accommodation',v_accommodation);
  if v_type='Shared' then
    if nullif(btrim(coalesce(v_accommodation->>'accommodation_hostel','')),'') is null then v_accommodation_missing:=v_accommodation_missing||jsonb_build_array(jsonb_build_object('id','accommodation_hostel','label','Hostel allocated')); end if;
    if nullif(btrim(coalesce(v_accommodation->>'accommodation_room','')),'') is null then v_accommodation_missing:=v_accommodation_missing||jsonb_build_array(jsonb_build_object('id','accommodation_room','label','Room number')); end if;
    if coalesce((v_accommodation->>'shared_occupants')::numeric,0)<1 then v_accommodation_missing:=v_accommodation_missing||jsonb_build_array(jsonb_build_object('id','shared_occupants','label','Number of occupants')); end if;
  elsif v_type<>'Married' then
    v_accommodation_missing:=v_accommodation_missing||jsonb_build_array(jsonb_build_object('id','accommodation_type','label','Accommodation type'));
  end if;
  v_admin_complete:=jsonb_array_length(v_admin_missing)=0;
  v_fees_complete:=jsonb_array_length(v_fees_missing)=0;
  v_accommodation_complete:=jsonb_array_length(v_accommodation_missing)=0;
  if p_finalize and (v_reg.student_submitted_at is null or not v_admin_complete or not v_fees_complete or not v_accommodation_complete) then
    return jsonb_build_object('status','not_ready','message','Complete the student, Admin Office, Fees and Accommodation sections before finalising.',
      'admin_missing',v_admin_missing,'fees_missing',v_fees_missing,'accommodation_missing',v_accommodation_missing);
  end if;
  update public.term_registrations set
    admin_answers=v_admin,fees_answers=v_fees,accommodation_answers=v_accommodation,final_answers=v_final,
    admin_office_complete=v_admin_complete,
    admin_office_completed_at=case when v_admin_complete then coalesce(admin_office_completed_at,now()) else null end,
    admin_office_completed_by_role=case when v_admin_complete then v_role else null end,
    fees_complete=v_fees_complete,
    fees_completed_at=case when v_fees_complete then coalesce(fees_completed_at,now()) else null end,
    fees_completed_by_role=case when v_fees_complete then v_role else null end,
    accommodation_mode=case when v_type='Shared' then 'on_campus' when v_type='Married' then 'off_campus' else 'unconfirmed' end,
    accommodation_residence=case when v_type='Shared' then nullif(btrim(v_accommodation->>'accommodation_hostel'),'') else null end,
    accommodation_room=case when v_type='Shared' then nullif(btrim(v_accommodation->>'accommodation_room'),'') else null end,
    accommodation_complete=v_accommodation_complete,
    accommodation_completed_at=case when v_accommodation_complete then coalesce(accommodation_completed_at,now()) else null end,
    accommodation_completed_by_role=case when v_accommodation_complete then v_role else null end,
    staff_note=nullif(btrim(coalesce(p_staff_note,'')),''),updated_at=now()
  where id=v_reg.id;
  insert into public.student_term_fee_status(
    student_id,term_id,fees_paid,notes,updated_by_role,arrears_previous_terms,amount_paid_current_term,outstanding_balance,payment_plan
  ) values(
    v_reg.student_id,v_reg.term_id,coalesce((v_fees->>'outstanding_balance')::numeric,0)<=0,
    nullif(btrim(coalesce(p_staff_note,'')),''),v_role,
    coalesce((v_fees->>'arrears_previous_terms')::numeric,0),coalesce((v_fees->>'amount_paid_current_term')::numeric,0),
    coalesce((v_fees->>'outstanding_balance')::numeric,0),nullif(btrim(v_fees->>'payment_plan'),'')
  ) on conflict(student_id,term_id) do update set
    fees_paid=excluded.fees_paid,notes=excluded.notes,updated_by_role=excluded.updated_by_role,
    arrears_previous_terms=excluded.arrears_previous_terms,amount_paid_current_term=excluded.amount_paid_current_term,
    outstanding_balance=excluded.outstanding_balance,payment_plan=excluded.payment_plan,updated_at=now();
  update public.accommodation_allocations set is_active=false,allocation_status='checked_out',ended_at=now(),updated_at=now()
  where student_id=v_reg.student_id and is_active and v_type='Married';
  if v_type='Shared' and nullif(btrim(v_accommodation->>'accommodation_hostel'),'') is not null then
    update public.accommodation_allocations set is_active=false,ended_at=now(),updated_at=now()
    where student_id=v_reg.student_id and is_active;
    insert into public.accommodation_allocations(student_id,residence,room,term_label,allocation_status,is_active,allocated_by_role,notes)
    values(v_reg.student_id,btrim(v_accommodation->>'accommodation_hostel'),nullif(btrim(v_accommodation->>'accommodation_room'),''),v_term.term_name,'allocated',true,v_role,'Updated from term enrolment');
  end if;
  v_status:=private.tr_recalculate(v_reg.id);
  if p_finalize then
    update public.term_registrations set completed_at=now(),completed_by_role=v_role,status='completed',student_locked=true,updated_at=now() where id=v_reg.id;
    v_status:='completed';
  end if;
  perform private.tr_write_history(v_reg.id,v_role,case when p_finalize then 'registration_completed' else 'admin_sections_saved' end,'administration',
    null,jsonb_build_object('admin',v_admin,'fees',v_fees,'accommodation',v_accommodation,'final',v_final),p_actor_name);
  return jsonb_build_object('status','success','message',case when p_finalize then 'Enrolment completed.' else 'Administration sections saved.' end,
    'registration_status',v_status,'status_label',private.tr_status_label(v_status));
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('status','invalid','message','Check that every fee amount and occupant count is a valid number.');
end
$function$;

create or replace function public.registration_admin_sponsors(p_session_token text)
returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare v_role text:=private.registration_session_context(p_session_token,false); v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'name',s.name,'phone',s.phone,'email',s.email,'relationship',s.relationship_to_student,
    'address',s.address,'notes',s.notes,'student_count',(select count(distinct sts.student_id) from public.student_term_sponsors sts where sts.sponsor_id=s.id)
  ) order by s.name),'[]'::jsonb) into v_rows from public.sponsors s;
  return jsonb_build_object('status','success','role',v_role,'can_edit',v_role<>'management','sponsors',v_rows);
end
$function$;

create or replace function private.immigration_session_context(p_token text,p_write boolean default false)
returns table(actor_role text,can_edit boolean)
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare v_context record; v_slug text;
begin
  select * into v_context from private.ops_session_context(p_token);
  if not found then raise exception 'Your Department Operations session has expired.' using errcode='28000'; end if;
  if v_context.actor_role='department' then
    select slug into v_slug from public.ops_departments where id=v_context.actor_department_id;
    if v_slug<>'immigration' then raise exception 'Immigration access is required.' using errcode='42501'; end if;
    actor_role:='immigration'; can_edit:=true;
  elsif v_context.actor_role='administrator' then actor_role:='administrator'; can_edit:=true;
  elsif v_context.actor_role='management' then actor_role:='management'; can_edit:=false;
  else raise exception 'Immigration access is required.' using errcode='42501';
  end if;
  if p_write and not can_edit then raise exception 'Management access is read-only.' using errcode='42501'; end if;
  return next;
end
$function$;

create or replace function public.ops_immigration_bootstrap(p_session_token text)
returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare v_context record; v_rows jsonb; v_summary jsonb;
begin
  select * into v_context from private.immigration_session_context(p_session_token,false);
  select coalesce(jsonb_agg(jsonb_build_object(
    'student_id',s.id,'student_name',s.full_name,'registration_number',s.registration_number,'gender',s.gender,
    'residency_status',coalesce(ip.residency_status,'not_recorded'),'country',ip.country,'nationality',ip.nationality,
    'sponsor_id',ip.sponsor_id,'sponsor_name',sp.name,'sponsor_phone',sp.phone,
    'passport_number',ip.passport_number,'passport_issue_date',ip.passport_issue_date,'passport_expiry_date',ip.passport_expiry_date,
    'permit_type',ip.permit_type,'permit_number',ip.permit_number,'permit_issue_date',ip.permit_issue_date,'permit_expiry_date',ip.permit_expiry_date,
    'next_action',ip.next_action,'next_action_date',ip.next_action_date,'notes',ip.notes,'updated_by',ip.updated_by,'updated_at',ip.updated_at,
    'residence',aa.residence,'room',aa.room,
    'documents',coalesce((select jsonb_agg(to_jsonb(d)-'storage_path' order by d.uploaded_at desc) from public.student_immigration_documents d where d.student_id=s.id and d.confirmed_at is not null),'[]'::jsonb)
  ) order by s.full_name),'[]'::jsonb) into v_rows
  from public.students s
  left join public.student_immigration_profiles ip on ip.student_id=s.id
  left join public.sponsors sp on sp.id=ip.sponsor_id
  left join lateral (select a.residence,a.room from public.accommodation_allocations a where a.student_id=s.id and a.is_active order by a.allocated_at desc limit 1) aa on true
  where s.is_active;
  select jsonb_build_object(
    'total',count(*),'local',count(*) filter(where ip.residency_status='local'),
    'international',count(*) filter(where ip.residency_status='international'),
    'not_recorded',count(*) filter(where ip.student_id is null),
    'passports_expiring_90_days',count(*) filter(where ip.passport_expiry_date between current_date and current_date+90),
    'permits_expiring_90_days',count(*) filter(where ip.permit_expiry_date between current_date and current_date+90)
  ) into v_summary from public.students s left join public.student_immigration_profiles ip on ip.student_id=s.id where s.is_active;
  return jsonb_build_object('status','success','role',v_context.actor_role,'can_edit',v_context.can_edit,'summary',v_summary,'students',v_rows);
end
$function$;

create or replace function public.ops_immigration_save_profile(
  p_session_token text,
  p_student_id text,
  p_profile jsonb,
  p_actor_name text
) returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare v_context record; v_status text:=lower(coalesce(p_profile->>'residency_status',''));
begin
  select * into v_context from private.immigration_session_context(p_session_token,true);
  if not exists(select 1 from public.students where id=p_student_id and is_active) then return jsonb_build_object('status','not_found','message','Active student not found.'); end if;
  if v_status not in('local','international') then return jsonb_build_object('status','invalid','message','Choose Local / Zimbabwe-based or International.'); end if;
  if v_status='international' and nullif(btrim(coalesce(p_profile->>'country','')),'') is null then return jsonb_build_object('status','invalid','message','Country is required for an international student.'); end if;
  insert into public.student_immigration_profiles(
    student_id,residency_status,country,nationality,sponsor_id,passport_number,passport_issue_date,passport_expiry_date,
    permit_type,permit_number,permit_issue_date,permit_expiry_date,next_action,next_action_date,notes,updated_by,updated_at
  ) values(
    p_student_id,v_status,
    case when v_status='international' then nullif(btrim(p_profile->>'country'),'') else null end,
    case when v_status='international' then nullif(btrim(p_profile->>'nationality'),'') else null end,
    nullif(p_profile->>'sponsor_id','')::uuid,nullif(btrim(p_profile->>'passport_number'),''),nullif(p_profile->>'passport_issue_date','')::date,nullif(p_profile->>'passport_expiry_date','')::date,
    nullif(btrim(p_profile->>'permit_type'),''),nullif(btrim(p_profile->>'permit_number'),''),nullif(p_profile->>'permit_issue_date','')::date,nullif(p_profile->>'permit_expiry_date','')::date,
    nullif(btrim(p_profile->>'next_action'),''),nullif(p_profile->>'next_action_date','')::date,nullif(btrim(p_profile->>'notes'),''),nullif(btrim(p_actor_name),''),now()
  ) on conflict(student_id) do update set
    residency_status=excluded.residency_status,country=excluded.country,nationality=excluded.nationality,sponsor_id=excluded.sponsor_id,
    passport_number=excluded.passport_number,passport_issue_date=excluded.passport_issue_date,passport_expiry_date=excluded.passport_expiry_date,
    permit_type=excluded.permit_type,permit_number=excluded.permit_number,permit_issue_date=excluded.permit_issue_date,permit_expiry_date=excluded.permit_expiry_date,
    next_action=excluded.next_action,next_action_date=excluded.next_action_date,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=now();
  insert into public.audit_log(event_type,entity_type,entity_id,actor_role,action,details)
  values('immigration','student',p_student_id,v_context.actor_role,'profile_saved',jsonb_build_object('actor_name',nullif(btrim(p_actor_name),''),'residency_status',v_status));
  return jsonb_build_object('status','success','message','Immigration record saved.');
exception when invalid_text_representation then return jsonb_build_object('status','invalid','message','Check the sponsor and date fields.');
end
$function$;

create or replace function public.ops_immigration_save_sponsor(
  p_session_token text,
  p_student_id text,
  p_sponsor jsonb,
  p_actor_name text
) returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare v_context record; v_id uuid; v_term_id bigint;
begin
  select * into v_context from private.immigration_session_context(p_session_token,true);
  if nullif(btrim(coalesce(p_sponsor->>'name','')),'') is null or nullif(btrim(coalesce(p_sponsor->>'phone','')),'') is null then
    return jsonb_build_object('status','invalid','message','Sponsor name and contact number are required.');
  end if;
  select id into v_term_id from public.academic_terms order by is_current desc,academic_year desc,term_number desc limit 1;
  if v_term_id is null then return jsonb_build_object('status','not_found','message','No academic term is configured.'); end if;
  v_id:=private.tr_sync_sponsor(p_student_id,v_term_id,p_sponsor->>'name',p_sponsor->>'phone',v_context.actor_role);
  update public.sponsors set email=nullif(btrim(p_sponsor->>'email'),''),relationship_to_student=nullif(btrim(p_sponsor->>'relationship'),''),
    address=nullif(btrim(p_sponsor->>'address'),''),notes=nullif(btrim(p_sponsor->>'notes'),''),updated_at=now() where id=v_id;
  insert into public.student_immigration_profiles(student_id,sponsor_id,updated_by)
  values(p_student_id,v_id,nullif(btrim(p_actor_name),''))
  on conflict(student_id) do update set sponsor_id=excluded.sponsor_id,updated_by=excluded.updated_by,updated_at=now();
  return jsonb_build_object('status','success','message','Sponsor saved.','sponsor_id',v_id);
end
$function$;

create or replace function public.immigration_document_authorize(
  p_session_type text,
  p_session_token text,
  p_action text,
  p_student_id text default null,
  p_document_id uuid default null,
  p_file_name text default null,
  p_document_type text default null,
  p_mime_type text default null,
  p_file_size bigint default null
) returns jsonb
language plpgsql security definer
set search_path='public','private','pg_catalog'
as $function$
declare
  v_role text; v_can_edit boolean; v_context record; v_doc public.student_immigration_documents%rowtype;
  v_id uuid; v_safe_name text; v_path text;
begin
  if lower(coalesce(p_session_type,''))='ops' then
    select * into v_context from private.immigration_session_context(p_session_token,p_action in('prepare_upload','confirm_upload','delete'));
    v_role:=v_context.actor_role; v_can_edit:=v_context.can_edit;
  elsif lower(coalesce(p_session_type,''))='system' then
    select c.role_key into v_role from private.system_session_context(p_session_token,array['administrator','it_admin','admin_staff','management']) c limit 1;
    if v_role is null then raise exception 'Your Administration session has expired.' using errcode='28000'; end if;
    v_can_edit:=v_role<>'management';
    if p_action in('prepare_upload','confirm_upload','delete') and not v_can_edit then raise exception 'Management access is read-only.' using errcode='42501'; end if;
  else return jsonb_build_object('status','invalid','message','Unknown session type.'); end if;
  if p_action='prepare_upload' then
    if not exists(select 1 from public.students where id=p_student_id and is_active) then return jsonb_build_object('status','not_found','message','Student not found.'); end if;
    if p_mime_type not in('application/pdf','image/jpeg','image/png','image/webp') then return jsonb_build_object('status','invalid','message','Upload a PDF, JPEG, PNG or WebP file.'); end if;
    if coalesce(p_file_size,0)<1 or p_file_size>10485760 then return jsonb_build_object('status','invalid','message','The document must be no larger than 10 MB.'); end if;
    v_id:=gen_random_uuid();
    v_safe_name:=regexp_replace(lower(coalesce(p_file_name,'document')),'[^a-z0-9._-]+','-','g');
    v_path:=p_student_id||'/'||v_id::text||'-'||left(v_safe_name,100);
    insert into public.student_immigration_documents(id,student_id,document_type,file_name,storage_path,mime_type,file_size,uploaded_by)
    values(v_id,p_student_id,coalesce(nullif(btrim(p_document_type),''),'Other'),coalesce(nullif(btrim(p_file_name),''),'document'),v_path,p_mime_type,p_file_size,v_role);
    return jsonb_build_object('status','success','allowed',true,'bucket','immigration-documents','document_id',v_id,'storage_path',v_path);
  end if;
  select * into v_doc from public.student_immigration_documents where id=p_document_id;
  if not found then return jsonb_build_object('status','not_found','message','Document not found.'); end if;
  if p_student_id is not null and v_doc.student_id<>p_student_id then return jsonb_build_object('status','unauthorized','message','Document does not belong to this student.'); end if;
  return jsonb_build_object('status','success','allowed',true,'can_edit',v_can_edit,'bucket','immigration-documents',
    'document_id',v_doc.id,'student_id',v_doc.student_id,'storage_path',v_doc.storage_path,'file_name',v_doc.file_name,'mime_type',v_doc.mime_type);
end
$function$;

revoke all on function public.student_term_registration_status() from public;
revoke all on function public.registration_admin_bootstrap(text,bigint) from public;
revoke all on function public.registration_admin_get(text,uuid) from public;
revoke all on function public.registration_admin_manage_term(text,integer,integer,text,text) from public;
revoke all on function public.registration_admin_save_sponsor(text,uuid,jsonb,text) from public;
revoke all on function public.registration_admin_save_record(text,uuid,jsonb,jsonb,jsonb,jsonb,text,boolean,text) from public;
revoke all on function public.registration_admin_sponsors(text) from public;
revoke all on function public.ops_immigration_bootstrap(text) from public;
revoke all on function public.ops_immigration_save_profile(text,text,jsonb,text) from public;
revoke all on function public.ops_immigration_save_sponsor(text,text,jsonb,text) from public;
revoke all on function public.immigration_document_authorize(text,text,text,text,uuid,text,text,text,bigint) from public;

grant execute on function public.student_term_registration_status() to anon,authenticated;
grant execute on function public.registration_admin_bootstrap(text,bigint) to anon,authenticated;
grant execute on function public.registration_admin_get(text,uuid) to anon,authenticated;
grant execute on function public.registration_admin_manage_term(text,integer,integer,text,text) to anon,authenticated;
grant execute on function public.registration_admin_save_sponsor(text,uuid,jsonb,text) to anon,authenticated;
grant execute on function public.registration_admin_save_record(text,uuid,jsonb,jsonb,jsonb,jsonb,text,boolean,text) to anon,authenticated;
grant execute on function public.registration_admin_sponsors(text) to anon,authenticated;
grant execute on function public.ops_immigration_bootstrap(text) to anon,authenticated;
grant execute on function public.ops_immigration_save_profile(text,text,jsonb,text) to anon,authenticated;
grant execute on function public.ops_immigration_save_sponsor(text,text,jsonb,text) to anon,authenticated;
grant execute on function public.immigration_document_authorize(text,text,text,text,uuid,text,text,text,bigint) to anon,authenticated;

notify pgrst,'reload schema';
