import { redirect } from "next/navigation";
import { requireUser, type Role } from "./auth";

/** For server-rendered pages: not signed in -> /login, wrong role -> / (which routes by role). */
export async function pageUser(roles: Role[]) {
  let me;
  try { me = await requireUser(["admin", "teacher", "student"]); } catch { redirect("/login"); }
  if (!roles.includes(me.role)) redirect("/");
  return me;
}
