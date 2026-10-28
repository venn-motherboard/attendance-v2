export const RP_ID = process.env.WEBAUTHN_RP_ID!;        // e.g. your-app.vercel.app (no scheme/port)
export const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? "Classroom Attendance";
export const ORIGIN = process.env.WEBAUTHN_ORIGIN!;      // e.g. https://your-app.vercel.app
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;
