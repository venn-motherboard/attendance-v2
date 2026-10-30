import { z } from "zod";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError, clientIp } from "@/lib/auth";
import { checkCodeEligibility } from "@/lib/eligibility";
import { RP_ID, CHALLENGE_TTL_MS } from "@/lib/webauthn";

const Body = z.object({ sessionId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) });

/** Step 1 (passkey path): validate, then issue a WebAuthn challenge bound to this student + code. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(["student"]);
    const b = Body.parse(await req.json());
    const e = await checkCodeEligibility(me.id, b.sessionId, b.code, clientIp(req));

    const { data: creds } = await admin.from("webauthn_credentials").select("credential_id,transports").eq("student_user_id", me.id);
    if (!creds?.length) throw new HttpError(412, "No passkey is registered on your account. Register one, or request alternative verification.");

    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: "required",
      allowCredentials: creds.map(k => ({ id: k.credential_id, transports: k.transports ?? undefined })),
    });
    const { data: ch } = await admin.from("webauthn_challenges").insert({
      student_user_id: me.id, purpose: "authenticate", challenge: options.challenge,
      class_session_id: b.sessionId, code_id: e.codeId, expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    }).select("id").single();
    return Response.json({ challengeId: ch!.id, options, subject: e.subject });
  } catch (e) { return fail(e); }
}
