import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { QuizRunner } from "@/components/QuizRunner";
import { getQuestions, getTopic, toPublicQuestion } from "@/lib/data";
import { getLearnerPrincipal } from "@/lib/learner-auth";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const topic = await getTopic(slug);
  if (!topic) return { title: "Topic not found" };
  return {
    title: `${topic.name} MCQs | ${topic.subjectName}`,
    description: `Practise ${topic.name} MCQs in ${topic.subjectName}. Review each answer with a clear explanation.`,
    alternates: { canonical: `/topics/${topic.slug}` },
  };
}

async function TopicContent({ params }: Props) {
  const { slug } = await params;
  const [topic, questions, learner] = await Promise.all([getTopic(slug), getQuestions(slug), getLearnerPrincipal()]);
  if (!topic) notFound();
  return (
    <main className="content-page">
      <Breadcrumbs items={[{ label: "Subjects", href: "/subjects" }, { label: topic.subjectName, href: `/subjects/${topic.subjectSlug}` }, { label: topic.name }]} />
      <div className="topic-hero"><div><span className="eyebrow">{topic.subjectName.toUpperCase()} · SOURCE-VERIFIED MCQS</span><h1>{topic.name} MCQs</h1><p>{topic.description} Answer the questions, then review the source and explanation for each one.</p><div className="topic-hero-meta"><span>{questions.length} MCQs</span><span>Free · No account required</span></div></div><Link className="button button-primary" href={`/quiz/${topic.slug}`}>Start topic quiz <span aria-hidden>→</span></Link></div>
      <section className="topic-study-section" id="topic-study"><div className="preview-heading"><div><span className="eyebrow">TOPIC QUESTIONS</span><h2>Choose how to study</h2></div><span>10 questions per page</span></div><QuizRunner questions={questions.map(toPublicQuestion)} title={topic.name} quizSlug={topic.slug} canBookmark={Boolean(learner)} /></section>
    </main>
  );
}

export default function TopicPage({ params }: Props) {
  return <Suspense fallback={<main className="content-page"><div className="loading-panel">Loading topic…</div></main>}><TopicContent params={params} /></Suspense>;
}
