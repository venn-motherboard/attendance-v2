import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  let role: string;
  try { role = (await requireUser(["admin", "teacher", "student"])).role; } catch { redirect("/login"); }
  redirect(`/${role}`);
}
