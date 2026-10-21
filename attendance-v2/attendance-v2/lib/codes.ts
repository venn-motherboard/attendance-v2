import { createHmac, randomInt, timingSafeEqual } from "crypto";

/** Cryptographically secure 6-digit code (rejection-sampled, no modulo bias). */
export const generateCode = () => randomInt(0, 1_000_000).toString().padStart(6, "0");

/** Keyed hash bound to the session. The pepper stays server-side, so a DB leak
 *  alone cannot be brute-forced across the 1M-code space. */
export function hashCode(sessionId: string, code: string) {
  return createHmac("sha256", process.env.ATTENDANCE_CODE_PEPPER!)
    .update(`${sessionId}:${code}`).digest("hex");
}

export function codeMatches(sessionId: string, code: string, storedHash: string) {
  const a = Buffer.from(hashCode(sessionId, code), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
