"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeft, Pencil, Plus } from "lucide-react";
import { Building2 } from "lucide-react";
import { AdminFormCardHeader } from "@/components/AdminFormCardHeader";

type Exam = { id: number; name: string; slug: string };

export function AdminExams({ exams, onSave }: { exams: Exam[]; onSave: (body: unknown, method: string) => Promise<string> }) {
  const [editing, setEditing] = useState<Exam | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  function reset() { setEditing(null); setName(""); setSlug(""); setNotice(""); setFormOpen(false); }
  function edit(exam: Exam) { setEditing(exam); setName(exam.name); setSlug(exam.slug); setNotice(""); setFormOpen(true); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    const result = await onSave({ id: editing?.id, name, slug }, editing ? "PATCH" : "POST");
    setBusy(false); setNotice(result); if (result) reset();
  }
  if (formOpen) return <div className="admin-form-screen">
    <nav className="admin-form-breadcrumb" aria-label="Breadcrumb"><span>Exams</span><b>›</b><strong>{editing ? "Edit exam" : "Add exam"}</strong></nav>
    <div className="admin-form-screen-heading"><button type="button" className="button button-light" aria-label="Back to exams" title="Back to exams" onClick={reset}><ArrowLeft size={17} /><span>Back to exams</span></button><div><h2>{editing ? "Edit exam" : "Add an exam"}</h2><p>Keep FPSC, PPSC, NTS, and commission names consistent across papers.</p></div></div>
    <section className="admin-panel admin-form-page-panel"><AdminFormCardHeader icon={Building2} title="Exam details" description="Use a consistent exam name so it can be selected when you create papers." /><form className="admin-form admin-form-page" onSubmit={submit}>
      <label htmlFor="exam-name">Exam name</label><input id="exam-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={160} placeholder="e.g. FPSC" required />
      <label htmlFor="exam-slug">URL slug</label><input id="exam-slug" value={slug} onChange={(event) => setSlug(event.target.value)} maxLength={180} placeholder="Generated from exam name when blank" />
      {notice && <p className="form-success" role="status">{notice}</p>}
      <div className="admin-form-page-actions"><button className="button button-light" type="button" disabled={busy} onClick={reset}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save exam" : <><Plus size={16} aria-hidden="true" />Create exam</>}</button></div>
    </form></section>
  </div>;
  return <section className="admin-panel admin-list-page"><div className="admin-panel-heading"><div><span className="eyebrow">AVAILABLE EXAMS</span><h3>{exams.length} exams</h3></div><button type="button" className="button button-primary" onClick={() => { setEditing(null); setName(""); setSlug(""); setNotice(""); setFormOpen(true); }}><Plus size={15} />Add exam</button></div>
    <div className="admin-table-wrap admin-management-table-wrap"><table className="table table-hover align-middle admin-data-table admin-management-table"><thead><tr><th>Exam body</th><th>URL slug</th><th className="admin-actions-column">Actions</th></tr></thead><tbody>{exams.map((exam) => <tr key={exam.id}><td><strong>{exam.name}</strong></td><td>/{exam.slug}</td><td><div className="admin-table-actions"><button type="button" className="button button-light" onClick={() => edit(exam)}><Pencil size={14} /><span>Edit</span></button></div></td></tr>)}{!exams.length && <tr><td colSpan={3} className="admin-table-empty">No exams yet. Add the exam body before creating its papers.</td></tr>}</tbody></table></div>
  </section>;
}
