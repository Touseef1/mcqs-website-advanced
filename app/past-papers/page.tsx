import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getPapers } from "@/lib/data";

export const metadata: Metadata = {
  title: "Verified Past Papers",
  description: "Browse verified past papers with source details for competitive exam preparation in Pakistan.",
  alternates: { canonical: "/past-papers" },
};

export default async function PastPapersPage() {
  const papers = await getPapers();
  return (
    <main className="content-page">
      <Breadcrumbs items={[{ label: "Past papers" }]} />
      <div className="page-intro"><span className="eyebrow">SOURCE-VERIFIED CONTENT</span><h1>Past papers</h1><p>Browse exam papers with source details, then review the MCQs and explanations after your attempt.</p></div>
      <div className="paper-grid paper-grid-page">{papers.map((paper) => <Link className="paper-card" href={`/past-papers/${paper.slug}`} key={paper.slug}><span className="paper-card-type">Verified past paper <span>· {paper.year}</span></span><strong>{paper.title}</strong><span className="paper-exam">{paper.exam}</span><p className="paper-description">{paper.description}</p><span className="paper-card-footer">{paper.topicSlugs.length} topics <b>Open paper <span aria-hidden>→</span></b></span></Link>)}</div>
      {!papers.length && <div className="empty-state"><span className="empty-icon">↗</span><h2>Verified papers are being added</h2><p>We will publish a paper after its exam source and details are checked.</p></div>}
    </main>
  );
}
