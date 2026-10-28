import { z } from "zod";
import { admin } from "@/lib/supabase-admin";
import { requireUser, fail, HttpError } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const me = await requireUser(["teacher"]);
    const sessionId = z.string().uuid().parse(new URL(req.url).searchParams.get("sessionId"));
    const { data: s } = await admin.from("class_sessions").select("id").eq("id", sessionId).eq("teacher_id", me.id).maybeSingle();
    if (!s) throw new HttpError(403, "Forbidden");
    const { data } = await admin.from("attendance_records")
      .select("recorded_at,status,verification_method,student_profiles(student_id,full_name)")
      .eq("class_session_id", sessionId).order("recorded_at");
    return Response.json({ records: data ?? [] });
  } catch (e) { return fail(e); }
}
