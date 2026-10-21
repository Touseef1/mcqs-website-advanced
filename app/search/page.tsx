import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SearchBar } from "@/components/SearchBar";
import { searchContent } from "@/lib/data";

export const metadata: Metadata = {
  title: "Search MCQs, Subjects, and Papers",
  description: "Search subject topics, practice questions, and exam preparation resources.",
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<{ q?: string }> };

async function SearchResults({ searchParams }: Props) {
  const { q = "" } = await searchParams;
  const query = q.trim().slice(0, 100);
  const results = await searchContent(query);
  return (
    <>
      <SearchBar compact />
      {!query ? <div className="empty-state"><h2>What do you want to study?</h2><p>Search for a subject, topic, or question.</p></div> : (
        <div className="search-results">
          <p className="search-result-count">Search results for <strong>“{query}”</strong></p>
          {results.subjects.map((subject) => <Link className="search-result" href={`/subjects/${subject.slug}`} key={`s-${subject.slug}`}><span className="result-kind">SUBJECT</span><strong>{subject.name}</strong><span>{subject.description}</span><b aria-hidden>↗</b></Link>)}
          {results.topics.map((topic) => <Link className="search-result" href={`/topics/${topic.slug}`} key={`t-${topic.slug}`}><span className="result-kind">TOPIC · {topic.subjectName}</span><strong>{topic.name}</strong><span>{topic.description}</span><b aria-hidden>↗</b></Link>)}
          {results.questions.map((question) => <Link className="search-result" href={`/topics/${question.topicSlug}`} key={`q-${question.id}`}><span className="result-kind">QUESTION</span><strong>{question.prompt}</strong><span>Open topic practice</span><b aria-hidden>↗</b></Link>)}
          {!results.subjects.length && !results.topics.length && !results.questions.length && <div className="empty-state"><h2>No matches yet</h2><p>Try a subject name such as English, General Knowledge, or Pakistan Studies.</p></div>}
        </div>
      )}
    </>
  );
}

export default function SearchPage({ searchParams }: Props) {
  return <main className="content-page search-page"><Breadcrumbs items={[{ label: "Search" }]} /><div className="page-intro"><span className="eyebrow">FIND YOUR NEXT QUESTION</span><h1>Search the library</h1></div><Suspense fallback={<div className="loading-panel">Finding matching study material…</div>}><SearchResults searchParams={searchParams} /></Suspense></main>;
}
