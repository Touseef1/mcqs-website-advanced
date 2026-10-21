"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { TopicWithSubject } from "@/lib/data";

export function AdminQuestionForm({ topics }: { topics: TopicWithSubject[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const body = {
      topicId: Number(form.get("topicId")),
      prompt: String(form.get("prompt") ?? ""),
      choices: ["A", "B", "C", "D"].map((label) => String(form.get(`choice${label}`) ?? "")),
      correctChoice: String(form.get("correctChoice") ?? ""),
      explanation: String(form.get("explanation") ?? ""),
    };
    try {
      const response = await fetch("/api/admin/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save the question.");
      formElement.reset();
      setNotice("Question published. It is now available in its topic.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the question.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-form question-editor" onSubmit={saveQuestion}>
      <label htmlFor="topicId">Topic</label>
      <select id="topicId" name="topicId" required defaultValue="">
        <option value="" disabled>Select a topic</option>
        {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.subjectName} · {topic.name}</option>)}
      </select>
      <label htmlFor="prompt">Question</label>
      <textarea id="prompt" name="prompt" rows={3} minLength={8} maxLength={1500} required placeholder="Write a clear, standalone question" />
      <div className="admin-choice-grid">
        {(["A", "B", "C", "D"] as const).map((label) => (
          <div className="admin-choice-field" key={label}>
            <label htmlFor={`choice${label}`}>Choice {label}</label>
            <input id={`choice${label}`} name={`choice${label}`} maxLength={800} required />
          </div>
        ))}
      </div>
      <label htmlFor="correctChoice">Correct answer</label>
      <select id="correctChoice" name="correctChoice" required defaultValue="">
        <option value="" disabled>Choose the correct option</option>
        {["A", "B", "C", "D"].map((choice) => <option key={choice} value={choice}>Choice {choice}</option>)}
      </select>
      <label htmlFor="explanation">Explanation</label>
      <textarea id="explanation" name="explanation" rows={4} minLength={3} maxLength={3000} required placeholder="Explain why the answer is correct" />
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}
      <button className="button button-primary" type="submit" disabled={busy || topics.length === 0}>{busy ? "Publishing…" : "Publish question"} <span aria-hidden>→</span></button>
      {topics.length === 0 && <p className="form-hint">Create and publish a subject and topic in MySQL before adding questions.</p>}
    </form>
  );
}
