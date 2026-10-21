import Link from "next/link";
import { SearchBar } from "@/components/SearchBar";
import { SubjectCard } from "@/components/SubjectCard";
import { getPapers, getSubjects, getTopics } from "@/lib/data";

export default async function Home() {
  const [subjects, topics, papers] = await Promise.all([getSubjects(), getTopics(), getPapers()]);
  const totalQuestions = topics.reduce((sum, topic) => sum + topic.questionCount, 0);

  return (
    <>
      <section className="hero">
        <div className="hero-grid" aria-hidden />
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="eyebrow hero-eyebrow"><span className="eyebrow-dot" /> PREPARE WITH PURPOSE</span>
            <h1>Small practice.<br /><em>Big progress.</em></h1>
            <p className="hero-description">Free MCQs, clear explanations, and exam-style practice to help you feel ready for your next test.</p>
            <SearchBar />
            <div className="hero-proof">
              <span className="proof-stack"><i>✓</i><i>✓</i><i>✓</i></span>
              <span>Build your knowledge, one question at a time</span>
            </div>
          </div>
          <div className="hero-art" aria-label="Daily learning progress illustration">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="floating-chip chip-top"><span>✦</span> Your next step</div>
            <div className="study-card">
              <div className="study-card-top"><span className="study-label">TODAY’S PRACTICE</span><span className="study-dots">···</span></div>
              <div className="study-icon">✳</div>
              <h2>One question<br />at a time.</h2>
              <div className="study-progress-label"><span>Your learning streak</span><strong>04 days</strong></div>
              <div className="study-progress"><i /></div>
              <div className="study-card-bottom"><span>Keep your momentum going</span><span className="mini-arrow">↗</span></div>
            </div>
            <div className="floating-chip chip-bottom"><span className="spark">✦</span> Progress feels good</div>
            <span className="hero-spark spark-left">✳</span><span className="hero-spark spark-right">✦</span>
          </div>
        </div>
        <div className="hero-bottom"><span>MADE FOR LEARNERS ACROSS PAKISTAN</span><span className="hero-bottom-line" /><span>LEARN · PRACTISE · IMPROVE</span></div>
      </section>

      <main>
        <section className="stats-strip" aria-label="Website overview">
          <div className="stats-inner">
            <div><strong>{subjects.length.toString().padStart(2, "0")}</strong><span>Study subjects</span></div>
            <div><strong>{topics.length.toString().padStart(2, "0")}</strong><span>Focused topics</span></div>
            <div><strong>{totalQuestions.toString().padStart(2, "0")}</strong><span>Practice questions</span></div>
            <div><strong>{papers.length.toString().padStart(2, "0")}</strong><span>Practice sets</span></div>
            <div className="stat-note"><span className="live-dot" /> A growing library, made for your next step</div>
          </div>
        </section>

        <section className="section section-subjects" id="subjects">
          <div className="section-heading">
            <div><span className="eyebrow">FIND YOUR FOCUS</span><h2>Start with a subject</h2><p>Choose a subject and find a topic to practise at your own pace.</p></div>
            <Link className="text-link" href="/subjects">Explore all subjects <span aria-hidden>↗</span></Link>
          </div>
          <div className="subject-grid">{subjects.map((subject) => <SubjectCard subject={subject} key={subject.slug} />)}</div>
        </section>

        <section className="practice-band" id="practice">
          <div className="practice-band-copy"><span className="eyebrow light-eyebrow">A BETTER WAY TO PREPARE</span><h2>Understand the answer.<br /><em>Remember it longer.</em></h2><p>Practise a topic, check your result, and learn from every explanation. Your next test starts with one small step.</p><Link className="button button-light" href="/subjects">Find a topic <span aria-hidden>→</span></Link></div>
          <div className="practice-visual" aria-hidden><div className="practice-circle circle-back" /><div className="practice-circle circle-front"><div className="check-mark">✓</div><span>ANSWER<br />UNDERSTOOD</span></div><div className="practice-tag tag-one">01 <span>Learn</span></div><div className="practice-tag tag-two">02 <span>Practise</span></div><div className="practice-tag tag-three">03 <span>Improve</span></div></div>
        </section>

        <section className="section section-topics">
          <div className="section-heading"><div><span className="eyebrow">QUICK START</span><h2>Popular topics</h2><p>Jump into a focused practice session.</p></div><Link className="text-link" href="/subjects">Browse topics <span aria-hidden>↗</span></Link></div>
          <div className="topic-grid">{topics.slice(0, 6).map((topic) => <Link className="popular-topic" href={`/topics/${topic.slug}`} key={topic.slug}><span className="popular-topic-icon">↗</span><span><strong>{topic.name}</strong><small>{topic.subjectName} · {topic.questionCount} questions</small></span></Link>)}</div>
        </section>

        <section className="section paper-section">
          <div className="section-heading"><div><span className="eyebrow">TEST YOUR PREPARATION</span><h2>Practice sets & papers</h2><p>Try a short exam-style set and review what you know.</p></div><Link className="text-link" href="/past-papers">View all papers <span aria-hidden>↗</span></Link></div>
          <div className="paper-grid">{papers.map((paper) => <Link className="paper-card" href={`/past-papers/${paper.slug}`} key={paper.slug}><span className="paper-card-type">{paper.type} <span>· {paper.year}</span></span><strong>{paper.title}</strong><span className="paper-exam">{paper.exam}</span><span className="paper-card-footer">{paper.topicSlugs.length} topics <b>Open set <span aria-hidden>→</span></b></span></Link>)}</div>
        </section>

        <section className="closing-cta"><span className="closing-star">✳</span><div><span className="eyebrow">YOUR NEXT STEP STARTS HERE</span><h2>Ready when you are.</h2><p>Pick a topic and begin practising for free.</p></div><Link className="button button-primary" href="/subjects">Explore subjects <span aria-hidden>→</span></Link></section>
      </main>
    </>
  );
}
