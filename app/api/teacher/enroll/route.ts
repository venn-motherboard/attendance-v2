import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError } from "@/lib/auth";

const Body = z.object({ subjectId: z.string().uuid(), sectionId: z.string().uuid(), studentIds: z.array(z.string().trim().min(1).max(32)).min(1).max(100) });

/** Enroll existing, ACTIVE students by Student ID into one of the teacher's own classes. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(["teacher"]);
    const b = Body.parse(await req.json());
    const { data: a } = await admin.from("teacher_assignments").select("id").eq("teacher_id", me.id).eq("subject_id", b.subjectId).eq("section_id", b.sectionId).maybeSingle();
    if (!a) throw new HttpError(403, "This is not one of your classes.");
    const { data: found } = await admin.from("student_profiles").select("user_id,student_id").in("student_id", b.studentIds).eq("status", "active");
    const ok = new Set((found ?? []).map(f => f.student_id));
    if (found?.length) {
      const { error } = await admin.from("class_enrollments").upsert(
        found.map(f => ({ student_user_id: f.user_id, subject_id: b.subjectId, section_id: b.sectionId, status: "enrolled" })),
        { onConflict: "student_user_id,subject_id,section_id" });
      if (error) throw error;
      await admin.from("audit_logs").insert({ actor_id: me.id, action: "students_enrolled", entity: "subject", entity_id: b.subjectId, metadata: { count: found.length } });
    }
    return Response.json({ enrolled: found?.length ?? 0, notFound: b.studentIds.filter(i => !ok.has(i)) });
  } catch (e) { return fail(e); }
}
