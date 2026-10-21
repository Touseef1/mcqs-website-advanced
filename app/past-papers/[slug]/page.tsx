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
      <Breadcrumbs items={[{ label: "Past papers & practice sets", href: "/past-papers" }, { label: paper.title }]} />
      <div className="paper-detail-heading">
        <span className={paper.type === "Past paper" ? "paper-badge official-badge" : "paper-badge"}>{paper.type} · {paper.year}</span>
        <h1>{paper.title}</h1><p>{paper.description}</p>
        <div className="paper-detail-meta"><span>{paper.exam}</span><span>{questions.length} questions</span><span>Online practice</span></div>
      </div>
      <div className="paper-detail-layout">
        <div>{questions.length ? <QuizRunner questions={publicQuestions} title={paper.title} /> : <div className="empty-state"><h2>This paper has no published questions yet</h2><p>Try one of the related topic quizzes while the paper is being prepared.</p></div>}</div>
        <aside className="paper-topics"><span className="eyebrow">COVERED TOPICS</span><h2>Review these areas</h2>{related.map((topic) => <Link href={`/topics/${topic.slug}`} key={topic.slug}>{topic.name}<span aria-hidden>↗</span></Link>)}</aside>
      </div>
    </main>
  );
}

export default function PaperPage({ params }: Props) {
  return <Suspense fallback={<main className="content-page"><div className="loading-panel">Loading practice set…</div></main>}><PaperContent params={params} /></Suspense>;
}
