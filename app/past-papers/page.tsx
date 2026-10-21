import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getPapers } from "@/lib/data";

export const metadata: Metadata = {
  title: "Past Papers and Exam Practice Sets",
  description: "Browse exam-style practice sets and past-paper resources for competitive test preparation in Pakistan.",
  alternates: { canonical: "/past-papers" },
};

export default async function PastPapersPage() {
  const papers = await getPapers();
  return (
    <main className="content-page">
      <Breadcrumbs items={[{ label: "Past papers & practice sets" }]} />
      <div className="page-intro"><span className="eyebrow">PREPARE LIKE TEST DAY</span><h1>Past papers & practice sets</h1><p>Find a paper, practise related topics, and review the explanations after your attempt.</p></div>
      <div className="paper-notice"><span>i</span><p>Practice sets are clearly labelled. We only mark a resource as an official past paper when its source and exam details have been verified.</p></div>
      <div className="paper-grid paper-grid-page">{papers.map((paper) => <Link className="paper-card" href={`/past-papers/${paper.slug}`} key={paper.slug}><span className="paper-card-type">{paper.type} <span>· {paper.year}</span></span><strong>{paper.title}</strong><span className="paper-exam">{paper.exam}</span><p className="paper-description">{paper.description}</p><span className="paper-card-footer">{paper.topicSlugs.length} topics <b>Open set <span aria-hidden>→</span></b></span></Link>)}</div>
      {!papers.length && <div className="empty-state"><span className="empty-icon">↗</span><h2>New papers are on the way</h2><p>We are preparing verified papers and practice sets.</p></div>}
    </main>
  );
}
