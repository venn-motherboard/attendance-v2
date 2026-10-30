import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError } from "@/lib/auth";

const Body = z.object({
  code: z.string().trim().min(2).max(20).transform(s => s.toUpperCase()), name: z.string().trim().min(2).max(120),
  sectionName: z.string().trim().min(1).max(40), term: z.string().trim().min(2).max(40), course: z.string().trim().min(2).max(120),
});

/** A teacher creates a class for THEMSELVES: finds or creates the subject and section, then assigns it to them. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(["teacher"]);
    const b = Body.parse(await req.json());

    let { data: subj } = await admin.from("subjects").select("id").eq("code", b.code).maybeSingle();
    if (!subj) { const r = await admin.from("subjects").insert({ code: b.code, name: b.name }).select("id").single(); subj = r.data; }
    let { data: sec } = await admin.from("class_sections").select("id").eq("name", b.sectionName).eq("academic_term", b.term).eq("course", b.course).maybeSingle();
    if (!sec) { const r = await admin.from("class_sections").insert({ name: b.sectionName, academic_term: b.term, course: b.course }).select("id").single(); sec = r.data; }
    if (!subj || !sec) throw new HttpError(500, "Could not create the class.");

    const { error } = await admin.from("teacher_assignments").insert({ teacher_id: me.id, subject_id: subj.id, section_id: sec.id });
    if (error) throw new HttpError(409, "You already have this class.");
    await admin.from("audit_logs").insert({ actor_id: me.id, action: "class_created", entity: "subject", entity_id: subj.id, metadata: { code: b.code, section: b.sectionName } });
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
