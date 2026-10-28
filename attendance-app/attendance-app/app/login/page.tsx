"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function Login() {
  const router = useRouter();
  const [id, setId] = useState(""); const [pw, setPw] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    // Students type their Student ID; teachers/admins may type their email.
    const email = id.includes("@") ? id.trim() : `${id.trim().toLowerCase()}@students.invalid`;
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password: pw });
    if (error) { setErr("Wrong Student ID/email or password."); setBusy(false); return; }
    router.push("/"); router.refresh();
  }

  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4">
      <h1 className="text-2xl font-bold">Classroom Attendance</h1>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm" htmlFor="id">Student ID (or staff email)</label>
        <input id="id" value={id} onChange={e => setId(e.target.value)} autoComplete="username" required className="w-full rounded-xl border p-3" />
        <label className="block text-sm" htmlFor="pw">Password</label>
        <input id="pw" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" required className="w-full rounded-xl border p-3" />
        <button disabled={busy} className="w-full rounded-xl bg-indigo-600 p-3 font-medium text-white disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
        {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      </form>
      <p className="text-xs text-slate-600">Accounts are created by your administrator.</p>
    </div>
  );
}
