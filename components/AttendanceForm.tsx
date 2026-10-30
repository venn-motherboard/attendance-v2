"use client";
import { useEffect, useState } from "react";
import {
  browserSupportsWebAuthn, platformAuthenticatorIsAvailable,
  startAuthentication, startRegistration,
} from "@simplewebauthn/browser";

const call = (url: string, method = "POST", body?: unknown) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Request failed"); return j; });

type Reason = "webauthn_unsupported" | "no_biometric_sensor" | "enrollment_failed" | "verification_failed" | "other";
type Msg = { ok: boolean; text: string } | null;

export default function AttendanceForm({ sessionId, subject }: { sessionId: string; subject: string }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);   // WebAuthn in this browser
  const [hasPlatformAuth, setHasPlatformAuth] = useState<boolean | null>(null);
  const [failReason, setFailReason] = useState<Reason | null>(null);  // set when fallback should be offered
  const [fallback, setFallback] = useState<{ state: string; note?: string } | null>(null);

  useEffect(() => {
    const ok = browserSupportsWebAuthn();
    setSupported(ok);
    if (!ok) { setFailReason("webauthn_unsupported"); return; }
    platformAuthenticatorIsAvailable().then(a => {
      setHasPlatformAuth(a);
      if (!a) setFailReason("no_biometric_sensor");
    });
  }, []);

  // Poll the student's own fallback request while it is pending.
  useEffect(() => {
    if (fallback?.state !== "pending") return;
    const t = setInterval(async () => {
      const { request } = await call(`/api/attendance/fallback?sessionId=${sessionId}`, "GET");
      if (request && request.state !== "pending") setFallback({ state: request.state, note: request.decision_reason });
    }, 4000);
    return () => clearInterval(t);
  }, [fallback?.state, sessionId]);

  async function registerPasskey() {
    setMsg(null);
    try {
      const { challengeId, options } = await call("/api/webauthn/register/options");
      const response = await startRegistration({ optionsJSON: options });
      await call("/api/webauthn/register/verify", "POST", { challengeId, response });
      setMsg({ ok: true, text: "Passkey registered. You can now verify your attendance." });
    } catch (e: any) {
      setFailReason("enrollment_failed");
      setMsg({ ok: false, text: friendly(e) });
    }
  }

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      const { challengeId, options } = await call("/api/attendance/verify-code", "POST", { sessionId, code });
      const response = await startAuthentication({ optionsJSON: options });
      const r = await call("/api/attendance/submit", "POST", { challengeId, response });
      // Deliberately generic: the server cannot know whether a fingerprint, face or PIN was used.
      setMsg({ ok: true, text: `${r.student} is marked ${r.status} for ${r.subject} at ${new Date(r.recordedAt).toLocaleTimeString()} (verified with your device's passkey).` });
    } catch (e: any) {
      if (e?.name === "NotAllowedError" || /passkey/i.test(e?.message ?? "")) setFailReason("verification_failed");
      setMsg({ ok: false, text: friendly(e) });
    } finally { setBusy(false); }
  }

  async function requestFallback() {
    setBusy(true); setMsg(null);
    try {
      await call("/api/attendance/fallback", "POST", { sessionId, code, reasonCode: failReason ?? "other" });
      setFallback({ state: "pending" });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{subject}</h2>

      <p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
        Attendance uses your phone&apos;s passkey. Depending on your device, it may ask for your
        <strong> fingerprint, face recognition, or device PIN/pattern</strong>. Your biometric data never leaves your phone.
      </p>

      {supported === false && <p role="alert" className="text-sm text-red-700">This browser does not support passkeys. Try Chrome or Safari, or request alternative verification below.</p>}
      {supported && hasPlatformAuth === false && <p role="alert" className="text-sm text-amber-700">This device has no built-in screen-lock verification available for passkeys.</p>}

      <label className="block text-sm" htmlFor="code">Attendance code from your teacher</label>
      <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
        className="w-full rounded-xl border p-4 text-center text-3xl tracking-[0.5em]" />

      <button onClick={submit} disabled={busy || code.length !== 6 || supported === false}
        className="w-full rounded-xl bg-indigo-600 p-4 font-medium text-white disabled:opacity-50">
        {busy ? "Verifying…" : "Verify and Submit Attendance"}
      </button>
      <button onClick={registerPasskey} disabled={supported === false}
        className="w-full rounded-xl border p-3 text-sm disabled:opacity-50">Register Fingerprint / Passkey</button>

      {msg && <p role="status" aria-live="polite" className={msg.ok ? "text-green-700" : "text-red-700"}>{msg.text}</p>}

      {failReason && !fallback && (
        <div className="space-y-2 rounded-xl border border-amber-300 p-3">
          <p className="text-sm">Can&apos;t use a passkey on this phone? Your teacher can verify you in person. This does <strong>not</strong> record attendance until the teacher approves it.</p>
          <button onClick={requestFallback} disabled={busy || code.length !== 6}
            className="w-full rounded-xl border p-3 text-sm font-medium disabled:opacity-50">Request Alternative Verification</button>
          {code.length !== 6 && <p className="text-xs text-slate-600">Enter the current 6-digit code first.</p>}
        </div>
      )}

      {fallback?.state === "pending" && <p role="status" aria-live="polite">Request sent. Show your ID to your teacher and wait for approval.</p>}
      {fallback?.state === "approved" && <p role="status" className="text-green-700">Your teacher approved your attendance (teacher-verified, not a passkey).</p>}
      {fallback?.state === "rejected" && <p role="alert" className="text-red-700">Your request was declined{fallback.note ? `: ${fallback.note}` : "."} Speak with your teacher.</p>}
      {fallback?.state === "expired" && <p role="alert" className="text-red-700">Your request expired. Enter the current code and request again.</p>}
    </div>
  );
}

function friendly(e: any) {
  if (e?.name === "NotAllowedError") return "Verification was cancelled or timed out. Try again, or request alternative verification.";
  if (e?.name === "InvalidStateError") return "A passkey for this account is already on this device.";
  return e?.message ?? "Something went wrong.";
}
