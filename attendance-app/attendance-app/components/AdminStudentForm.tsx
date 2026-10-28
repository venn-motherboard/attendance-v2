"use client";
import { useState } from "react";

export default function AdminStudentForm() {
  const [f, setF] = useState({ studentId: "", fullName: "", password: "" });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const r = await fetch("/api/admin/students", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const j = await r.json();
    if (r.ok) { setMsg({ ok: true, t: `Created ${f.studentId}.` }); setF({ studentId: "", fullName: "", password: "" }); } else setMsg({ ok: false, t: JSON.stringify(j.error) });
  }
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border bg-white p-4">
      <h2 className="font-semibold">Create student account</h2>
      <input required placeholder="Student ID" value={f.studentId} onChange={set("studentId")} className="w-full rounded-lg border p-2" />
      <input required placeholder="Full name" value={f.fullName} onChange={set("fullName")} className="w-full rounded-lg border p-2" />
      <input required type="password" minLength={10} placeholder="Temporary password (min 10 characters)" value={f.password} onChange={set("password")} className="w-full rounded-lg border p-2" />
      <button className="rounded-lg bg-indigo-600 px-4 py-2 text-white">Create</button>
      {msg && <p role="status" className={msg.ok ? "text-green-700" : "text-red-700"}>{msg.t}</p>}
    </form>
  );
}
