import { admin } from "@/lib/supabase-admin";
import { requireUser, fail } from "@/lib/auth";

export async function GET() {
  try {
    const me = await requireUser(["teacher"]);
    const now = new Date().toISOString();
    // Sessions whose attendance window has passed are closed automatically.
    await admin.from("class_sessions").update({ status: "closed", ends_at: now }).eq("teacher_id", me.id).eq("status", "active").lte("attendance_closes_at", now);
    const [{ data: assignments }, { data: active }] = await Promise.all([
      admin.from("teacher_assignments").select("subject_id,section_id,subjects(name,code),class_sections(name,course)").eq("teacher_id", me.id),
      admin.from("class_sessions").select("id,subject_id,section_id,attendance_closes_at").eq("teacher_id", me.id).eq("status", "active"),
    ]);
    return Response.json({ assignments: assignments ?? [], active: active ?? [] });
  } catch (e) { return fail(e); }
}
