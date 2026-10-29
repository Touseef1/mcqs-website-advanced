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
  return (
    <main className="content-page">
      <Breadcrumbs items={[{ label: "Past papers", href: "/past-papers" }, { label: paper.title }]} />
      <div className="paper-detail-heading">
        <span className={paper.type === "Past paper" ? "paper-badge official-badge" : "paper-badge"}>{paper.type} · {paper.year}</span>
        <h1>{paper.title}</h1><p>{paper.description}</p>
        <div className="paper-detail-meta"><span>{paper.exam}</span><span>{questions.length} published questions</span><span>Online practice</span></div>
      </div>
      <div className="paper-detail-layout">
        <div>
          {paper.questionCount > questions.length && <p className="paper-availability-note" role="status">{paper.questionCount} MCQs are assigned to this paper in the admin panel, but only {questions.length} are published for learners. An administrator must review and publish the remaining MCQs.</p>}
          {questions.length ? <QuizRunner questions={publicQuestions} title={paper.title} quizSlug={paper.slug} quizPath={`/past-papers/${paper.slug}`} /> : <div className="empty-state"><h2>{paper.questionCount ? "The assigned MCQs are not published yet" : "This paper has no published MCQs yet"}</h2><p>{paper.questionCount ? "The paper has MCQs assigned, but none are currently published for learners. An administrator must review and publish them." : "Related topics are listed here while its verified questions are being added."}</p></div>}
        </div>
        <aside className="paper-topics"><span className="eyebrow">COVERED TOPICS</span><h2>Review these areas</h2>{related.map((topic) => <Link href={`/topics/${topic.slug}`} key={topic.slug}>{topic.name}<span aria-hidden>↗</span></Link>)}</aside>
      </div>
    </main>
  );
}

export default function PaperPage({ params }: Props) {
  return <Suspense fallback={<main className="content-page"><div className="loading-panel">Loading past paper…</div></main>}><PaperContent params={params} /></Suspense>;
}
