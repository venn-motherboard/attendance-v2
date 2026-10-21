import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError } from "@/lib/auth";

const Body = z.object({
  subjectId: z.string().uuid(), sectionId: z.string().uuid(),
  windowMinutes: z.number().int().min(5).max(240).default(30),
});

export async function POST(req: Request) {
  try {
    const me = await requireUser(["teacher"]);
    const b = Body.parse(await req.json());
    const { data: a } = await admin.from("teacher_assignments").select("id")
      .eq("teacher_id", me.id).eq("subject_id", b.subjectId).eq("section_id", b.sectionId).maybeSingle();
    if (!a) throw new HttpError(403, "Not assigned to this class");
    const { data: open } = await admin.from("class_sessions").select("id")
      .eq("teacher_id", me.id).eq("subject_id", b.subjectId).eq("section_id", b.sectionId).eq("status", "active");
    if (open?.length) throw new HttpError(409, "A session is already active for this class");
    const closes = new Date(Date.now() + b.windowMinutes * 60_000).toISOString();
    const { data, error } = await admin.from("class_sessions").insert({
      subject_id: b.subjectId, section_id: b.sectionId, teacher_id: me.id, attendance_closes_at: closes,
    }).select("id").single();
    if (error) throw error;
    await admin.from("audit_logs").insert({ actor_id: me.id, action: "session_started", entity: "class_session", entity_id: data.id });
    return Response.json({ sessionId: data.id, attendanceClosesAt: closes });
  } catch (e) { return fail(e); }
}
