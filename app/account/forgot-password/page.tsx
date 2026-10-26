import type { Metadata } from "next";
import { LearnerEmailAction } from "@/components/LearnerActionForm";
export const metadata: Metadata = { title: "Forgot password | MCQPath", robots: { index: false, follow: false } };
export default function ForgotPasswordPage() { return <main className="content-page account-page"><LearnerEmailAction purpose="forgot-password" /></main>; }
