import type { Metadata } from "next";
import { LearnerEmailAction } from "@/components/LearnerActionForm";
export const metadata: Metadata = { title: "Resend verification | MCQPath", robots: { index: false, follow: false } };
export default function ResendVerificationPage() { return <main className="content-page account-page"><LearnerEmailAction purpose="resend-verification" /></main>; }
