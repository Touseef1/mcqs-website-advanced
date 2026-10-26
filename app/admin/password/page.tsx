import { redirect } from "next/navigation";
import { AdminPasswordChange } from "@/components/AdminPasswordChange";
import { getAdminPrincipal } from "@/lib/admin-auth";

export default async function AdminPasswordPage() {
  const principal = await getAdminPrincipal();
  if (!principal) redirect("/admin");
  return <AdminPasswordChange required={Boolean(principal.mustChangePassword)} />;
}
