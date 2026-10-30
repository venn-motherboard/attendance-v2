"use client";
import { useEffect, useState } from "react";

const api = (url: string, method = "GET", body?: unknown) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Please check the form."); return j; });

export function CreateClassForm({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: "", name: "", sectionName: "", term: "", course: "" });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    try { await api("/api/teacher/classes", "POST", f); setMsg({ ok: true, t: "Class created." }); setF({ code: "", name: "", sectionName: "", term: "", course: "" }); onDone(); }
    catch (e: any) { setMsg({ ok: false, t: e.message }); }
  }
  return (
    <div className="rounded-2xl border bg-white p-4">
      <button onClick={() => setOpen(!open)} className="font-semibold">{open ? "▾" : "▸"} Create a subject / class</button>
      {open && (
        <form onSubmit={submit} className="mt-3 grid gap-2">
          <input required placeholder="Subject code (e.g. IT101)" value={f.code} onChange={set("code")} className="rounded-lg border p-2" />
          <input required placeholder="Subject name" value={f.name} onChange={set("name")} className="rounded-lg border p-2" />
          <input required placeholder="Section (e.g. BSIT-1A)" value={f.sectionName} onChange={set("sectionName")} className="rounded-lg border p-2" />
          <input required placeholder="Term (e.g. 2026-1st)" value={f.term} onChange={set("term")} className="rounded-lg border p-2" />
          <input required placeholder="Course (e.g. BS Information Technology)" value={f.course} onChange={set("course")} className="rounded-lg border p-2" />
          <button className="rounded-lg bg-indigo-600 px-4 py-2 text-white">Create class</button>
          {msg && <p role="status" className={msg.ok ? "text-green-700" : "text-red-700"}>{msg.t}</p>}
        </form>
      )}
    </div>
  );
}

export function AddStudents({ subjectId, sectionId }: { subjectId: string; sectionId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  async function submit() {
    setMsg(null);
    const ids = text.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    if (!ids.length) return;
    try {
      const r = await api("/api/teacher/enroll", "POST", { subjectId, sectionId, studentIds: ids });
      setMsg({ ok: !r.notFound.length, t: `Enrolled ${r.enrolled}.${r.notFound.length ? ` Not found or not approved yet: ${r.notFound.join(", ")}` : ""}` });
      if (!r.notFound.length) setText("");
    } catch (e: any) { setMsg({ ok: false, t: e.message }); }
  }
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="text-sm underline">{open ? "Hide" : "Add students by Student ID"}</button>
      {open && (
        <div className="mt-2 space-y-2">
          <textarea aria-label="Student IDs" rows={3} placeholder="One or more Student IDs, separated by commas or new lines" value={text} onChange={e => setText(e.target.value)} className="w-full rounded-lg border p-2 text-sm" />
          <button onClick={submit} className="rounded-lg border px-3 py-2 text-sm">Enroll</button>
          {msg && <p role="status" className={msg.ok ? "text-green-700" : "text-red-700"}>{msg.t}</p>}
        </div>
      )}
    </div>
  );
}

type Rq = { id: string; student_id: string; full_name: string; subjects: any; class_sections: any };
export function SignupQueue() {
  const [items, setItems] = useState<Rq[]>([]);
  const [err, setErr] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const load = () => api("/api/teacher/signups").then(j => setItems(j.requests)).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []);
  async function decide(id: string, approve: boolean) {
    setErr("");
    try { await api("/api/teacher/signups", "POST", { requestId: id, approve, reason: why[id], identityChecked: !!checked[id] }); load(); }
    catch (e: any) { setErr(e.message); }
  }
  return (
    <section className="space-y-3 rounded-2xl border bg-white p-4" aria-label="Pending student sign-ups">
      <h2 className="font-semibold">Pending student accounts ({items.length})</h2>
      {err && <p role="alert" className="text-red-700">{err}</p>}
      {!items.length && <p className="text-sm text-slate-600">No one is waiting for approval.</p>}
      {items.map(r => (
        <div key={r.id} className="space-y-2 rounded-xl border p-3">
          <p className="font-medium">{r.full_name} <span className="text-sm font-normal text-slate-600">({r.student_id})</span></p>
          <p className="text-sm">Wants to join: {r.subjects?.code} — {r.subjects?.name} ({r.class_sections?.name})</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" onChange={e => setChecked({ ...checked, [r.id]: e.target.checked })} /> I checked this student against my class list</label>
          <input aria-label="Reason (needed to decline)" placeholder="Reason (needed to decline)" onChange={e => setWhy({ ...why, [r.id]: e.target.value })} className="w-full rounded-lg border p-2 text-sm" />
          <div className="flex gap-2">
            <button onClick={() => decide(r.id, true)} className="rounded-lg bg-green-700 px-3 py-2 text-sm text-white">Approve</button>
            <button onClick={() => decide(r.id, false)} className="rounded-lg border px-3 py-2 text-sm">Decline</button>
          </div>
        </div>
      ))}
    </section>
  );
}
