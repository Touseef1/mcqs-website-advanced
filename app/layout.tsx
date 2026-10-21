import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "MCQPath — Free MCQs and Exam Practice",
    template: "%s | MCQPath",
  },
  description: "Free subject-wise MCQs, practice tests, and clear explanations for competitive exam preparation in Pakistan.",
  applicationName: "MCQPath",
  openGraph: {
    type: "website",
    siteName: "MCQPath",
    title: "MCQPath — Free MCQs and Exam Practice",
    description: "Learn a little. Practise every day. Prepare for your next test.",
    locale: "en_PK",
  },
  twitter: {
    card: "summary",
    title: "MCQPath — Free MCQs and Exam Practice",
    description: "Subject-wise MCQs, practice tests, and clear explanations.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
