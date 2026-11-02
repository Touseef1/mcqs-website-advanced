import Link from "next/link";
import { BookOpen, ArrowRight, FileText, GraduationCap } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { SubjectCard } from "@/components/SubjectCard";
import { getPapers, getSubjects, getTopics } from "@/lib/data";

export default async function Home() {
  const [subjects, topics, papers] = await Promise.all([getSubjects(), getTopics(), getPapers()]);
  const totalQuestions = topics.reduce((sum, topic) => sum + topic.questionCount, 0);
  return <main className="home-refresh">
    <section className="home-intro">
      <div><span className="eyebrow">PAKISTAN TEST PREPARATION</span><h1>Prepare with purpose.</h1><p>MCQs and past papers for your next exam.</p><SearchBar /><div className="home-library-counts">{subjects.length} subjects · {totalQuestions} MCQs · {papers.length} past papers</div></div>
      <BookOpen className="home-book-art" strokeWidth={0.6} aria-hidden="true" />
    </section>
    <section className="home-block" id="subjects">
      <div className="section-heading"><div><h2>Choose your subject</h2><p>Find a topic and practise at your own pace.</p></div><Link className="text-link" href="/subjects">All subjects <ArrowRight size={16} aria-hidden="true" /></Link></div>
      <div className="home-subjects">{subjects.map(subject => <SubjectCard key={subject.slug} subject={subject} />)}</div>
    </section>
    <section className="home-block">
      <div className="section-heading"><div><h2>Past papers</h2><p>Explore exam papers and learn from each question.</p></div><Link className="text-link" href="/past-papers">All papers <ArrowRight size={16} aria-hidden="true" /></Link></div>
      <div className="home-paper-list">{papers.map(paper => <Link href={`/past-papers/${paper.slug}`} className="home-paper-row" key={paper.slug}><FileText size={25} aria-hidden="true" /><div><strong>{paper.title}</strong><small>{paper.exam} · {paper.year} · {paper.publishedQuestionCount} MCQs</small></div><span>Open paper <ArrowRight size={16} aria-hidden="true" /></span></Link>)}{!papers.length && <p className="account-empty">Published papers will appear here as they become available.</p>}</div>
    </section>
    <section className="home-study-strip" id="practice"><BookOpen size={28} aria-hidden="true" /><div><h2>Read. Practise. Improve.</h2><p>Choose Read mode to learn, or Quiz mode to check your knowledge.</p></div><Link className="button button-primary" href="/subjects">Start practising <ArrowRight size={17} aria-hidden="true" /></Link></section>
    <section className="home-block"><div className="section-heading"><div><h2>Explore topics</h2><p>A focused session starts here.</p></div></div><div className="topic-grid">{topics.slice(0,6).map(topic => <Link className="popular-topic" href={`/topics/${topic.slug}`} key={topic.slug}><GraduationCap size={24} aria-hidden="true" /><span><strong>{topic.name}</strong><small>{topic.subjectName} · {topic.questionCount} questions</small></span></Link>)}</div></section>
  </main>;
}
