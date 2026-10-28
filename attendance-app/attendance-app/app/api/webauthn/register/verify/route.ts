import { z } from "zod";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError } from "@/lib/auth";
import { RP_ID, ORIGIN } from "@/lib/webauthn";

const Body = z.object({ challengeId: z.string().uuid(), response: z.any(), label: z.string().max(60).optional() });

export async function POST(req: Request) {
  try {
    const me = await requireUser(["student"]);
    const b = Body.parse(await req.json());
    const { data: ch } = await admin.from("webauthn_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", b.challengeId).eq("student_user_id", me.id).eq("purpose", "register")
      .is("consumed_at", null).gt("expires_at", new Date().toISOString()).select("challenge").maybeSingle();
    if (!ch) throw new HttpError(400, "Registration expired. Try again.");
    const v = await verifyRegistrationResponse({
      response: b.response, expectedChallenge: ch.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true,
    }).catch(() => null);
    if (!v?.verified || !v.registrationInfo) throw new HttpError(400, "Passkey registration failed.");
    const { credential } = v.registrationInfo;
    const { error } = await admin.from("webauthn_credentials").insert({
      student_user_id: me.id, credential_id: credential.id, public_key: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter, transports: b.response?.response?.transports ?? null, device_label: b.label ?? null,
    });
    if (error) throw new HttpError(409, "This passkey is already registered.");
    await admin.from("audit_logs").insert({ actor_id: me.id, action: "passkey_registered", entity: "student_profile", entity_id: me.id });
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
