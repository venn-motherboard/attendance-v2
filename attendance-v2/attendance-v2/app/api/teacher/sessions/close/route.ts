import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError } from "@/lib/auth";

const Body = z.object({ sessionId: z.string().uuid() });

export async function POST(req: Request) {
  try {
    const me = await requireUser(["teacher"]);
    const { sessionId } = Body.parse(await req.json());
    const { data: s } = await admin.from("class_sessions").update({ status: "closed", ends_at: new Date().toISOString() })
      .eq("id", sessionId).eq("teacher_id", me.id).eq("status", "active").select("id").maybeSingle();
    if (!s) throw new HttpError(404, "No active session");
    await admin.from("attendance_codes").update({ invalidated_at: new Date().toISOString() })
      .eq("class_session_id", sessionId).is("invalidated_at", null);
    await admin.from("audit_logs").insert({ actor_id: me.id, action: "session_closed", entity: "class_session", entity_id: sessionId });
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
