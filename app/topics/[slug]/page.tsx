import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getQuestions, getTopic } from "@/lib/data";

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
  const [topic, questions] = await Promise.all([getTopic(slug), getQuestions(slug)]);
  if (!topic) notFound();
  return (
    <main className="content-page">
      <Breadcrumbs items={[{ label: "Subjects", href: "/subjects" }, { label: topic.subjectName, href: `/subjects/${topic.subjectSlug}` }, { label: topic.name }]} />
      <div className="topic-hero"><div><span className="eyebrow">{topic.subjectName.toUpperCase()} · TOPIC PRACTICE</span><h1>{topic.name} MCQs</h1><p>{topic.description} Answer the questions, then review the explanations to strengthen what you know.</p><div className="topic-hero-meta"><span>{questions.length} practice questions</span><span>Free · No account required</span></div></div><Link className="button button-primary" href={`/quiz/${topic.slug}`}>Start topic quiz <span aria-hidden>→</span></Link></div>
      <div className="question-preview-list">
        <div className="preview-heading"><div><span className="eyebrow">SAMPLE QUESTIONS</span><h2>Try a question first</h2></div><span>Answers are shown after the quiz</span></div>
        {questions.slice(0, 5).map((question, index) => (
          <article className="preview-question" key={question.id}>
            <span className="preview-number">{String(index + 1).padStart(2, "0")}</span>
            <div><h3>{question.prompt}</h3><div className="preview-options">{question.choices.map((choice) => <span key={choice.label}><b>{choice.label}</b> {choice.text}</span>)}</div></div>
          </article>
        ))}
        {!questions.length && <p className="empty-inline">New questions for this topic will be added soon.</p>}
      </div>
    </main>
  );
}

export default function TopicPage({ params }: Props) {
  return <Suspense fallback={<main className="content-page"><div className="loading-panel">Loading topic…</div></main>}><TopicContent params={params} /></Suspense>;
}
