import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError, clientIp } from "@/lib/auth";
import { checkCodeEligibility } from "@/lib/eligibility";

const Body = z.object({
  sessionId: z.string().uuid(), code: z.string().regex(/^\d{6}$/),
  reasonCode: z.enum(["webauthn_unsupported", "no_biometric_sensor", "enrollment_failed", "verification_failed", "other"]),
  note: z.string().max(300).optional(),
});

async function setting<T>(key: string, dflt: T): Promise<T> {
  const { data } = await admin.from("system_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? dflt;
}

/** Student asks for teacher-approved verification. Creates a PENDING request only; nothing is recorded. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(["student"]);
    const b = Body.parse(await req.json());
    if (!(await setting("fallback_enabled", true))) throw new HttpError(403, "Alternative verification is turned off by your institution.");

    // Same gate as the passkey path: logged in, enrolled, session open, CURRENT unexpired code.
    const e = await checkCodeEligibility(me.id, b.sessionId, b.code, clientIp(req));

    const minutes = await setting<number>("fallback_request_minutes", 10);
    const expires = Math.min(Date.now() + minutes * 60_000, +new Date(e.closesAt));
    const { data, error } = await admin.from("fallback_requests").insert({
      class_session_id: b.sessionId, student_user_id: me.id, code_id: e.codeId,
      reason_code: b.reasonCode, student_note: b.note ?? null, expires_at: new Date(expires).toISOString(),
    }).select("id,expires_at").single();
    if (error) {
      const { data: rec } = await admin.from("attendance_records").select("id").eq("student_user_id", me.id).eq("class_session_id", b.sessionId).maybeSingle();
      throw new HttpError(409, rec ? "Your attendance is already recorded." : "You already have a pending request for this class.");
    }
    await admin.from("audit_logs").insert({ actor_id: me.id, action: "fallback_requested", entity: "fallback_request", entity_id: data.id, metadata: { reason: b.reasonCode } });
    return Response.json({ requestId: data.id, expiresAt: data.expires_at });
  } catch (e) { return fail(e); }
}

/** Student polls the state of their own request. */
export async function GET(req: Request) {
  try {
    const me = await requireUser(["student"]);
    const sessionId = z.string().uuid().parse(new URL(req.url).searchParams.get("sessionId"));
    const { data } = await admin.from("fallback_requests").select("id,state,expires_at,decision_reason")
      .eq("student_user_id", me.id).eq("class_session_id", sessionId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return Response.json({ request: data });
  } catch (e) { return fail(e); }
}
