import { z } from "zod";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError } from "@/lib/auth";
import { RP_ID, ORIGIN } from "@/lib/webauthn";

const Body = z.object({ challengeId: z.string().uuid(), response: z.any() });
const ERR: Record<string, [number, string]> = {
  session_not_open: [409, "Attendance is closed for this session."],
  code_revoked: [409, "The attendance code was replaced or closed. Ask your teacher for the new code."],
  not_enrolled: [403, "You are not enrolled in this class."],
  already_recorded: [409, "Your attendance is already recorded."],
};

/** Step 2: verify the passkey assertion, consume the challenge, record attendance atomically. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(["student"]);
    const b = Body.parse(await req.json());

    // Single-use + expiry enforced in one atomic UPDATE; also pins the challenge to THIS student.
    const { data: ch } = await admin.from("webauthn_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", b.challengeId).eq("student_user_id", me.id).eq("purpose", "authenticate")
      .is("consumed_at", null).gt("expires_at", new Date().toISOString())
      .select("challenge,class_session_id,code_id").maybeSingle();
    if (!ch) throw new HttpError(400, "Verification expired. Start again.");

    const { data: cred } = await admin.from("webauthn_credentials").select("*")
      .eq("credential_id", b.response?.id).eq("student_user_id", me.id).maybeSingle();
    if (!cred) throw new HttpError(400, "Unknown passkey.");

    const v = await verifyAuthenticationResponse({
      response: b.response, expectedChallenge: ch.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: { id: cred.credential_id, publicKey: isoBase64URL.toBuffer(cred.public_key), counter: Number(cred.counter), transports: cred.transports ?? undefined },
    }).catch((e) => { console.error("webauthn auth:", e?.message); return null; });
    if (!v?.verified) {
      await admin.from("audit_logs").insert({ actor_id: me.id, action: "webauthn_rejected", entity: "class_session", entity_id: ch.class_session_id });
      throw new HttpError(401, "Passkey verification failed.");
    }
    await admin.from("webauthn_credentials").update({ counter: v.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }).eq("id", cred.id);

    const { data, error } = await admin.rpc("record_attendance", {
      p_student: me.id, p_session: ch.class_session_id, p_code: ch.code_id,
      p_meta: { method: "code+webauthn", credential: cred.id },
    });
    if (error) { const m = Object.keys(ERR).find(k => error.message.includes(k)); if (m) throw new HttpError(...ERR[m]); throw error; }

    const { data: info } = await admin.from("class_sessions").select("subjects(name)").eq("id", ch.class_session_id).single();
    return Response.json({ subject: (info as any)?.subjects?.name, student: me.name, status: data.status, recordedAt: data.recorded_at });
  } catch (e) { return fail(e); }
}
