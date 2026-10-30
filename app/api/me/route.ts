import { admin } from "@/lib/supabase-admin";
import { sessionUserId, fail } from "@/lib/auth";

export async function GET() {
  try {
    const id = await sessionUserId();
    if (!id) return Response.json({ error: "Not signed in" }, { status: 401 });
    const { data } = await admin.from("profiles").select("role,status").eq("id", id).maybeSingle();
    return Response.json({ role: data?.role ?? null, status: data?.status ?? "none" });
  } catch (e) { return fail(e); }
}
