"use client";

import { useState, type FormEvent } from "react";

type Exam = { id: number; name: string; slug: string };

export function AdminExams({ exams, onSave }: { exams: Exam[]; onSave: (body: unknown, method: string) => Promise<string> }) {
  const [editing, setEditing] = useState<Exam | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  function reset() { setEditing(null); setName(""); setSlug(""); }
  function edit(exam: Exam) { setEditing(exam); setName(exam.name); setSlug(exam.slug); setNotice(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    const result = await onSave({ id: editing?.id, name, slug }, editing ? "PATCH" : "POST");
    setBusy(false); setNotice(result); if (result) reset();
  }
  return <div className="admin-management-grid">
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">EXAM DIRECTORY</span><h3>{editing ? "Edit exam" : "Add an exam"}</h3></div></div>
      <p className="admin-helper">Keep exam bodies such as FPSC, PPSC, NTS, and provincial commissions consistent across papers.</p>
      <form className="admin-form" onSubmit={submit}>
        <label htmlFor="exam-name">Exam name</label><input id="exam-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={160} placeholder="e.g. FPSC" required />
        <label htmlFor="exam-slug">URL slug</label><input id="exam-slug" value={slug} onChange={(event) => setSlug(event.target.value)} maxLength={180} placeholder="Generated from exam name when blank" />
        {notice && <p className="form-success" role="status">{notice}</p>}
        <div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save exam" : "Create exam"}</button>{editing && <button className="button button-light" type="button" onClick={reset}>Cancel</button>}</div>
      </form>
    </section>
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">AVAILABLE EXAMS</span><h3>{exams.length} exams</h3></div></div>
      <div className="admin-record-list admin-exam-list">{exams.map((exam) => <article className="admin-record" key={exam.id}><div><div className="admin-record-title"><strong>{exam.name}</strong></div><small>/{exam.slug}</small></div><button type="button" className="button button-light" onClick={() => edit(exam)}>Edit</button></article>)}{!exams.length && <p className="admin-empty">No exams yet. Add the exam body before creating its papers.</p>}</div>
    </section>
  </div>;
}
