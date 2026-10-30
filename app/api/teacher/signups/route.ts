import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError } from "@/lib/auth";

/** Pending sign-ups for classes THIS teacher is assigned to. */
export async function GET() {
  try {
    const me = await requireUser(["teacher"]);
    const { data: a } = await admin.from("teacher_assignments").select("subject_id,section_id").eq("teacher_id", me.id);
    const mine = new Set((a ?? []).map(x => x.subject_id + x.section_id));
    const { data } = await admin.from("signup_requests")
      .select("id,student_id,full_name,subject_id,section_id,created_at,subjects(code,name),class_sections(name)")
      .eq("state", "pending").order("created_at");
    return Response.json({ requests: (data ?? []).filter(r => mine.has(r.subject_id + r.section_id)) });
  } catch (e) { return fail(e); }
}

const Decide = z.object({ requestId: z.string().uuid(), approve: z.boolean(), reason: z.string().max(300).optional(), identityChecked: z.boolean().optional() });
const ERR: Record<string, [number, string]> = {
  forbidden: [403, "This request is not for one of your classes."],
  request_not_pending: [409, "This request was already handled."],
  reason_required: [400, "Please give a short reason for declining."],
};

export async function POST(req: Request) {
  try {
    const me = await requireUser(["teacher"]);
    const b = Decide.parse(await req.json());
    if (b.approve && b.identityChecked !== true) throw new HttpError(400, "Confirm that you checked this student against your class list.");
    const { data: rq } = await admin.from("signup_requests").select("user_id").eq("id", b.requestId).maybeSingle();
    const { data, error } = await admin.rpc("decide_signup", { p_teacher: me.id, p_request: b.requestId, p_approve: b.approve, p_reason: b.reason ?? "" });
    if (error) { const k = Object.keys(ERR).find(k => error.message.includes(k)); if (k) throw new HttpError(...ERR[k]); throw error; }
    // A declined account is removed so the real student can register again with the same ID.
    if (data === "rejected" && rq?.user_id) await admin.auth.admin.deleteUser(rq.user_id);
    return Response.json({ result: data });
  } catch (e) { return fail(e); }
}
