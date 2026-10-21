import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError } from "@/lib/auth";

/** Teacher's pending queue for one of THEIR sessions. */
export async function GET(req: Request) {
  try {
    const me = await requireUser(["teacher"]);
    const sessionId = z.string().uuid().parse(new URL(req.url).searchParams.get("sessionId"));
    const { data: s } = await admin.from("class_sessions").select("id").eq("id", sessionId).eq("teacher_id", me.id).maybeSingle();
    if (!s) throw new HttpError(403, "Forbidden");
    const { data } = await admin.from("fallback_requests")
      .select("id,reason_code,student_note,created_at,expires_at,student_profiles(student_id,full_name)")
      .eq("class_session_id", sessionId).eq("state", "pending").gt("expires_at", new Date().toISOString()).order("created_at");
    return Response.json({ requests: data ?? [] });
  } catch (e) { return fail(e); }
}

const Decide = z.object({
  requestId: z.string().uuid(), approve: z.boolean(),
  reason: z.string().min(5).max(300),
  identityVerifiedInPerson: z.boolean().optional(),
});
const ERR: Record<string, [number, string]> = {
  forbidden: [403, "This request is not for one of your classes."],
  self_approval: [403, "You cannot approve your own attendance."],
  request_not_pending: [409, "This request was already handled or replaced."],
  session_not_open: [409, "Attendance is closed for this session."],
  not_enrolled: [403, "This student is not enrolled in the class."],
  already_recorded: [409, "Attendance is already recorded for this student."],
  reason_required: [400, "A reason of at least 5 characters is required."],
};

export async function POST(req: Request) {
  try {
    const me = await requireUser(["teacher"]);
    const b = Decide.parse(await req.json());
    if (b.approve && b.identityVerifiedInPerson !== true)
      throw new HttpError(400, "Confirm that you verified the student's identity before approving.");
    const { data, error } = await admin.rpc("decide_fallback", {
      p_teacher: me.id, p_request: b.requestId, p_approve: b.approve, p_reason: b.reason,
    });
    if (error) { const k = Object.keys(ERR).find(k => error.message.includes(k)); if (k) throw new HttpError(...ERR[k]); throw error; }
    if (data === "expired") throw new HttpError(409, "This request expired. Ask the student to submit a new one.");
    return Response.json({ result: data });
  } catch (e) { return fail(e); }
}
