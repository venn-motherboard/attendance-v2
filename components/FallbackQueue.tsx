"use client";
import { useEffect, useState } from "react";

type Req = { id: string; reason_code: string; student_note: string | null; student_profiles: { student_id: string; full_name: string } };

export default function FallbackQueue({ sessionId }: { sessionId: string }) {
  const [items, setItems] = useState<Req[]>([]);
  const [err, setErr] = useState("");
  const [reason, setReason] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState<Record<string, boolean>>({});

  const load = () => fetch(`/api/teacher/fallback?sessionId=${sessionId}`).then(r => r.json()).then(j => setItems(j.requests ?? []));
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [sessionId]);

  async function decide(id: string, approve: boolean) {
    setErr("");
    const r = await fetch("/api/teacher/fallback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: id, approve, reason: reason[id] ?? "", identityVerifiedInPerson: !!verified[id] }),
    });
    const j = await r.json();
    if (!r.ok) setErr(j.error); else load();
  }

  if (!items.length) return <p className="text-sm text-slate-600">No pending verification requests.</p>;
  return (
    <ul className="space-y-3" aria-label="Pending alternative verification requests">
      {err && <li role="alert" className="text-red-700">{err}</li>}
      {items.map(r => (
        <li key={r.id} className="space-y-2 rounded-xl border p-3">
          <p className="font-medium">{r.student_profiles.full_name} <span className="text-sm text-slate-600">({r.student_profiles.student_id})</span></p>
          <p className="text-sm">Reason: {r.reason_code.replaceAll("_", " ")}{r.student_note ? ` — ${r.student_note}` : ""}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" onChange={e => setVerified({ ...verified, [r.id]: e.target.checked })} /> I verified this student&apos;s identity in person</label>
          <input aria-label="Reason for decision" placeholder="Reason (required, min 5 characters)" className="w-full rounded-lg border p-2 text-sm"
            onChange={e => setReason({ ...reason, [r.id]: e.target.value })} />
          <div className="flex gap-2">
            <button onClick={() => decide(r.id, true)} className="rounded-lg bg-green-700 px-3 py-2 text-sm text-white">Approve</button>
            <button onClick={() => decide(r.id, false)} className="rounded-lg border px-3 py-2 text-sm">Decline</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
