import { admin } from "./supabase-admin";
import { HttpError } from "./auth";
import { codeMatches } from "./codes";

const WINDOW_MS = 10 * 60_000, MAX_FAILS_STUDENT = 5, MAX_FAILS_IP = 25;

/** Shared gate for BOTH the passkey path and the fallback-request path:
 *  rate limit, session open, student enrolled, current code valid and unexpired.
 *  Every failure returns the same generic message so nothing leaks about which check failed. */
export async function checkCodeEligibility(userId: string, sessionId: string, code: string, ip: string) {
  const log = (ok: boolean, reason: string) =>
    admin.from("attendance_attempts").insert({ student_user_id: userId, class_session_id: sessionId, ip, ok, reason });

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const [{ count: sf }, { count: ipf }] = await Promise.all([
    admin.from("attendance_attempts").select("id", { count: "exact", head: true }).eq("student_user_id", userId).eq("ok", false).gte("created_at", since),
    admin.from("attendance_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).eq("ok", false).gte("created_at", since),
  ]);
  if ((sf ?? 0) >= MAX_FAILS_STUDENT || (ipf ?? 0) >= MAX_FAILS_IP) {
    await log(false, "rate_limited");
    throw new HttpError(429, "Too many invalid attempts. Wait a few minutes and try again.");
  }

  const { data: s } = await admin.from("class_sessions")
    .select("id,subject_id,section_id,status,attendance_opens_at,attendance_closes_at,subjects(name)")
    .eq("id", sessionId).maybeSingle();
  const now = Date.now();
  const open = !!s && s.status === "active" && now >= +new Date(s.attendance_opens_at) && now < +new Date(s.attendance_closes_at);
  const { data: enr } = s
    ? await admin.from("class_enrollments").select("id").eq("student_user_id", userId)
        .eq("subject_id", s.subject_id).eq("section_id", s.section_id).eq("status", "enrolled").maybeSingle()
    : { data: null };
  const { data: c } = await admin.from("attendance_codes").select("id,code_hash,expires_at")
    .eq("class_session_id", sessionId).is("invalidated_at", null).maybeSingle();

  const good = !!(open && enr && c && +new Date(c.expires_at) > now && codeMatches(sessionId, code, c.code_hash));
  if (!good) {
    await log(false, "invalid");
    throw new HttpError(400, "Invalid or expired code, or attendance is not open.");
  }
  await log(true, "code_ok");
  return { subject: (s as any).subjects?.name as string, codeId: c!.id as string, closesAt: s!.attendance_closes_at as string };
}
