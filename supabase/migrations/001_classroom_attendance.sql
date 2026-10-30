-- Classroom attendance codes + student auth + WebAuthn.
-- Run in the Supabase SQL editor (or `supabase db push`).
create extension if not exists pgcrypto;

create type user_role as enum ('admin','teacher','student');
create type account_status as enum ('active','suspended','pending');
create type session_status as enum ('scheduled','active','closed');
create type attendance_status as enum ('present','late','excused','absent');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null,
  full_name text not null,
  status account_status not null default 'active',
  created_at timestamptz not null default now()
);

create table subjects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text
);

create table class_sections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  academic_term text not null,
  course text not null,
  unique (name, academic_term, course)
);

create table student_profiles (
  user_id uuid primary key references profiles(id) on delete cascade,
  student_id text not null unique check (student_id ~ '^[A-Za-z0-9-]{3,32}$'),
  full_name text not null,
  section_id uuid references class_sections(id),
  status account_status not null default 'active'
);

create table class_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references student_profiles(user_id) on delete cascade,
  subject_id uuid not null references subjects(id),
  section_id uuid not null references class_sections(id),
  status text not null default 'enrolled' check (status in ('enrolled','dropped')),
  unique (student_user_id, subject_id, section_id)
);
create index on class_enrollments (subject_id, section_id);

create table teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  subject_id uuid not null references subjects(id),
  section_id uuid not null references class_sections(id),
  unique (teacher_id, subject_id, section_id)
);

create table class_sessions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id),
  section_id uuid not null references class_sections(id),
  teacher_id uuid not null references profiles(id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  attendance_opens_at timestamptz not null default now(),
  attendance_closes_at timestamptz not null,
  late_after_minutes int not null default 15,
  status session_status not null default 'active',
  check (attendance_closes_at > attendance_opens_at)
);
create index on class_sessions (teacher_id, status);
create index on class_sessions (subject_id, section_id, status);

create table attendance_codes (
  id uuid primary key default gen_random_uuid(),
  class_session_id uuid not null references class_sessions(id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  invalidated_at timestamptz
);
-- at most one live code per session
create unique index one_live_code_per_session
  on attendance_codes (class_session_id) where invalidated_at is null;

create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references student_profiles(user_id),
  class_session_id uuid not null references class_sessions(id),
  recorded_at timestamptz not null default now(),
  status attendance_status not null,
  verification jsonb not null default '{}',  -- non-sensitive metadata only
  unique (student_user_id, class_session_id)  -- one initial record per student per session
);
create index on attendance_records (class_session_id);

create table attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  class_session_id uuid not null references class_sessions(id),
  student_user_id uuid not null references student_profiles(user_id),
  requested_by uuid not null references profiles(id),
  new_status attendance_status not null,
  reason text not null,
  kind text not null default 'correction' check (kind in ('correction','device_exception')),
  state text not null default 'pending' check (state in ('pending','approved','rejected')),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references student_profiles(user_id) on delete cascade,
  credential_id text not null unique,   -- base64url
  public_key text not null,             -- base64url COSE key
  counter bigint not null default 0,
  transports text[],
  device_label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references student_profiles(user_id) on delete cascade,
  purpose text not null check (purpose in ('register','authenticate')),
  challenge text not null,
  class_session_id uuid references class_sessions(id),
  code_id uuid references attendance_codes(id),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table attendance_attempts (
  id bigserial primary key,
  student_user_id uuid references profiles(id),
  class_session_id uuid,
  ip text,
  ok boolean not null,
  reason text,
  created_at timestamptz not null default now()
);
create index on attendance_attempts (student_user_id, created_at desc);
create index on attendance_attempts (ip, created_at desc);

