import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminDashboard } from "@/components/AdminDashboard";
import { AdminLoginForm } from "@/components/AdminLoginForm";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { adminLoginConfigured, getAdminPrincipal } from "@/lib/admin-auth";
import { hasDatabase } from "@/lib/db";

export const metadata: Metadata = {
  title: "MCQPath Admin",
  robots: { index: false, follow: false },
};

async function AdminPanel() {
  const principal = await getAdminPrincipal();
  return (
    <main className="content-page admin-page admin-page-wide">
      <Breadcrumbs items={[{ label: "Admin" }]} />
      <div className="page-intro"><span className="eyebrow">CONTENT MANAGEMENT</span><h1>MCQPath admin</h1><p>Organise subjects and topics, create MCQs and past papers, and manage publishing roles.</p></div>
      {!adminLoginConfigured() ? (
        <div className="admin-notice"><strong>Admin setup is required</strong><p>Copy <code>.env.example</code> to <code>.env.local</code>, set a private <code>ADMIN_PASSWORD</code>, a private <code>ADMIN_EMAIL</code>, and a long random <code>SESSION_SECRET</code>, then restart the server.</p></div>
      ) : !principal ? (
        <section className="admin-card admin-login-card"><span className="eyebrow">ADMIN SIGN IN</span><h2>Welcome to your workspace</h2><p>Sign in using your admin email and password.</p><AdminLoginForm /></section>
      ) : !hasDatabase ? (
        <section className="admin-card"><h2>Connect MySQL to manage content</h2><p>Set database values in <code>.env.local</code>, then apply <code>001_initial_schema.sql</code> and <code>002_role_based_admin.sql</code>.</p></section>
      ) : (
        <AdminDashboard principal={principal} canManageUsers={principal.role === "admin" || principal.role === "super_admin"} />
      )}
    </main>
  );
}

export default function AdminPage() {
  return <Suspense fallback={<main className="content-page admin-page"><div className="loading-panel">Loading admin workspace…</div></main>}><AdminPanel /></Suspense>;
}
