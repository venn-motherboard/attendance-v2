"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import FallbackQueue from "./FallbackQueue";

const api = (url: string, method = "GET", body?: unknown) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Request failed"); return j; });

type Assign = { subject_id: string; section_id: string; subjects: any; class_sections: any };
type Active = { id: string; subject_id: string; section_id: string; attendance_closes_at: string };

export default function TeacherPanel() {
  const [assign, setAssign] = useState<Assign[]>([]);
  const [active, setActive] = useState<Active[]>([]);
  const [err, setErr] = useState("");
  const load = useCallback(() => api("/api/teacher/overview").then(j => { setAssign(j.assignments); setActive(j.active); }).catch(e => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function start(a: Assign) {
    setErr("");
    try { await api("/api/teacher/sessions/start", "POST", { subjectId: a.subject_id, sectionId: a.section_id, windowMinutes: 30 }); await load(); }
    catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="space-y-6">
      {err && <p role="alert" className="text-red-700">{err}</p>}
      {!assign.length && <p className="text-sm text-slate-600">No classes are assigned to you yet. Ask an administrator.</p>}
      {assign.map(a => {
        const s = active.find(x => x.subject_id === a.subject_id && x.section_id === a.section_id);
        return (
          <section key={a.subject_id + a.section_id} className="space-y-4 rounded-2xl border bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{a.subjects?.code} — {a.subjects?.name} <span className="text-sm font-normal text-slate-600">({a.class_sections?.name})</span></h2>
              {!s && <button onClick={() => start(a)} className="rounded-lg bg-indigo-600 px-4 py-2 text-white">Start Class</button>}
            </div>
            {s && <Session s={s} onChange={load} />}
          </section>
        );
      })}
    </div>
  );
}

function Session({ s, onChange }: { s: Active; onChange: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [ttl, setTtl] = useState(300);
  const [left, setLeft] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState(""); const [statusF, setStatusF] = useState("all");
  const [err, setErr] = useState("");

  // The countdown is display only. The server enforces expiry on every submission.
  useEffect(() => { const t = setInterval(() => setLeft(expiresAt ? Math.max(0, Math.round((expiresAt - Date.now()) / 1000)) : 0), 500); return () => clearInterval(t); }, [expiresAt]);
  useEffect(() => { const load = () => api(`/api/teacher/attendance?sessionId=${s.id}`).then(j => setRows(j.records)).catch(() => {}); load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [s.id]);

  async function gen() {
    setErr("");
    try { const r = await api("/api/teacher/code", "POST", { sessionId: s.id, ttlSeconds: ttl }); setCode(r.code); setExpiresAt(+new Date(r.expiresAt)); }
    catch (e: any) { setErr(e.message); }
  }
  async function invalidate() { await api("/api/teacher/code", "DELETE", { sessionId: s.id }).catch(e => setErr(e.message)); setCode(null); setExpiresAt(null); }
  async function close() { await api("/api/teacher/sessions/close", "POST", { sessionId: s.id }).catch(e => setErr(e.message)); setCode(null); onChange(); }

  const shown = useMemo(() => rows.filter(r => (statusF === "all" || r.status === statusF) &&
    (`${r.student_profiles?.student_id} ${r.student_profiles?.full_name}`.toLowerCase().includes(q.toLowerCase()))), [rows, q, statusF]);

  function exportCsv() {
    const esc = (v: string) => `"${String(v).replaceAll('"', '""')}"`;
    const lines = [["Student ID", "Name", "Timestamp", "Status", "Verification"].join(",")].concat(
      shown.map(r => [r.student_profiles?.student_id, r.student_profiles?.full_name, r.recorded_at, r.status, r.verification_method].map(esc).join(",")));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `attendance-${s.id.slice(0, 8)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  const mm = String(Math.floor(left / 60)).padStart(2, "0"), ss = String(left % 60).padStart(2, "0");
  return (
    <div className="space-y-4">
      {err && <p role="alert" className="text-red-700">{err}</p>}
      <div className="rounded-xl bg-slate-100 p-4 text-center">
        {code && left > 0 ? (<>
          <p className="font-mono text-6xl font-bold tracking-[0.3em]" aria-label={`Attendance code ${code.split("").join(" ")}`}>{code}</p>
          <p className="mt-2 text-sm">Valid for {mm}:{ss}</p></>)
          : <p className="text-slate-600">{code ? "Code expired. Generate a new one." : "No active code. Generate one to let students check in."}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Code validity" value={ttl} onChange={e => setTtl(+e.target.value)} className="rounded-lg border p-2 text-sm">
          <option value={60}>1 min</option><option value={180}>3 min</option><option value={300}>5 min</option><option value={600}>10 min</option>
        </select>
        <button onClick={gen} className="rounded-lg bg-indigo-600 px-4 py-2 text-white">{code ? "Regenerate Code" : "Generate Attendance Code"}</button>
        <button onClick={invalidate} className="rounded-lg border px-3 py-2 text-sm">Invalidate</button>
        <button onClick={close} className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700">Close Attendance</button>
      </div>
      <p className="text-sm">Checked in: <strong>{rows.length}</strong></p>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Search students" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} className="rounded-lg border p-2 text-sm" />
        <select aria-label="Filter by status" value={statusF} onChange={e => setStatusF(e.target.value)} className="rounded-lg border p-2 text-sm">
          <option value="all">All</option><option value="present">Present</option><option value="late">Late</option>
        </select>
        <button onClick={exportCsv} className="rounded-lg border px-3 py-2 text-sm">Export CSV</button>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr className="border-b"><th className="p-2">Student ID</th><th>Name</th><th>Time</th><th>Status</th><th>Method</th></tr></thead>
        <tbody>{shown.map((r, i) => <tr key={i} className="border-b"><td className="p-2">{r.student_profiles?.student_id}</td><td>{r.student_profiles?.full_name}</td>
          <td>{new Date(r.recorded_at).toLocaleTimeString()}</td><td>{r.status}</td><td>{r.verification_method === "passkey" ? "passkey" : "teacher-verified"}</td></tr>)}</tbody>
      </table></div>
      <div><h3 className="mb-2 font-medium">Alternative verification requests</h3><FallbackQueue sessionId={s.id} /></div>
    </div>
  );
}
