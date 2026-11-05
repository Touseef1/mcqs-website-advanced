import type { Metadata } from "next";
import Link from "next/link";
import { BookOpenCheck, LockKeyhole, ShieldCheck, UsersRound } from "lucide-react";
import { Suspense } from "react";
import { AdminDashboard } from "@/components/AdminDashboard";
import { AdminLoginForm } from "@/components/AdminLoginForm";
import { AdminPasswordChange } from "@/components/AdminPasswordChange";
import { ThemeToggle } from "@/components/ThemeToggle";
import { adminLoginConfigured, getAdminCapabilities, getAdminPrincipal } from "@/lib/admin-auth";
import { hasDatabase } from "@/lib/db";

export const metadata: Metadata = {
  title: "MCQPath Admin",
  robots: { index: false, follow: false },
};

async function AdminPanel() {
  const principal = await getAdminPrincipal();
  return (
    <main className={`admin-page admin-page-wide ${!principal && adminLoginConfigured() ? "admin-login-page" : ""}`}>
      {!adminLoginConfigured() ? (
        <div className="admin-notice"><strong>Admin setup is required</strong><p>Copy <code>.env.example</code> to <code>.env.local</code>, set a private <code>ADMIN_PASSWORD</code>, a private <code>ADMIN_EMAIL</code>, and a long random <code>SESSION_SECRET</code>, then restart the server.</p></div>
      ) : !principal ? (
        <><ThemeToggle className="admin-login-theme-toggle" /><div className="admin-auth-shell">
          <aside className="admin-auth-story">
            <Link href="/" className="admin-brand admin-auth-brand"><span className="admin-brand-mark">M</span><span><strong>MCQPath</strong><small>ADMIN WORKSPACE</small></span></Link>
            <span className="admin-auth-kicker">STAFF PORTAL</span>
            <h1>Keep every question moving forward.</h1>
            <p>A focused workspace for building, reviewing, and publishing trusted exam practice.</p>
            <ul className="admin-auth-features"><li><BookOpenCheck size={20} aria-hidden="true" /><span><strong>Content workflow</strong><small>Create, review, and publish MCQs.</small></span></li><li><UsersRound size={20} aria-hidden="true" /><span><strong>Role based access</strong><small>Tools follow your staff permissions.</small></span></li><li><ShieldCheck size={20} aria-hidden="true" /><span><strong>Secure workspace</strong><small>Protected sign in for your team.</small></span></li></ul>
            <div className="admin-auth-footer"><LockKeyhole size={15} aria-hidden="true" />Private access for authorized staff</div>
          </aside>
          <section className="admin-card admin-login-card admin-login-panel"><span className="eyebrow">ADMIN SIGN IN</span><h2>Welcome back</h2><p>Sign in with your staff account to continue.</p><AdminLoginForm /><Link className="admin-login-home" href="/">Return to MCQPath</Link></section>
        </div></>
      ) : principal.mustChangePassword ? (
        <AdminPasswordChange required />
      ) : !hasDatabase ? (
        <section className="admin-card"><div className="admin-brand"><span className="admin-brand-mark">M</span><span><strong>MCQPath</strong><small>ADMIN WORKSPACE</small></span></div><h2>Connect MySQL to manage content</h2><p>Set database values in <code>.env.local</code>, then apply migrations 001–009 in the order in <code>docs/MIGRATIONS.md</code>.</p></section>
      ) : (
        <AdminDashboard principal={principal} capabilities={getAdminCapabilities(principal)} />
      )}
    </main>
  );
}

export default function AdminPage() {
  return <Suspense fallback={<main className="admin-page admin-page-wide"><div className="loading-panel">Loading admin workspace…</div></main>}><AdminPanel /></Suspense>;
}
