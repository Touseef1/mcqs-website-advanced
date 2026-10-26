import type { Metadata } from "next";
import { Suspense } from "react";
import { LearnerTokenForm } from "@/components/LearnerActionForm";
export const metadata: Metadata = { title: "Verify email | MCQPath", robots: { index: false, follow: false } };
async function VerifyForm({ searchParams }: { searchParams: Promise<{ token?: string }> }) { const { token = "" } = await searchParams; return <LearnerTokenForm token={token} purpose="verify-email" />; }
export default function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) { return <main className="content-page account-page"><Suspense fallback={<div className="loading-panel">Loading verification…</div>}><VerifyForm searchParams={searchParams} /></Suspense></main>; }
