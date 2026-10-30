"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function Signup() {
  const [classes, setClasses] = useState<{ subjectId: string; sectionId: string; label: string }[]>([]);
  const [f, setF] = useState({ studentId: "", fullName: "", password: "", cls: "" });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/public/classes").then(r => r.json()).then(j => setClasses(j.classes ?? [])); }, []);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const c = classes.find(x => x.subjectId + x.sectionId === f.cls);
    const r = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: f.studentId, fullName: f.fullName, password: f.password, subjectId: c?.subjectId, sectionId: c?.sectionId }) });
    const j = await r.json();
    if (r.ok) setMsg({ ok: true, t: "Request sent. Your teacher must approve it before you can sign in." });
    else setMsg({ ok: false, t: typeof j.error === "string" ? j.error : "Please check the form: Student ID (letters, numbers, dashes), your name, a password of 10+ characters, and a class." });
    setBusy(false);
  }

  return (
    <div className="mx-auto mt-10 max-w-sm space-y-4">
      <h1 className="text-2xl font-bold">Create student account</h1>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm" htmlFor="sid">Student ID</label>
        <input id="sid" required value={f.studentId} onChange={set("studentId")} className="w-full rounded-xl border p-3" />
        <label className="block text-sm" htmlFor="fn">Full name</label>
        <input id="fn" required value={f.fullName} onChange={set("fullName")} className="w-full rounded-xl border p-3" />
        <label className="block text-sm" htmlFor="pw">Password (at least 10 characters)</label>
        <input id="pw" type="password" required minLength={10} value={f.password} onChange={set("password")} autoComplete="new-password" className="w-full rounded-xl border p-3" />
        <label className="block text-sm" htmlFor="cl">Class you are joining</label>
        <select id="cl" required value={f.cls} onChange={set("cls")} className="w-full rounded-xl border bg-white p-3">
          <option value="">Choose a class</option>
          {classes.map(c => <option key={c.subjectId + c.sectionId} value={c.subjectId + c.sectionId}>{c.label}</option>)}
        </select>
        <button disabled={busy} className="w-full rounded-xl bg-indigo-600 p-3 font-medium text-white disabled:opacity-50">{busy ? "Sending…" : "Request account"}</button>
        {msg && <p role="status" aria-live="polite" className={msg.ok ? "text-green-700" : "text-red-700"}>{msg.t}</p>}
      </form>
      <p className="text-sm"><Link className="text-indigo-700 underline" href="/login">Back to sign in</Link></p>
    </div>
  );
}
