import type { Metadata } from "next";
import { Suspense } from "react";
import { LearnerTokenForm } from "@/components/LearnerActionForm";
export const metadata: Metadata = { title: "Reset password | MCQPath", robots: { index: false, follow: false } };
async function ResetForm({ searchParams }: { searchParams: Promise<{ token?: string }> }) { const { token = "" } = await searchParams; return <LearnerTokenForm token={token} purpose="reset-password" />; }
export default function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) { return <main className="content-page account-page"><Suspense fallback={<div className="loading-panel">Loading password reset…</div>}><ResetForm searchParams={searchParams} /></Suspense></main>; }
