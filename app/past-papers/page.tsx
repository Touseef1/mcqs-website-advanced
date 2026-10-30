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
  const questionTotal = papers.reduce((sum, paper) => sum + paper.publishedQuestionCount, 0);
  return (
    <main className="content-page paper-library-page">
      <Breadcrumbs items={[{ label: "Past papers" }]} />
      <header className="paper-library-hero">
        <div>
          <span className="eyebrow">EXAM ARCHIVE</span>
          <h1>Past papers</h1>
          <p>Sit a verified paper, then review every MCQ with its explanation. Each paper keeps the exam, year, and source it was taken from.</p>
        </div>
        <div className="paper-library-count" aria-label={`${papers.length} papers, ${questionTotal} MCQs`}>
          <strong>{papers.length.toString().padStart(2, "0")}</strong>
          <span>{questionTotal} MCQs ready</span>
        </div>
      </header>
      {papers.length ? (
        <div className="paper-catalog">
          {papers.map((paper) => (
            <Link className="exam-paper-card" href={`/past-papers/${paper.slug}`} key={paper.slug}>
              <div className="exam-paper-kicker">
                <span className="exam-chip">{paper.exam}</span>
                <span>{paper.year}</span>
              </div>
              <h2>{paper.title}</h2>
              <p>{paper.description}</p>
              <div className="exam-paper-meta">
                <span>{paper.publishedQuestionCount} MCQs</span>
                <span>{paper.type}</span>
                {paper.topicSlugs.length > 0 && <span>{paper.topicSlugs.length} {paper.topicSlugs.length === 1 ? "topic" : "topics"}</span>}
              </div>
              <span className="exam-paper-cta">Start paper <span aria-hidden>→</span></span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state"><span className="empty-icon">↗</span><h2>Verified papers are being added</h2><p>A paper is published after its exam source and questions are checked.</p></div>
      )}
    </main>
  );
}
