"use client";

import { useEffect, useState } from "react";
import type { PublicQuestion } from "@/lib/data";
import { getErrorMessage, parseApiResponse } from "@/lib/error-message";
import { notify } from "@/lib/toast";
import { QuizRunner } from "@/components/QuizRunner";

export function WrongQuestionsPanel() {
  const [questions, setQuestions] = useState<WrongQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [removingTopicId, setRemovingTopicId] = useState<number | null>(null);
  const [expandedTopicId, setExpandedTopicId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const topics = [...questions.reduce((groups, question) => {
    const group = groups.get(question.topicId) ?? {
      topicId: question.topicId,
      topicSlug: question.topicSlug,
      topicName: question.topicName,
      subjectName: question.subjectName,
      questions: [],
    };
    group.questions.push(question);
    groups.set(question.topicId, group);
    return groups;
  }, new Map<number, { topicId: number; topicSlug: string; topicName: string; subjectName: string; questions: WrongQuestion[] }>()).values()]
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName) || a.topicName.localeCompare(b.topicName));

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/learner/wrong-questions", { signal: controller.signal, cache: "no-store" })
      .then((response) => parseApiResponse<{ questions: WrongQuestion[] }>(response, "Could not load your wrong questions."))
      .then((data) => setQuestions(data.questions))
      .catch((cause) => {
        if (!controller.signal.aborted) {
          const message = getErrorMessage(cause, "Could not load your wrong questions.");
          setError(message);
          notify.error(message);
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function removeQuestion(questionId: number) {
    setRemovingId(questionId);
    try {
      const response = await fetch("/api/learner/wrong-questions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId }),
      });
      await parseApiResponse(response, "Could not remove this wrong question.");
      setQuestions((current) => current.filter((question) => question.id !== questionId));
      notify.success("Question removed from your wrong questions.");
    } catch (cause) {
      notify.error(getErrorMessage(cause, "Could not remove this wrong question."));
    } finally {
      setRemovingId(null);
    }
  }

  async function removeTopic(topicId: number) {
    setRemovingTopicId(topicId);
    try {
      const response = await fetch("/api/learner/wrong-questions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId }),
      });
      const data = await parseApiResponse<{ removedCount?: number }>(response, "Could not remove this topic's wrong questions.");
      setQuestions((current) => current.filter((question) => question.topicId !== topicId));
      setExpandedTopicId((current) => current === topicId ? null : current);
      notify.success(`${data.removedCount ?? 0} wrong question${data.removedCount === 1 ? "" : "s"} removed from this topic.`);
    } catch (cause) {
      notify.error(getErrorMessage(cause, "Could not remove this topic's wrong questions."));
    } finally {
      setRemovingTopicId(null);
    }
  }

  return (
    <section className="account-section">
      <div className="account-section-heading">
        <div><span className="eyebrow">TARGETED REVIEW</span><h2>Wrong questions</h2></div>
        {!loading && <span>{questions.length} questions across {topics.length} topics</span>}
      </div>
      {loading ? <p className="account-empty">Loading your wrong questions…</p>
        : error ? <p className="account-empty">Your wrong questions could not be loaded. Refresh this page to try again.</p>
          : questions.length ? <div className="wrong-topic-list">{topics.map((topic) => {
            const expanded = expandedTopicId === topic.topicId;
            return <article className="wrong-topic-card" key={topic.topicId}>
              <header className="wrong-topic-header">
                <button type="button" className="wrong-topic-toggle" aria-expanded={expanded} onClick={() => setExpandedTopicId(expanded ? null : topic.topicId)}>
                  <span>{topic.subjectName}</span><strong>{topic.topicName}</strong><small>{topic.questions.length} wrong question{topic.questions.length === 1 ? "" : "s"}</small>
                </button>
                <div className="wrong-topic-actions">
                  <button type="button" className="wrong-topic-remove" disabled={removingTopicId === topic.topicId} onClick={() => void removeTopic(topic.topicId)}>{removingTopicId === topic.topicId ? "Removing…" : "Remove topic"}</button>
                  <button type="button" className="button button-light" aria-expanded={expanded} onClick={() => setExpandedTopicId(expanded ? null : topic.topicId)}>{expanded ? "Hide questions" : "Review questions"}</button>
                </div>
              </header>
              {expanded && <QuizRunner
                questions={topic.questions}
                title={`${topic.subjectName} · ${topic.topicName}`}
                quizSlug={topic.topicSlug}
                quizPath={`/quiz/${encodeURIComponent(topic.topicSlug)}`}
                canBookmark
                removingQuestionId={removingId}
                onRemoveQuestion={(questionId) => void removeQuestion(questionId)}
              />}
            </article>;
          })}</div>
            : <p className="account-empty">No wrong questions to review. Questions you miss in a quiz will appear here.</p>}
    </section>
  );
}

type WrongQuestion = PublicQuestion & {
  topicId: number;
  topicName: string;
  subjectName: string;
};