create table audit_logs (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  entity text,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- helpers -------------------------------------------------------------
create or replace function auth_role() returns user_role
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and status = 'active' $$;

create or replace function teaches(p_subject uuid, p_section uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from teacher_assignments
   where teacher_id = auth.uid() and subject_id = p_subject and section_id = p_section) $$;

-- RLS: clients get READ access only. Every write goes through server
-- endpoints using the service role.
alter table profiles enable row level security;
alter table subjects enable row level security;
alter table class_sections enable row level security;
alter table student_profiles enable row level security;
alter table class_enrollments enable row level security;
alter table teacher_assignments enable row level security;
alter table class_sessions enable row level security;
alter table attendance_codes enable row level security;       -- no policies = no client access
alter table attendance_records enable row level security;
alter table attendance_corrections enable row level security;
alter table webauthn_credentials enable row level security;
alter table webauthn_challenges enable row level security;    -- no policies
alter table attendance_attempts enable row level security;    -- no policies
alter table audit_logs enable row level security;

create policy p_profiles on profiles for select
  using (id = auth.uid() or auth_role() = 'admin');
create policy p_subjects on subjects for select using (auth.uid() is not null);
create policy p_sections on class_sections for select using (auth.uid() is not null);
create policy p_students on student_profiles for select using (
  user_id = auth.uid() or auth_role() = 'admin' or exists (
    select 1 from class_enrollments e join teacher_assignments t
      on t.subject_id = e.subject_id and t.section_id = e.section_id
    where e.student_user_id = student_profiles.user_id and t.teacher_id = auth.uid()));
create policy p_enroll on class_enrollments for select using (
  student_user_id = auth.uid() or auth_role() = 'admin' or teaches(subject_id, section_id));
create policy p_assign on teacher_assignments for select
  using (teacher_id = auth.uid() or auth_role() = 'admin');
create policy p_sessions on class_sessions for select using (
  auth_role() = 'admin' or teacher_id = auth.uid() or (status = 'active' and exists (
    select 1 from class_enrollments e where e.student_user_id = auth.uid()
      and e.subject_id = class_sessions.subject_id
      and e.section_id = class_sessions.section_id and e.status = 'enrolled')));
create policy p_records on attendance_records for select using (
  student_user_id = auth.uid() or auth_role() = 'admin' or exists (
    select 1 from class_sessions s where s.id = class_session_id and s.teacher_id = auth.uid()));
create policy p_corr on attendance_corrections for select
  using (auth_role() = 'admin' or requested_by = auth.uid());
create policy p_creds on webauthn_credentials for select using (student_user_id = auth.uid());
create policy p_audit on audit_logs for select
  using (auth_role() = 'admin' or actor_id = auth.uid());

-- Atomic code rotation -------------------------------------------------
create or replace function rotate_attendance_code(
  p_teacher uuid, p_session uuid, p_hash text, p_ttl_seconds int)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare s class_sessions; exp timestamptz;
begin
  select * into s from class_sessions where id = p_session for update;
  if not found or s.teacher_id <> p_teacher then raise exception 'forbidden'; end if;
  if s.status <> 'active' or now() >= s.attendance_closes_at then
    raise exception 'session_not_open'; end if;
  if p_ttl_seconds < 30 or p_ttl_seconds > 3600 then raise exception 'bad_ttl'; end if;
  update attendance_codes set invalidated_at = now()
    where class_session_id = p_session and invalidated_at is null;
  exp := least(now() + make_interval(secs => p_ttl_seconds), s.attendance_closes_at);
  insert into attendance_codes (class_session_id, code_hash, expires_at)
    values (p_session, p_hash, exp);
  insert into audit_logs (actor_id, action, entity, entity_id, metadata)
    values (p_teacher, 'code_rotated', 'class_session', p_session,
            jsonb_build_object('ttl', p_ttl_seconds));
  return exp;
end $$;

-- Atomic attendance write: re-checks everything under row locks ----------
create or replace function record_attendance(
  p_student uuid, p_session uuid, p_code uuid, p_meta jsonb)
returns attendance_records language plpgsql security definer set search_path = public as $$
declare s class_sessions; r attendance_records; st attendance_status;
begin
  select * into s from class_sessions where id = p_session for share;
  if not found or s.status <> 'active' or now() < s.attendance_opens_at
     or now() >= s.attendance_closes_at then raise exception 'session_not_open'; end if;
  if not exists (select 1 from attendance_codes
      where id = p_code and class_session_id = p_session and invalidated_at is null) then
    raise exception 'code_revoked'; end if;
  if not exists (select 1 from class_enrollments e
      join student_profiles sp on sp.user_id = e.student_user_id
      where e.student_user_id = p_student and e.subject_id = s.subject_id
        and e.section_id = s.section_id and e.status = 'enrolled' and sp.status = 'active') then
    raise exception 'not_enrolled'; end if;
  st := case when now() > s.attendance_opens_at + make_interval(mins => s.late_after_minutes)
             then 'late' else 'present' end;
  begin
    insert into attendance_records (student_user_id, class_session_id, status, verification)
      values (p_student, p_session, st, p_meta) returning * into r;
  exception when unique_violation then raise exception 'already_recorded'; end;
  insert into audit_logs (actor_id, action, entity, entity_id, metadata)
    values (p_student, 'check_in', 'class_session', p_session,
            jsonb_build_object('status', st));
  return r;
end $$;

revoke all on function rotate_attendance_code(uuid,uuid,text,int) from public, anon, authenticated;
revoke all on function record_attendance(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function rotate_attendance_code(uuid,uuid,text,int) to service_role;
grant execute on function record_attendance(uuid,uuid,uuid,jsonb) to service_role;
