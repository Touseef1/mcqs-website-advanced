import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminDashboard } from "@/components/AdminDashboard";
import { AdminLoginForm } from "@/components/AdminLoginForm";
import { AdminPasswordChange } from "@/components/AdminPasswordChange";
import { adminLoginConfigured, getAdminCapabilities, getAdminPrincipal } from "@/lib/admin-auth";
import { hasDatabase } from "@/lib/db";

export const metadata: Metadata = {
  title: "MCQPath Admin",
  robots: { index: false, follow: false },
};

async function AdminPanel() {
  const principal = await getAdminPrincipal();
  return (
    <main className="admin-page admin-page-wide">
      {!adminLoginConfigured() ? (
        <div className="admin-notice"><strong>Admin setup is required</strong><p>Copy <code>.env.example</code> to <code>.env.local</code>, set a private <code>ADMIN_PASSWORD</code>, a private <code>ADMIN_EMAIL</code>, and a long random <code>SESSION_SECRET</code>, then restart the server.</p></div>
      ) : !principal ? (
        <section className="admin-card admin-login-card"><div className="admin-brand admin-login-brand"><span className="admin-brand-mark">M</span><span><strong>MCQPath</strong><small>ADMIN WORKSPACE</small></span></div><span className="eyebrow">ADMIN SIGN IN</span><h2>Welcome to your workspace</h2><p>Sign in using your admin email and password.</p><AdminLoginForm /></section>
      ) : principal.mustChangePassword ? (
        <AdminPasswordChange required />
      ) : !hasDatabase ? (
        <section className="admin-card"><div className="admin-brand"><span className="admin-brand-mark">M</span><span><strong>MCQPath</strong><small>ADMIN WORKSPACE</small></span></div><h2>Connect MySQL to manage content</h2><p>Set database values in <code>.env.local</code>, then apply migrations <code>001</code>, <code>002</code>, <code>003</code>, <code>005</code>, and <code>006</code>.</p></section>
      ) : (
        <AdminDashboard principal={principal} capabilities={getAdminCapabilities(principal)} />
      )}
    </main>
  );
}

export default function AdminPage() {
  return <Suspense fallback={<main className="admin-page admin-page-wide"><div className="loading-panel">Loading admin workspace…</div></main>}><AdminPanel /></Suspense>;
}
