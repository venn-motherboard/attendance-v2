import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError } from "@/lib/auth";

const Body = z.object({
  studentId: z.string().regex(/^[A-Za-z0-9-]{3,32}$/), fullName: z.string().min(2).max(120),
  password: z.string().min(10).max(72), sectionId: z.string().uuid().optional(),
});

/** Admin-only provisioning. Student ID becomes a synthetic email: <id>@students.invalid.
 *  Supabase Auth hashes the password (bcrypt); this app never stores or logs it. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(["admin"]);
    const b = Body.parse(await req.json());
    const { data: u, error } = await admin.auth.admin.createUser({
      email: `${b.studentId.toLowerCase()}@students.invalid`, password: b.password, email_confirm: true,
    });
    if (error || !u.user) throw new HttpError(409, "Could not create account (Student ID may already exist).");
    const rollback = () => admin.auth.admin.deleteUser(u.user.id);
    const p = await admin.from("profiles").insert({ id: u.user.id, role: "student", full_name: b.fullName });
    const sp = await admin.from("student_profiles").insert({ user_id: u.user.id, student_id: b.studentId, full_name: b.fullName, section_id: b.sectionId ?? null });
    if (p.error || sp.error) { await rollback(); throw new HttpError(409, "Could not create profile."); }
    await admin.from("audit_logs").insert({ actor_id: me.id, action: "student_provisioned", entity: "student_profile", entity_id: u.user.id });
    return Response.json({ userId: u.user.id });
  } catch (e) { return fail(e); }
}
