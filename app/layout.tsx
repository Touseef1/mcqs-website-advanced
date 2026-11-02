import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { AppFeedback } from "@/components/AppFeedback";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const themeBootstrap = `try{var theme=localStorage.getItem("mcqpath:theme");if(theme!=="dark"&&theme!=="light"){theme=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme}catch{document.documentElement.dataset.theme="light"}`;

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
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body>
        <AppFeedback>
          <SiteHeader />
          {children}
          <SiteFooter />
        </AppFeedback>
      </body>
    </html>
  );
}
