import { pageUser } from "@/lib/page-auth";
import TeacherPanel from "@/components/TeacherPanel";
import SignOut from "@/components/SignOut";

export const dynamic = "force-dynamic";

export default async function TeacherPage() {
  const me = await pageUser(["teacher"]);
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between"><h1 className="text-xl font-bold">Teacher: {me.name}</h1><SignOut /></header>
      <TeacherPanel />
    </div>
  );
}
