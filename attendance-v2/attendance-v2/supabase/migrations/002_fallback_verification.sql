-- Alternative verification for students without passkey support.
-- Run after 001.

-- Institution policy (edit with SQL or an admin endpoint; clients can only read) ----------
create table system_settings (
  key text primary key,
  value jsonb not null
);
insert into system_settings (key, value) values
  ('fallback_enabled', 'true'),
  ('fallback_request_minutes', '10');
alter table system_settings enable row level security;
create policy p_settings on system_settings for select using (auth.uid() is not null);

-- Record HOW each check-in was verified ---------------------------------------------------
alter table attendance_records
  add column verification_method text not null default 'passkey'
    check (verification_method in ('passkey','teacher_approved_fallback')),
  add column approved_by uuid references profiles(id),
  add column approval_reason text;
alter table attendance_records alter column verification_method drop default;
alter table attendance_records add constraint method_consistency check (
  (verification_method = 'passkey' and approved_by is null and approval_reason is null) or
  (verification_method = 'teacher_approved_fallback' and approved_by is not null and approval_reason is not null));

-- Fallback requests -----------------------------------------------------------------------
create table fallback_requests (
  id uuid primary key default gen_random_uuid(),
  class_session_id uuid not null references class_sessions(id),
  student_user_id uuid not null references student_profiles(user_id),
  code_id uuid not null references attendance_codes(id),   -- the code the student proved they had
  reason_code text not null check (reason_code in
    ('webauthn_unsupported','no_biometric_sensor','enrollment_failed','verification_failed','other')),
  student_note text check (char_length(student_note) <= 300),
  state text not null default 'pending'
    check (state in ('pending','approved','rejected','expired','superseded')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_reason text
);
-- one open request per student per session
create unique index one_pending_fallback on fallback_requests (class_session_id, student_user_id)
  where state = 'pending';
create index on fallback_requests (class_session_id, state);

alter table fallback_requests enable row level security;
create policy p_fb_student on fallback_requests for select using (student_user_id = auth.uid());
create policy p_fb_teacher on fallback_requests for select using (
  auth_role() = 'admin' or exists (
    select 1 from class_sessions s where s.id = class_session_id and s.teacher_id = auth.uid()));
-- no insert/update/delete policies: writes happen only through the functions below.

-- Passkey check-in now records its method; also closes any pending fallback request -------
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
    insert into attendance_records
      (student_user_id, class_session_id, status, verification_method, verification)
      values (p_student, p_session, st, 'passkey', p_meta) returning * into r;
  exception when unique_violation then raise exception 'already_recorded'; end;
  update fallback_requests set state = 'superseded'
    where class_session_id = p_session and student_user_id = p_student and state = 'pending';
  insert into audit_logs (actor_id, action, entity, entity_id, metadata)
    values (p_student, 'check_in', 'class_session', p_session,
            jsonb_build_object('status', st, 'method', 'passkey'));
  return r;
end $$;

-- Teacher decision: approve or reject, atomically ---------------------------------------
create or replace function decide_fallback(
  p_teacher uuid, p_request uuid, p_approve boolean, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare f fallback_requests; s class_sessions; st attendance_status;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required'; end if;
  select * into f from fallback_requests where id = p_request for update;
  if not found or f.state <> 'pending' then raise exception 'request_not_pending'; end if;
  select * into s from class_sessions where id = f.class_session_id for share;
  if s.teacher_id <> p_teacher then raise exception 'forbidden'; end if;
  if p_teacher = f.student_user_id then raise exception 'self_approval'; end if;

  if f.expires_at <= now() then
    update fallback_requests set state = 'expired' where id = f.id;
    return 'expired';
  end if;

  if not p_approve then
    update fallback_requests set state = 'rejected', decided_by = p_teacher,
      decided_at = now(), decision_reason = p_reason where id = f.id;
    insert into audit_logs (actor_id, action, entity, entity_id, metadata)
      values (p_teacher, 'fallback_rejected', 'fallback_request', f.id,
              jsonb_build_object('student', f.student_user_id, 'session', f.class_session_id));
    return 'rejected';
  end if;

  if s.status <> 'active' or now() >= s.attendance_closes_at then
    raise exception 'session_not_open'; end if;
  if not exists (select 1 from class_enrollments e
      join student_profiles sp on sp.user_id = e.student_user_id
      where e.student_user_id = f.student_user_id and e.subject_id = s.subject_id
        and e.section_id = s.section_id and e.status = 'enrolled' and sp.status = 'active') then
    raise exception 'not_enrolled'; end if;

  st := case when now() > s.attendance_opens_at + make_interval(mins => s.late_after_minutes)
             then 'late' else 'present' end;
  begin
    insert into attendance_records
      (student_user_id, class_session_id, status, verification_method,
       approved_by, approval_reason, verification)
      values (f.student_user_id, f.class_session_id, st, 'teacher_approved_fallback',
              p_teacher, p_reason, jsonb_build_object('request', f.id, 'reason_code', f.reason_code));
  exception when unique_violation then raise exception 'already_recorded'; end;

  update fallback_requests set state = 'approved', decided_by = p_teacher,
    decided_at = now(), decision_reason = p_reason where id = f.id;
  insert into audit_logs (actor_id, action, entity, entity_id, metadata)
    values (p_teacher, 'fallback_approved', 'fallback_request', f.id,
            jsonb_build_object('student', f.student_user_id, 'session', f.class_session_id, 'status', st));
  return 'approved';
end $$;

revoke all on function record_attendance(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function decide_fallback(uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function record_attendance(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function decide_fallback(uuid,uuid,boolean,text) to service_role;
