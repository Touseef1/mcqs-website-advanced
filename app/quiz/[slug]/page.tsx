import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { QuizRunner } from "@/components/QuizRunner";
import { getPublicQuestions, getTopic } from "@/lib/data";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const topic = await getTopic(slug);
  return {
    title: topic ? `${topic.name} Practice Quiz | MCQPath` : "Practice Quiz | MCQPath",
    description: topic ? `Take a free timed ${topic.name} quiz and review your answers.` : "Take a free MCQ practice quiz.",
    robots: { index: false, follow: true },
  };
}

async function QuizContent({ params }: Props) {
  const { slug } = await params;
  const [topic, questions] = await Promise.all([getTopic(slug), getPublicQuestions(slug)]);
  if (!topic) notFound();
  return (
    <main className="content-page quiz-page">
      <Breadcrumbs items={[{ label: "Subjects", href: "/subjects" }, { label: topic.subjectName, href: `/subjects/${topic.subjectSlug}` }, { label: topic.name, href: `/topics/${topic.slug}` }, { label: "Practice quiz" }]} />
      <div className="quiz-page-heading"><span className="eyebrow">FOCUSED PRACTICE</span><h1>{topic.name} quiz</h1><p>{topic.description}</p></div>
      <QuizRunner questions={questions} title={topic.name} />
    </main>
  );
}

export default function QuizPage({ params }: Props) {
  return <Suspense fallback={<main className="content-page"><div className="loading-panel">Loading quiz…</div></main>}><QuizContent params={params} /></Suspense>;
}
