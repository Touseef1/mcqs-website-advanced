import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountPanel } from "@/components/AccountPanel";
import { getLearnerPrincipal } from "@/lib/learner-auth";

export const metadata: Metadata = {
  title: "Your learning account | MCQPath",
  description: "Review your quiz history, learning progress, and saved questions.",
  robots: { index: false, follow: false },
};

async function AccountContent() {
  const learner = await getLearnerPrincipal();
  return <main className="content-page account-page"><AccountPanel learner={learner} /></main>;
}

export default function AccountPage() {
  return <Suspense fallback={<main className="content-page account-page"><div className="loading-panel">Loading your account…</div></main>}><AccountContent /></Suspense>;
}
