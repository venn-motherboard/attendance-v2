import { pageUser } from "@/lib/page-auth";
import AdminStudentForm from "@/components/AdminStudentForm";
import SignOut from "@/components/SignOut";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const me = await pageUser(["admin"]);
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between"><h1 className="text-xl font-bold">Admin: {me.name}</h1><SignOut /></header>
      <AdminStudentForm />
      <p className="text-sm text-slate-600">Subjects, sections, teachers, assignments and enrollments are set up with the SQL in <code>supabase/seed-template.sql</code> for now.</p>
    </div>
  );
}
