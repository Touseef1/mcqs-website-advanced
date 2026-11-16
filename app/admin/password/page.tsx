import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AdminPasswordChange } from "@/components/AdminPasswordChange";
import { getAdminPrincipal } from "@/lib/admin-auth";
import { LoadingState } from "@/components/LoadingState";

async function PasswordGate() {
  const principal = await getAdminPrincipal();
  if (!principal) redirect("/admin");
  return <AdminPasswordChange required={Boolean(principal.mustChangePassword)} />;
}

export default function AdminPasswordPage() {
  return <Suspense fallback={<main className="admin-page admin-page-wide"><LoadingState label="Loading password settings…" variant="section" /></main>}><PasswordGate /></Suspense>;
}
