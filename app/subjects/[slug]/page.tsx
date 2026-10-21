import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { TopicCard } from "@/components/SubjectCard";
import { getSubject } from "@/lib/data";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const subject = await getSubject(slug);
  if (!subject) return { title: "Subject not found" };
  return {
    title: `${subject.name} MCQs for Exam Preparation`,
    description: `Study ${subject.name} with topic-wise MCQs, free practice tests, and clear explanations.`,
    alternates: { canonical: `/subjects/${subject.slug}` },
  };
}

async function SubjectContent({ params }: Props) {
  const { slug } = await params;
  const subject = await getSubject(slug);
  if (!subject) notFound();
  const topics = subject.topics.map((topic) => ({ ...topic, subjectSlug: subject.slug, subjectName: subject.name }));
  return (
    <main className="content-page">
      <Breadcrumbs items={[{ label: "Subjects", href: "/subjects" }, { label: subject.name }]} />
      <div className="page-intro"><span className="eyebrow">SUBJECT GUIDE</span><h1>{subject.name} MCQs</h1><p>{subject.description} Choose a topic below to begin a focused practice session.</p></div>
      <div className="topic-grid topic-grid-page">{topics.map((topic) => <TopicCard topic={topic} key={topic.slug} />)}</div>
      <section className="related-box"><div><span className="eyebrow">KEEP EXPLORING</span><h2>Practise by exam</h2><p>Use source-verified papers to review questions from real exams.</p></div><Link className="button button-primary" href="/past-papers">Browse past papers <span aria-hidden>→</span></Link></section>
    </main>
  );
}

export default function SubjectPage({ params }: Props) {
  return <Suspense fallback={<main className="content-page"><div className="loading-panel">Loading subject…</div></main>}><SubjectContent params={params} /></Suspense>;
}
