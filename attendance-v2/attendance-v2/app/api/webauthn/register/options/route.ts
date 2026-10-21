import { generateRegistrationOptions } from "@simplewebauthn/server";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail } from "@/lib/auth";
import { RP_ID, RP_NAME, CHALLENGE_TTL_MS } from "@/lib/webauthn";

export async function POST() {
  try {
    const me = await requireUser(["student"]);
    const { data: sp } = await admin.from("student_profiles").select("student_id").eq("user_id", me.id).single();
    const { data: existing } = await admin.from("webauthn_credentials").select("credential_id,transports").eq("student_user_id", me.id);
    const options = await generateRegistrationOptions({
      rpID: RP_ID, rpName: RP_NAME, userName: sp!.student_id, userDisplayName: me.name,
      userID: new TextEncoder().encode(me.id), attestationType: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      excludeCredentials: (existing ?? []).map(k => ({ id: k.credential_id, transports: k.transports ?? undefined })),
    });
    const { data: ch } = await admin.from("webauthn_challenges").insert({
      student_user_id: me.id, purpose: "register", challenge: options.challenge,
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    }).select("id").single();
    return Response.json({ challengeId: ch!.id, options });
  } catch (e) { return fail(e); }
}
