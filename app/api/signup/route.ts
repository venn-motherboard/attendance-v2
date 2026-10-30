import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { fail, HttpError, clientIp } from "@/lib/auth";

const Body = z.object({
  studentId: z.string().regex(/^[A-Za-z0-9-]{3,32}$/), fullName: z.string().trim().min(2).max(120),
  password: z.string().min(10).max(72), subjectId: z.string().uuid(), sectionId: z.string().uuid(),
});

/** Public. Creates a PENDING account: it cannot sign in to anything until a teacher of that class approves it. */
export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    const ip = clientIp(req);

    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count } = await admin.from("signup_requests").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since);
    if ((count ?? 0) >= 5) throw new HttpError(429, "Too many sign-up requests from this network. Try again later.");

    const { data: cls } = await admin.from("teacher_assignments").select("id").eq("subject_id", b.subjectId).eq("section_id", b.sectionId).limit(1);
    if (!cls?.length) throw new HttpError(400, "Choose a class from the list.");

    const taken = new HttpError(409, "This Student ID can't be registered. It may already have an account or a pending request.");
    const { data: existing } = await admin.from("student_profiles").select("user_id").eq("student_id", b.studentId).maybeSingle();
    if (existing) throw taken;

    const { data: u, error } = await admin.auth.admin.createUser({
      email: `${b.studentId.toLowerCase()}@students.invalid`, password: b.password, email_confirm: true,
    });
    if (error || !u.user) throw taken;
    const undo = () => admin.auth.admin.deleteUser(u.user.id);

    const p = await admin.from("profiles").insert({ id: u.user.id, role: "student", full_name: b.fullName, status: "pending" });
    const sp = p.error ? p : await admin.from("student_profiles").insert({ user_id: u.user.id, student_id: b.studentId, full_name: b.fullName, status: "pending" });
    const rq = sp.error ? sp : await admin.from("signup_requests").insert({ student_id: b.studentId, full_name: b.fullName, user_id: u.user.id, subject_id: b.subjectId, section_id: b.sectionId, ip });
    if (rq.error) { await undo(); throw taken; }
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
