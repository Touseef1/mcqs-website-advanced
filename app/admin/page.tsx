import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminLoginForm } from "@/components/AdminLoginForm";
import { AdminQuestionForm } from "@/components/AdminQuestionForm";
import { AdminSignOutButton } from "@/components/AdminSignOutButton";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { adminLoginConfigured, isAdminAuthenticated } from "@/lib/admin-auth";
import { getTopics } from "@/lib/data";
import { hasDatabase } from "@/lib/db";

export const metadata: Metadata = {
  title: "Content Admin",
  robots: { index: false, follow: false },
};

async function AdminPanel() {
  const authenticated = await isAdminAuthenticated();
  const configured = adminLoginConfigured();
  const topics = authenticated && hasDatabase ? await getTopics() : [];
  return (
    <main className="content-page admin-page">
      <Breadcrumbs items={[{ label: "Admin" }]} />
      <div className="page-intro"><span className="eyebrow">CONTENT MANAGEMENT</span><h1>MCQPath admin</h1><p>Publish reviewed questions and explanations to the public topic library.</p></div>
      {!configured ? (
        <div className="admin-notice"><strong>Admin setup is required</strong><p>Copy <code>.env.example</code> to <code>.env.local</code>, set a strong <code>ADMIN_PASSWORD</code> and a long random <code>SESSION_SECRET</code>, then restart the development server.</p></div>
      ) : !authenticated ? (
        <section className="admin-card"><span className="eyebrow">ADMIN SIGN IN</span><h2>Welcome back</h2><p>Sign in to manage practice content.</p><AdminLoginForm /></section>
      ) : !hasDatabase ? (
        <section className="admin-card"><div className="admin-card-heading"><div><span className="eyebrow">SIGNED IN</span><h2>Connect MySQL to publish</h2></div><AdminSignOutButton /></div><p>Set the database values from <code>.env.example</code> in <code>.env.local</code>, apply the SQL migration and seed, then restart the server.</p></section>
      ) : (
        <section className="admin-card"><div className="admin-card-heading"><div><span className="eyebrow">SIGNED IN · MYSQL CONNECTED</span><h2>Add a practice question</h2><p>Choose a topic, add four options, and include a useful explanation.</p></div><AdminSignOutButton /></div><AdminQuestionForm topics={topics} /></section>
      )}
    </main>
  );
}

export default function AdminPage() {
  return <Suspense fallback={<main className="content-page admin-page"><div className="loading-panel">Loading content tools…</div></main>}><AdminPanel /></Suspense>;
}
