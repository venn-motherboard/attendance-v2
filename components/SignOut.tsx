"use client";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function SignOut() {
  const router = useRouter();
  return (
    <button className="rounded-lg border px-3 py-2 text-sm" onClick={async () => {
      await supabaseBrowser().auth.signOut(); router.push("/login"); router.refresh();
    }}>Sign out</button>
  );
}
