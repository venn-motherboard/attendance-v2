-- Student self sign-up with teacher approval. Run after 001 and 002.

create table signup_requests (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  full_name text not null,
  user_id uuid references auth.users(id) on delete set null,
  subject_id uuid not null references subjects(id),
  section_id uuid not null references class_sections(id),
  state text not null default 'pending' check (state in ('pending','approved','rejected')),
  ip text,
  created_at timestamptz not null default now(),
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  decision_reason text
);
create unique index one_pending_signup_per_id on signup_requests (student_id) where state = 'pending';
create index on signup_requests (subject_id, section_id, state);
create index on signup_requests (ip, created_at desc);

-- Server-only table: no client policies.
alter table signup_requests enable row level security;

-- Approve or reject in one atomic step. Only a teacher assigned to that exact class may decide.
create or replace function decide_signup(
  p_teacher uuid, p_request uuid, p_approve boolean, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare r signup_requests;
begin
  select * into r from signup_requests where id = p_request for update;
  if not found or r.state <> 'pending' or r.user_id is null then
    raise exception 'request_not_pending'; end if;
  if not exists (select 1 from teacher_assignments
      where teacher_id = p_teacher and subject_id = r.subject_id and section_id = r.section_id) then
    raise exception 'forbidden'; end if;

  if p_approve then
    update profiles set status = 'active' where id = r.user_id;
    update student_profiles set status = 'active', section_id = r.section_id where user_id = r.user_id;
    insert into class_enrollments (student_user_id, subject_id, section_id)
      values (r.user_id, r.subject_id, r.section_id) on conflict do nothing;
    update signup_requests set state = 'approved', decided_by = p_teacher,
      decided_at = now(), decision_reason = p_reason where id = r.id;
    insert into audit_logs (actor_id, action, entity, entity_id, metadata)
      values (p_teacher, 'signup_approved', 'signup_request', r.id,
              jsonb_build_object('student_id', r.student_id));
    return 'approved';
  end if;

  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required'; end if;
  update signup_requests set state = 'rejected', decided_by = p_teacher,
    decided_at = now(), decision_reason = p_reason where id = r.id;
  insert into audit_logs (actor_id, action, entity, entity_id, metadata)
    values (p_teacher, 'signup_rejected', 'signup_request', r.id,
            jsonb_build_object('student_id', r.student_id));
  return 'rejected';
end $$;

revoke all on function decide_signup(uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function decide_signup(uuid,uuid,boolean,text) to service_role;
