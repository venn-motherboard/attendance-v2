import { admin } from "@/lib/supabase-admin";

// Classes a new student can ask to join (only classes that have a teacher assigned).
export async function GET() {
  const { data } = await admin.from("teacher_assignments").select("subject_id,section_id,subjects(code,name),class_sections(name)");
  const seen = new Set<string>();
  const classes = (data ?? []).flatMap((a: any) => {
    const key = a.subject_id + a.section_id;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ subjectId: a.subject_id, sectionId: a.section_id, label: `${a.subjects?.code} — ${a.subjects?.name} (${a.class_sections?.name})` }];
  });
  return Response.json({ classes });
}
