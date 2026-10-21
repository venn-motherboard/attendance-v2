import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { admin } from "./supabase-admin";

export type Role = "admin" | "teacher" | "student";

/** Resolve the caller from the session cookie and load role from the DB (never from the client). */
export async function requireUser(roles: Role[]) {
  const store = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } }
  );
  const { data: { user } } = await sb.auth.getUser(); // validates JWT with Supabase
  if (!user) throw new HttpError(401, "Not signed in");
  const { data: p } = await admin.from("profiles").select("role,status,full_name").eq("id", user.id).single();
  if (!p || p.status !== "active" || !roles.includes(p.role)) throw new HttpError(403, "Forbidden");
  return { id: user.id, role: p.role as Role, name: p.full_name as string };
}

export class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

export function fail(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Server error" }, { status: 500 });
}

export const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
