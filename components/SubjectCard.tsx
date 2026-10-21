import Link from "next/link";
import type { Subject } from "@/lib/content";
import type { TopicWithSubject } from "@/lib/data";

export function SubjectCard({ subject }: { subject: Subject }) {
  const topicCount = subject.topics.length;
  const questionCount = subject.topics.reduce((sum, topic) => sum + topic.questionCount, 0);
  return (
    <Link href={`/subjects/${subject.slug}`} className="subject-card">
      <span className="subject-icon">{subject.icon}</span>
      <span className="subject-card-copy">
        <strong>{subject.name}</strong>
        <span>{subject.description}</span>
        <span className="subject-count">{topicCount} topics <i /> {questionCount} MCQs</span>
      </span>
      <span className="card-arrow" aria-hidden>↗</span>
    </Link>
  );
}

export function TopicCard({ topic }: { topic: TopicWithSubject }) {
  return (
    <Link href={`/topics/${topic.slug}`} className="topic-card">
      <span className="topic-card-top"><span className="topic-kicker">{topic.subjectName}</span><span className="card-arrow" aria-hidden>↗</span></span>
      <strong>{topic.name}</strong>
      <span className="topic-description">{topic.description}</span>
      <span className="topic-card-bottom">{topic.questionCount} questions <span>Explore topic →</span></span>
    </Link>
  );
}
