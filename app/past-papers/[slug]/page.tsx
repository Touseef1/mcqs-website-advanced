import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { QuizRunner } from "@/components/QuizRunner";
import { getPaper, getQuestionsForPaper, getTopics, toPublicQuestion } from "@/lib/data";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const paper = await getPaper(slug);
  if (!paper) return { title: "Paper not found" };
  return {
    title: `${paper.title} | ${paper.exam} Preparation`,
    description: `${paper.description} Review topics and practise the questions online.`,
    alternates: { canonical: `/past-papers/${paper.slug}` },
  };
}

async function PaperContent({ params }: Props) {
  const { slug } = await params;
  const [paper, questions, topics] = await Promise.all([getPaper(slug), getQuestionsForPaper(slug), getTopics()]);
  if (!paper) notFound();
  const related = paper.topicSlugs.map((topicSlug) => topics.find((topic) => topic.slug === topicSlug)).filter((topic) => topic !== undefined);
  const publicQuestions = questions.map(toPublicQuestion);
  const minutes = Math.max(questions.length, 1);
  return (
    <main className="content-page exam-sheet-page">
      <Breadcrumbs items={[{ label: "Past papers", href: "/past-papers" }, { label: paper.title }]} />
      <header className="exam-sheet-header">
        <div className="exam-sheet-kicker">
          <span className="exam-chip">{paper.exam}</span>
          <span>{paper.year}</span>
          <span>{paper.type}</span>
        </div>
        <h1>{paper.title}</h1>
        <p>{paper.description}</p>
        <ul className="exam-sheet-facts">
          <li><strong>{questions.length}</strong><span>MCQs</span></li>
          <li><strong>{minutes} min</strong><span>Suggested time</span></li>
          <li><strong>Review</strong><span>After you submit</span></li>
        </ul>
      </header>
      <div className="exam-sheet-layout">
        <div className="exam-sheet">
          {paper.questionCount > questions.length && <p className="paper-availability-note" role="status">{paper.questionCount} MCQs are assigned to this paper, and {questions.length} are published for practice. The rest stay hidden until an administrator publishes them.</p>}
          {questions.length ? <QuizRunner questions={publicQuestions} title={paper.title} quizSlug={paper.slug} quizPath={`/past-papers/${paper.slug}`} /> : <div className="empty-state"><h2>{paper.questionCount ? "These MCQs are not published yet" : "This paper has no published MCQs yet"}</h2><p>{paper.questionCount ? "Questions are assigned in the admin panel, but none are published for learners yet." : "Published questions for this paper will appear here."}</p></div>}
        </div>
        <aside className="exam-sheet-topics">
          <span className="eyebrow">IN THIS PAPER</span>
          <h2>Topics to revise</h2>
          {related.length ? related.map((topic) => <Link href={`/topics/${topic.slug}`} key={topic.slug}><span>{topic.name}</span><small>{topic.questionCount} MCQs</small></Link>) : <p>Topics appear once published questions are linked to this paper.</p>}
        </aside>
      </div>
    </main>
  );
}

export default function PaperPage({ params }: Props) {
  return <Suspense fallback={<main className="content-page"><div className="loading-panel">Loading past paper…</div></main>}><PaperContent params={params} /></Suspense>;
}
