# Classroom attendance codes + WebAuthn (drop-in for your Next.js/Supabase app)

## Setup
1. `npm i @supabase/supabase-js @supabase/ssr @simplewebauthn/server @simplewebauthn/browser zod`
2. Run `001_classroom_attendance.sql`, then `002_fallback_verification.sql`, in the Supabase SQL editor.
3. Copy `.env.example` to `.env.local` and fill it in. On Vercel add the same variables (Project Settings > Environment Variables).
   `WEBAUTHN_RP_ID` must be the exact hostname users visit; passkeys are bound to it.
4. Create the first admin: Supabase dashboard > Auth > add user, then
   `insert into profiles(id, role, full_name) values ('<uuid>', 'admin', 'Your Name');`
5. Copy `lib/`, `app/api/`, `components/` into your project (keep the `@/` alias).

## Student login
Students sign in with `supabase.auth.signInWithPassword({ email: `${studentId.toLowerCase()}@students.invalid`, password })`.
Accounts exist only via `POST /api/admin/students` (admin only); there is no public sign-up. Disable "Allow new users to sign up" in Auth settings.

## Flow and where each check lives
- Teacher: `POST /api/teacher/sessions/start` > `POST /api/teacher/code` (returns the code once) > `DELETE /api/teacher/code` / `POST /api/teacher/sessions/close`.
- Student: `POST /api/attendance/verify-code` (enrollment, session open, code hash, expiry, rate limit) > browser passkey prompt > `POST /api/attendance/submit` (challenge single-use + expiry, signature/origin/rpID, counter, then `record_attendance()` re-checks under row locks; unique(student, session) blocks duplicates).

## Testing checklist
- Wrong code 5x > 429 for 10 minutes. Expired code > rejected even if the timer is manipulated in the browser.
- Regenerate code, then submit with the old challenge > `code_revoked`.
- Close session, then submit > `session_not_open`.
- Student B replays Student A's `challengeId` > "Verification expired" (challenge pinned to student).
- Reusing a completed `challengeId` > rejected (consumed).
- Direct `supabase.from('attendance_records').insert(...)` with a student JWT > denied by RLS.
- Student not enrolled > `not_enrolled`. Second submit > `already_recorded`.

## Alternative verification (no fingerprint / no passkey support)
- Student UI detects WebAuthn support and a platform authenticator. If unsupported, enrollment fails, or the passkey prompt fails, it shows **Request Alternative Verification**.
- `POST /api/attendance/fallback` needs: logged in, enrolled, session open, and the **current unexpired code** (same rate-limited gate as the passkey path). It only creates a `pending` request (expires in `fallback_request_minutes`, default 10, never after the attendance window).
- `GET/POST /api/teacher/fallback`: the session's own teacher lists, approves or declines. Approval requires an in-person identity confirmation and a written reason. `decide_fallback()` runs atomically: it blocks self-approval, other teachers' sessions, expired requests, closed sessions, non-enrolled students and duplicates.
- Records carry `verification_method` = `passkey` | `teacher_approved_fallback`, plus `approved_by` and `approval_reason`. Nothing is ever auto-approved.
- Policy: `update system_settings set value='false' where key='fallback_enabled';` turns the fallback off.
- Recovery (lost or replaced phone): `POST /api/admin/students/reset-passkeys` clears the student's passkeys (audited); they sign in and register a new one. Teacher fallback covers attendance meanwhile.
- Honesty note: WebAuthn only reports that *user verification* happened, not whether it was a fingerprint, face or PIN. The app therefore says "passkey" and never claims fingerprint. WebAuthn cannot restrict to biometrics only.
- Extra tests: unsupported browser shows the button; request with a wrong or expired code fails; teacher B cannot decide teacher A's request; approving twice gives `request_not_pending`; passkey check-in after a pending request marks it `superseded`.

## Not included yet
Teacher/admin/student dashboard pages, CSV export, correction-approval endpoints (table exists), and automated tests.
