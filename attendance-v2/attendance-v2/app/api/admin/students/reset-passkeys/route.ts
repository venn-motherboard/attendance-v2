import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError } from "@/lib/auth";

/** Secure recovery (lost/replaced phone): an admin clears the student's passkeys so they can enroll a new one.
 *  The student must still sign in with their password first; teacher fallback covers attendance meanwhile. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(["admin"]);
    const { studentId, reason } = z.object({ studentId: z.string(), reason: z.string().min(5).max(300) }).parse(await req.json());
    const { data: sp } = await admin.from("student_profiles").select("user_id").eq("student_id", studentId).maybeSingle();
    if (!sp) throw new HttpError(404, "Student not found");
    const { count } = await admin.from("webauthn_credentials").delete({ count: "exact" }).eq("student_user_id", sp.user_id);
    await admin.from("audit_logs").insert({ actor_id: me.id, action: "passkeys_reset", entity: "student_profile", entity_id: sp.user_id, metadata: { reason, removed: count ?? 0 } });
    return Response.json({ removed: count ?? 0 });
  } catch (e) { return fail(e); }
}
