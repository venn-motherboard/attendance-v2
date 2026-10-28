import { admin } from "@/lib/supabase-admin";
import { pageUser } from "@/lib/page-auth";
import AttendanceForm from "@/components/AttendanceForm";
import SignOut from "@/components/SignOut";

export const dynamic = "force-dynamic";

export default async function StudentPage() {
  const me = await pageUser(["student"]);
  const { data: sp } = await admin.from("student_profiles").select("student_id,full_name,class_sections(name,course)").eq("user_id", me.id).single();
  const { data: enr } = await admin.from("class_enrollments").select("subject_id,section_id,subjects(name,code),class_sections(name)").eq("student_user_id", me.id).eq("status", "enrolled");
  const enrolled: any[] = enr ?? [];

  const { data: act } = await admin.from("class_sessions").select("id,subject_id,section_id,subjects(name)")
    .eq("status", "active").gt("attendance_closes_at", new Date().toISOString()).lte("attendance_opens_at", new Date().toISOString());
  const { data: done } = await admin.from("attendance_records").select("class_session_id").eq("student_user_id", me.id);
  const doneIds = new Set((done ?? []).map((d: any) => d.class_session_id));
  const eligible = (act ?? []).filter((s: any) =>
    enrolled.some(e => e.subject_id === s.subject_id && e.section_id === s.section_id) && !doneIds.has(s.id));

  const { data: hist } = await admin.from("attendance_records").select("recorded_at,status,verification_method,class_sessions(subjects(name))")
    .eq("student_user_id", me.id).order("recorded_at", { ascending: false }).limit(30);
  const counts: Record<string, number> = {};
  (hist ?? []).forEach((h: any) => { counts[h.status] = (counts[h.status] ?? 0) + 1; });

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">{(sp as any)?.full_name}</h1>
          <p className="text-sm text-slate-600">Student ID: {(sp as any)?.student_id}</p>
        </div>
        <SignOut />
      </header>

      <section aria-labelledby="subj"><h2 id="subj" className="mb-2 font-semibold">My subjects</h2>
        {enrolled.length ? <ul className="space-y-1 text-sm">{enrolled.map((e, i) => <li key={i}>{e.subjects?.code} — {e.subjects?.name} ({e.class_sections?.name})</li>)}</ul>
          : <p className="text-sm text-slate-600">You are not enrolled in any subject yet. Ask your administrator.</p>}
      </section>

      <section aria-labelledby="act"><h2 id="act" className="mb-2 font-semibold">Active classes</h2>
        {eligible.length ? <div className="space-y-6">{eligible.map((s: any) => <div key={s.id} className="rounded-2xl border bg-white p-4"><AttendanceForm sessionId={s.id} subject={s.subjects?.name} /></div>)}</div>
          : <p className="text-sm text-slate-600">No class is open for attendance right now. Refresh this page when your teacher starts the class.</p>}
      </section>

      <section aria-labelledby="hist"><h2 id="hist" className="mb-2 font-semibold">Attendance history</h2>
        <p className="mb-2 text-sm text-slate-600">Present: {counts.present ?? 0} · Late: {counts.late ?? 0} · Excused: {counts.excused ?? 0} · Absent: {counts.absent ?? 0}</p>
        <ul className="divide-y rounded-xl border bg-white text-sm">
          {(hist ?? []).map((h: any, i) => <li key={i} className="flex justify-between p-3"><span>{h.class_sessions?.subjects?.name}</span><span>{h.status} · {h.verification_method === "passkey" ? "passkey" : "teacher-verified"} · {new Date(h.recorded_at).toLocaleString()}</span></li>)}
          {!hist?.length && <li className="p-3 text-slate-600">No records yet.</li>}
        </ul>
      </section>
    </div>
  );
}
