"use client";

import { useEffect, useState } from "react";
import type { PublicQuestion } from "@/lib/data";
import { getErrorMessage, parseApiResponse } from "@/lib/error-message";
import { notify } from "@/lib/toast";
import { QuizRunner } from "@/components/QuizRunner";

export function WrongQuestionsPanel() {
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/learner/wrong-questions", { signal: controller.signal, cache: "no-store" })
      .then((response) => parseApiResponse<{ questions: PublicQuestion[] }>(response, "Could not load your wrong questions."))
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

  return (
    <section className="account-section">
      <div className="account-section-heading">
        <div><span className="eyebrow">TARGETED REVIEW</span><h2>Wrong questions</h2></div>
        {!loading && <span>{questions.length} to review</span>}
      </div>
      {loading ? <p className="account-empty">Loading your wrong questions…</p>
        : error ? <p className="account-empty">Your wrong questions could not be loaded. Refresh this page to try again.</p>
          : questions.length ? <QuizRunner
            questions={questions}
            title="Wrong questions"
            quizSlug="wrong-questions"
            quizPath="/account"
            removingQuestionId={removingId}
            onRemoveQuestion={(questionId) => void removeQuestion(questionId)}
          />
            : <p className="account-empty">No wrong questions to review. Questions you miss in a quiz will appear here.</p>}
    </section>
  );
}
