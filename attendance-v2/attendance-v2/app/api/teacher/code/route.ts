import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError } from "@/lib/auth";
import { generateCode, hashCode } from "@/lib/codes";

const Gen = z.object({ sessionId: z.string().uuid(), ttlSeconds: z.number().int().min(30).max(3600).default(300) });

/** Generate / regenerate. The plaintext code is returned ONCE, to the teacher, and never stored. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(["teacher"]);
    const b = Gen.parse(await req.json());
    const code = generateCode();
    const { data, error } = await admin.rpc("rotate_attendance_code", {
      p_teacher: me.id, p_session: b.sessionId, p_hash: hashCode(b.sessionId, code), p_ttl_seconds: b.ttlSeconds,
    });
    if (error) throw new HttpError(error.message.includes("forbidden") ? 403 : 409, "Cannot generate a code for this session");
    return Response.json({ code, expiresAt: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}

/** Invalidate the live code without issuing a new one. */
export async function DELETE(req: Request) {
  try {
    const me = await requireUser(["teacher"]);
    const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(await req.json());
    const { data: s } = await admin.from("class_sessions").select("id").eq("id", sessionId).eq("teacher_id", me.id).maybeSingle();
    if (!s) throw new HttpError(403, "Forbidden");
    await admin.from("attendance_codes").update({ invalidated_at: new Date().toISOString() })
      .eq("class_session_id", sessionId).is("invalidated_at", null);
    await admin.from("audit_logs").insert({ actor_id: me.id, action: "code_invalidated", entity: "class_session", entity_id: sessionId });
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
