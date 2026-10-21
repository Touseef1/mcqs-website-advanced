"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminSignOutButton } from "@/components/AdminSignOutButton";
import type { AdminPrincipal, AdminRole } from "@/lib/admin-auth";

type Status = "draft" | "published" | "archived";
type SubjectRow = { id: number; name: string; slug: string; description: string; status: Status; topic_count: number };
type TopicRow = { id: number; subject_id: number; subject_name: string; name: string; slug: string; description: string; status: Status; question_count: number };
type AdminQuestion = { id: number; topicId: number; topicName: string; subjectName: string; prompt: string; explanation: string; correctChoice: string; difficulty: "easy" | "medium" | "hard"; status: Status; choices: Array<{ label: string; text: string }> };
type AdminPaper = { id: number; examId: number; examName: string; title: string; slug: string; year: number; type: "Practice set" | "Past paper"; description: string; status: Status; questionCount: number; questionIds: number[] };
type AdminUser = { id: string; name: string; email: string; role: AdminRole; status: "active" | "inactive" };
type Tab = "overview" | "questions" | "categories" | "papers" | "team";

type QuestionForm = { topicId: string; prompt: string; choices: string[]; correctChoice: string; explanation: string; difficulty: "easy" | "medium" | "hard"; status: "draft" | "published" };
const blankQuestion: QuestionForm = { topicId: "", prompt: "", choices: ["", "", "", ""], correctChoice: "", explanation: "", difficulty: "medium", status: "draft" };
const tabLabels: Record<Tab, string> = { overview: "Overview", questions: "MCQ bank", categories: "Categories", papers: "Past papers", team: "Team & roles" };

async function sendAdmin(path: string, method = "GET", body?: unknown) {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`admin-status admin-status-${status}`}>{status}</span>;
}

function ErrorMessage({ children }: { children: string }) {
  return children ? <p className="form-error" role="alert">{children}</p> : null;
}

function SuccessMessage({ children }: { children: string }) {
  return children ? <p className="form-success" role="status">{children}</p> : null;
}

export function AdminDashboard({ principal, canManageUsers }: { principal: AdminPrincipal; canManageUsers: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [papers, setPapers] = useState<AdminPaper[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadData = useCallback(async () => {
    const [categoryResult, questionResult, paperResult, userResult] = await Promise.allSettled([
      sendAdmin("/api/admin/categories"), sendAdmin("/api/admin/questions"), sendAdmin("/api/admin/papers"),
      canManageUsers ? sendAdmin("/api/admin/users") : Promise.resolve({ users: [] }),
    ]);
    let failure = "";
    if (categoryResult.status === "fulfilled") {
      setSubjects(categoryResult.value.subjects ?? []);
      setTopics(categoryResult.value.topics ?? []);
    } else failure ||= categoryResult.reason instanceof Error ? categoryResult.reason.message : "Could not load categories.";
    if (questionResult.status === "fulfilled") setQuestions(questionResult.value.questions ?? []);
    else failure ||= questionResult.reason instanceof Error ? questionResult.reason.message : "Could not load questions.";
    if (paperResult.status === "fulfilled") setPapers(paperResult.value.papers ?? []);
    else failure ||= paperResult.reason instanceof Error ? paperResult.reason.message : "Could not load past papers.";
    if (userResult.status === "fulfilled") setUsers(userResult.value.users ?? []);
    setLoadError(failure);
    setLoading(false);
  }, [canManageUsers]);

  async function refresh() { setLoading(true); await loadData(); }

  useEffect(() => {
    const request = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(request);
  }, [loadData]);

  const allowedTabs = useMemo(() => canManageUsers
    ? ["overview", "questions", "categories", "papers", "team"] as Tab[]
    : ["overview", "questions", "categories", "papers"] as Tab[], [canManageUsers]);

  async function perform(action: () => Promise<unknown>, success: string) {
    setLoadError("");
    try {
      await action();
      await refresh();
      router.refresh();
      return success;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The request could not be completed.");
      return "";
    }
  }

  return (
    <div className="admin-dashboard">
      <aside className="admin-sidebar">
        <div className="admin-user-chip"><span className="admin-avatar">{principal.name.slice(0, 1).toUpperCase()}</span><span><strong>{principal.name}</strong><small>{principal.role.replace("_", " ")}</small></span></div>
        <nav aria-label="Admin sections">
          {allowedTabs.map((item) => <button type="button" key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{tabLabels[item]}</button>)}
        </nav>
        <div className="admin-sidebar-foot"><AdminSignOutButton /></div>
      </aside>
      <div className="admin-workspace">
        <div className="admin-workspace-heading"><div><span className="eyebrow">MCQPATH · ADMIN WORKSPACE</span><h2>{tabLabels[tab]}</h2><p>Manage study content and publishing workflow.</p></div><button className="button button-light" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh data"}</button></div>
        <ErrorMessage>{loadError}</ErrorMessage>
        {loading && !subjects.length && !questions.length && !papers.length ? <div className="loading-panel">Loading admin records…</div> : null}
        {tab === "overview" && <OverviewPanel subjects={subjects} topics={topics} questions={questions} papers={papers} users={users} canManageUsers={canManageUsers} onSelect={setTab} />}
        {tab === "categories" && <CategoriesPanel subjects={subjects} topics={topics} canEdit={principal.role !== "reviewer"} canPublish={principal.role === "admin" || principal.role === "super_admin" || principal.role === "reviewer"} onSave={(body, method) => perform(() => sendAdmin("/api/admin/categories", method, body), "Category saved.")} onStatus={(kind, id, status) => perform(() => sendAdmin("/api/admin/categories", "PATCH", { kind, id, status }), `Category ${status}.`)} />}
        {tab === "questions" && <QuestionsPanel subjects={subjects} topics={topics} questions={questions} canEdit={principal.role !== "reviewer"} canPublish={principal.role === "admin" || principal.role === "super_admin" || principal.role === "reviewer"} onSave={(body, method) => perform(() => sendAdmin("/api/admin/questions", method, body), "Question saved.")} onArchive={(id) => perform(() => sendAdmin("/api/admin/questions", "DELETE", { id }), "Question archived.")} onStatus={(id, status) => perform(() => sendAdmin("/api/admin/questions", "PATCH", { id, status }), `Question ${status}.`)} />}
        {tab === "papers" && <PapersPanel papers={papers} questions={questions} canEdit={principal.role !== "reviewer"} canPublish={principal.role === "admin" || principal.role === "super_admin" || principal.role === "reviewer"} onSave={(body, method) => perform(() => sendAdmin("/api/admin/papers", method, body), "Past paper saved.")} onStatus={(id, status) => perform(() => sendAdmin("/api/admin/papers", "PATCH", { id, status }), `Past paper ${status}.`)} />}
        {tab === "team" && canManageUsers && <TeamPanel users={users} currentId={principal.id} isSuperAdmin={principal.role === "super_admin"} onSave={(body, method) => perform(() => sendAdmin("/api/admin/users", method, body), "User account saved.")} />}
      </div>
    </div>
  );
}

function OverviewPanel({ subjects, topics, questions, papers, users, canManageUsers, onSelect }: { subjects: SubjectRow[]; topics: TopicRow[]; questions: AdminQuestion[]; papers: AdminPaper[]; users: AdminUser[]; canManageUsers: boolean; onSelect: (tab: Tab) => void }) {
  const drafts = questions.filter((question) => question.status === "draft").length + papers.filter((paper) => paper.status === "draft").length;
  const stats = [["Subjects", subjects.length, "categories", "categories"], ["Topics", topics.length, "subcategories", "categories"], ["Questions", questions.length, "MCQs in the bank", "questions"], ["Past papers", papers.length, "exam sets", "papers"]] as const;
  return <div className="admin-content-stack">
    <div className="admin-metric-grid">{stats.map(([title, value, hint, target]) => <button type="button" className="admin-metric-card" key={title} onClick={() => onSelect(target)}><span>{title}</span><strong>{value}</strong><small>{hint} <b>→</b></small></button>)}</div>
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">REVIEW QUEUE</span><h3>Content that needs attention</h3></div><StatusBadge status="draft" /></div><p>{drafts ? `${drafts} draft question${drafts === 1 ? "" : "s or papers"} are waiting for review or publication.` : "No draft questions or papers are waiting right now."}</p><div className="admin-quick-links"><button type="button" className="button button-primary" onClick={() => onSelect("questions")}>Manage MCQs <span aria-hidden>→</span></button><button type="button" className="button button-light" onClick={() => onSelect("papers")}>Add a past paper</button><button type="button" className="button button-light" onClick={() => onSelect("categories")}>Create a category</button></div></section>
    {canManageUsers && <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">WORKSPACE ACCESS</span><h3>Team accounts</h3></div><button type="button" className="text-link" onClick={() => onSelect("team")}>Manage team →</button></div><p>{users.filter((user) => user.status === "active").length} active team account{users.filter((user) => user.status === "active").length === 1 ? "" : "s"}. Editors prepare drafts; reviewers publish approved content.</p></section>}
  </div>;
}

function CategoriesPanel({ subjects, topics, canEdit, canPublish, onSave, onStatus }: { subjects: SubjectRow[]; topics: TopicRow[]; canEdit: boolean; canPublish: boolean; onSave: (body: unknown, method: string) => Promise<string>; onStatus: (kind: string, id: number, status: string) => Promise<string> }) {
  const [kind, setKind] = useState<"subject" | "topic">("subject");
  const [edit, setEdit] = useState<SubjectRow | TopicRow | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    const form = new FormData(event.currentTarget);
    const body = { kind, id: edit?.id, name: String(form.get("name") ?? ""), slug: String(form.get("slug") ?? ""), description: String(form.get("description") ?? ""), subjectId: Number(form.get("subjectId")), status: String(form.get("status") ?? "draft") };
    const result = await onSave(body, edit ? "PATCH" : "POST");
    setBusy(false); setNotice(result); if (result) { setEdit(null); event.currentTarget.reset(); }
  }

  function chooseEdit(item: SubjectRow | TopicRow, itemKind: "subject" | "topic") {
    setEdit(item); setKind(itemKind);
    window.setTimeout(() => {
      const form = document.getElementById("admin-category-form") as HTMLFormElement | null;
      if (!form) return;
      (form.elements.namedItem("name") as HTMLInputElement).value = item.name;
      (form.elements.namedItem("slug") as HTMLInputElement).value = item.slug;
      (form.elements.namedItem("description") as HTMLTextAreaElement).value = item.description;
      (form.elements.namedItem("status") as HTMLSelectElement).value = item.status === "archived" ? "draft" : item.status;
      if (itemKind === "topic") (form.elements.namedItem("subjectId") as HTMLSelectElement).value = String((item as TopicRow).subject_id);
    }, 0);
  }

  return <div className="admin-management-grid">
    {canEdit && <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">CONTENT STRUCTURE</span><h3>{edit ? `Edit ${kind}` : "Add a subject or topic"}</h3></div></div>
      <form id="admin-category-form" className="admin-form" onSubmit={submit}>
        <label htmlFor="category-kind">Type</label><select id="category-kind" value={kind} onChange={(event) => { setKind(event.target.value as "subject" | "topic"); setEdit(null); }}><option value="subject">Subject / category</option><option value="topic">Topic / subcategory</option></select>
        {kind === "topic" && <><label htmlFor="category-subject">Parent subject</label><select id="category-subject" name="subjectId" required defaultValue=""><option value="" disabled>Select a subject</option>{subjects.filter((subject) => subject.status !== "archived").map((subject) => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select></>}
        <label htmlFor="category-name">Name</label><input id="category-name" name="name" minLength={2} maxLength={160} required placeholder={kind === "subject" ? "e.g. General Knowledge" : "e.g. Everyday Science"} />
        <label htmlFor="category-slug">URL slug</label><input id="category-slug" name="slug" placeholder="Generated from the name if left blank" />
        <label htmlFor="category-description">Description</label><textarea id="category-description" name="description" rows={3} maxLength={3000} placeholder="Short description for learners and search engines" />
        <label htmlFor="category-status">Publishing status</label><select id="category-status" name="status" defaultValue="draft"><option value="draft">Draft</option><option value="published">Published</option></select>
        <ErrorMessage>{""}</ErrorMessage><SuccessMessage>{notice}</SuccessMessage>
        <div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy || (kind === "topic" && !subjects.length)}>{busy ? "Saving…" : edit ? "Save changes" : "Create category"}</button>{edit && <button className="button button-light" type="button" onClick={() => setEdit(null)}>Cancel edit</button>}</div>
        {kind === "topic" && !subjects.length && <p className="form-hint">Create a subject before adding topics.</p>}
      </form>
    </section>}
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">SUBJECTS & TOPICS</span><h3>{subjects.length} subjects · {topics.length} topics</h3></div></div>
      <div className="admin-record-list">
        {subjects.map((subject) => <article className="admin-record" key={`s-${subject.id}`}><div><div className="admin-record-title"><strong>{subject.name}</strong><StatusBadge status={subject.status} /></div><small>/{subject.slug} · {subject.topic_count} topics</small><p>{subject.description || "No description provided."}</p><div className="admin-inline-actions">{canEdit && <button type="button" className="button button-light" onClick={() => chooseEdit(subject, "subject")}>Edit</button>}{canPublish && subject.status !== "published" && <button type="button" className="button button-primary" onClick={() => void onStatus("subject", subject.id, "published")}>Publish</button>}{canPublish && subject.status !== "archived" && <button type="button" className="button button-light" onClick={() => void onStatus("subject", subject.id, "archived")}>Archive</button>}</div></div></article>)}
        {topics.map((topic) => <article className="admin-record admin-record-nested" key={`t-${topic.id}`}><div><div className="admin-record-title"><strong>{topic.name}</strong><StatusBadge status={topic.status} /></div><small>{topic.subject_name} · /{topic.slug} · {topic.question_count} questions</small><p>{topic.description || "No description provided."}</p><div className="admin-inline-actions">{canEdit && <button type="button" className="button button-light" onClick={() => chooseEdit(topic, "topic")}>Edit</button>}{canPublish && topic.status !== "published" && <button type="button" className="button button-primary" onClick={() => void onStatus("topic", topic.id, "published")}>Publish</button>}{canPublish && topic.status !== "archived" && <button type="button" className="button button-light" onClick={() => void onStatus("topic", topic.id, "archived")}>Archive</button>}</div></div></article>)}
        {!subjects.length && <p className="admin-empty">No categories yet. Add your first subject on the left.</p>}
      </div>
    </section>
  </div>;
}

function QuestionsPanel({ subjects, topics, questions, canEdit, canPublish, onSave, onArchive, onStatus }: { subjects: SubjectRow[]; topics: TopicRow[]; questions: AdminQuestion[]; canEdit: boolean; canPublish: boolean; onSave: (body: unknown, method: string) => Promise<string>; onArchive: (id: number) => Promise<string>; onStatus: (id: number, status: string) => Promise<string> }) {
  const [form, setForm] = useState<QuestionForm>(blankQuestion);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const activeTopics = topics.filter((topic) => topic.status !== "archived" && subjects.some((subject) => subject.id === topic.subject_id && subject.status !== "archived"));
  const shown = questions.filter((question) => `${question.prompt} ${question.topicName} ${question.subjectName} ${question.status}`.toLowerCase().includes(filter.toLowerCase()));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    const result = await onSave({ ...form, id: editingId, topicId: Number(form.topicId) }, editingId ? "PATCH" : "POST");
    setBusy(false); setNotice(result); if (result) { setForm(blankQuestion); setEditingId(null); }
  }
  function editQuestion(question: AdminQuestion) {
    setEditingId(question.id);
    setForm({ topicId: String(question.topicId), prompt: question.prompt, choices: ["A", "B", "C", "D"].map((label) => question.choices.find((choice) => choice.label === label)?.text ?? ""), correctChoice: question.correctChoice, explanation: question.explanation, difficulty: question.difficulty, status: question.status === "published" ? "published" : "draft" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return <div className="admin-management-grid">
    {canEdit && <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">QUESTION EDITOR</span><h3>{editingId ? "Edit MCQ" : "Add a multiple-choice question"}</h3></div></div>
      <form className="admin-form" onSubmit={submit}>
        <label htmlFor="question-topic">Subject · topic</label><select id="question-topic" value={form.topicId} onChange={(event) => setForm({ ...form, topicId: event.target.value })} required><option value="">Select a topic</option>{activeTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.subject_name} · {topic.name}</option>)}</select>
        <label htmlFor="question-prompt">Question text</label><textarea id="question-prompt" value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} rows={3} minLength={8} maxLength={1500} required />
        <div className="admin-choice-grid">{form.choices.map((choice, index) => <div className="admin-choice-field" key={index}><label htmlFor={`question-choice-${index}`}>Option {String.fromCharCode(65 + index)}</label><input id={`question-choice-${index}`} value={choice} onChange={(event) => setForm({ ...form, choices: form.choices.map((item, i) => i === index ? event.target.value : item) })} maxLength={800} required /></div>)}</div>
        <div className="admin-form-two-col"><div><label htmlFor="question-answer">Correct answer</label><select id="question-answer" value={form.correctChoice} onChange={(event) => setForm({ ...form, correctChoice: event.target.value })} required><option value="">Select option</option>{["A", "B", "C", "D"].map((choice) => <option key={choice}>{choice}</option>)}</select></div><div><label htmlFor="question-difficulty">Difficulty</label><select id="question-difficulty" value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value as QuestionForm["difficulty"] })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div></div>
        <label htmlFor="question-explanation">Answer explanation</label><textarea id="question-explanation" value={form.explanation} onChange={(event) => setForm({ ...form, explanation: event.target.value })} rows={3} minLength={3} maxLength={3000} required />
        <label htmlFor="question-status">Publishing status</label><select id="question-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as QuestionForm["status"] })}><option value="draft">Save as draft</option>{canPublish && <option value="published">Publish now</option>}</select>
        <SuccessMessage>{notice}</SuccessMessage><div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy || !activeTopics.length}>{busy ? "Saving…" : editingId ? "Save MCQ" : "Add MCQ"}</button>{editingId && <button type="button" className="button button-light" onClick={() => { setEditingId(null); setForm(blankQuestion); }}>Cancel edit</button>}</div>
        {!activeTopics.length && <p className="form-hint">Create a subject and topic first.</p>}{!canPublish && <p className="form-hint">Your editor role saves questions as drafts. A reviewer or admin can publish them.</p>}
      </form>
    </section>}
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">MCQ BANK</span><h3>{questions.length} questions</h3></div><StatusBadge status="draft" /></div>
      <input className="admin-filter" aria-label="Search MCQ bank" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search by question, topic, or status" />
      <div className="admin-record-list">{shown.map((question) => <article className="admin-record" key={question.id}><div><div className="admin-record-title"><strong>{question.prompt}</strong><StatusBadge status={question.status} /></div><small>{question.subjectName} · {question.topicName} · {question.difficulty}</small><p>{question.choices.map((choice) => `${choice.label}. ${choice.text}`).join("  ·  ")}</p><small>Correct: {question.correctChoice} · {question.explanation}</small><div className="admin-inline-actions">{canEdit && <button type="button" className="button button-light" onClick={() => editQuestion(question)}>Edit</button>}{canPublish && question.status !== "published" && <button type="button" className="button button-primary" onClick={() => void onStatus(question.id, "published")}>Publish</button>}{canPublish && question.status !== "archived" && <button type="button" className="button button-light" onClick={() => void onArchive(question.id)}>Archive</button>}</div></div></article>)}{!shown.length && <p className="admin-empty">No questions match this search.</p>}</div>
    </section>
  </div>;
}

function PapersPanel({ papers, questions, canEdit, canPublish, onSave, onStatus }: { papers: AdminPaper[]; questions: AdminQuestion[]; canEdit: boolean; canPublish: boolean; onSave: (body: unknown, method: string) => Promise<string>; onStatus: (id: number, status: string) => Promise<string> }) {
  const [editing, setEditing] = useState<AdminPaper | null>(null);
  const [examName, setExamName] = useState(""); const [title, setTitle] = useState(""); const [slug, setSlug] = useState(""); const [year, setYear] = useState(String(new Date().getFullYear()));
  const [type, setType] = useState<"Practice set" | "Past paper">("Past paper"); const [description, setDescription] = useState(""); const [status, setStatus] = useState<"draft" | "published">("draft");
  const [questionIds, setQuestionIds] = useState<number[]>([]); const [filter, setFilter] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const publishableQuestions = questions.filter((question) => question.status === "published");
  const shown = papers.filter((paper) => `${paper.title} ${paper.examName} ${paper.year} ${paper.status}`.toLowerCase().includes(filter.toLowerCase()));
  function reset() { setEditing(null); setExamName(""); setTitle(""); setSlug(""); setYear(String(new Date().getFullYear())); setType("Past paper"); setDescription(""); setStatus("draft"); setQuestionIds([]); }
  function selectPaper(paper: AdminPaper) { setEditing(paper); setExamName(paper.examName); setTitle(paper.title); setSlug(paper.slug); setYear(String(paper.year)); setType(paper.type); setDescription(paper.description); setStatus(paper.status === "published" ? "published" : "draft"); setQuestionIds(paper.questionIds); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setNotice(""); const result = await onSave({ id: editing?.id, examName, title, slug, year: Number(year), type, description, status, questionIds }, editing ? "PATCH" : "POST"); setBusy(false); setNotice(result); if (result) reset(); }

  return <div className="admin-management-grid">
    {canEdit && <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">PAPER BUILDER</span><h3>{editing ? "Edit exam paper" : "Create a past paper"}</h3></div></div>
      <form className="admin-form" onSubmit={submit}>
        <label htmlFor="paper-exam">Exam / commission</label><input id="paper-exam" value={examName} onChange={(event) => setExamName(event.target.value)} placeholder="PPSC, FPSC, NTS…" minLength={2} maxLength={160} required />
        <label htmlFor="paper-title">Paper title</label><input id="paper-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="PPSC Junior Clerk Written Test" minLength={3} maxLength={220} required />
        <label htmlFor="paper-slug">URL slug</label><input id="paper-slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="Generated from title if blank" />
        <div className="admin-form-two-col"><div><label htmlFor="paper-year">Exam year</label><input id="paper-year" type="number" value={year} onChange={(event) => setYear(event.target.value)} min="1900" max="2200" required /></div><div><label htmlFor="paper-type">Paper classification</label><select id="paper-type" value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="Past paper">Verified past paper</option><option value="Practice set">Practice set</option></select></div></div>
        <label htmlFor="paper-description">Description and source note</label><textarea id="paper-description" value={description} onChange={(event) => setDescription(event.target.value)} minLength={3} maxLength={3000} rows={3} placeholder="Add exam context. State the source for an official paper." required />
        <label htmlFor="paper-status">Publishing status</label><select id="paper-status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="draft">Save as draft</option>{canPublish && <option value="published">Publish now</option>}</select>
        <fieldset className="admin-question-picker"><legend>Select questions in paper order</legend><div className="admin-picker-list">{questions.filter((question) => question.status !== "archived" || questionIds.includes(question.id)).map((question) => <label className={question.status !== "published" ? "is-muted" : ""} key={question.id}><input type="checkbox" disabled={question.status === "archived" && !questionIds.includes(question.id)} checked={questionIds.includes(question.id)} onChange={(event) => setQuestionIds(event.target.checked ? [...questionIds, question.id] : questionIds.filter((id) => id !== question.id))} /><span>{question.prompt}</span><StatusBadge status={question.status} /></label>)}</div></fieldset>
        <SuccessMessage>{notice}</SuccessMessage><div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy || !questionIds.length}>{busy ? "Saving…" : editing ? "Save paper" : "Create paper"}</button>{editing && <button className="button button-light" type="button" onClick={reset}>Cancel edit</button>}</div>
        {!publishableQuestions.length && <p className="form-hint">Published papers can include only published questions. Add and publish MCQs first.</p>}{questionIds.some((id) => questions.find((question) => question.id === id)?.status !== "published") && <p className="form-hint">This paper contains draft questions, so it must stay a draft until those questions are published.</p>}{!canPublish && <p className="form-hint">Your editor role saves papers as drafts for review.</p>}
      </form>
    </section>}
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">PAPER LIBRARY</span><h3>{papers.length} papers and practice sets</h3></div></div>
      <input className="admin-filter" aria-label="Search past papers" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search by title, exam, year, or status" />
      <div className="admin-record-list">{shown.map((paper) => <article className="admin-record" key={paper.id}><div><div className="admin-record-title"><strong>{paper.title}</strong><StatusBadge status={paper.status} /></div><small>{paper.examName} · {paper.year} · {paper.type} · {paper.questionCount} questions</small><p>{paper.description}</p><div className="admin-inline-actions">{canEdit && <button type="button" className="button button-light" onClick={() => selectPaper(paper)}>Edit</button>}{canPublish && paper.status !== "published" && <button type="button" className="button button-primary" onClick={() => void onStatus(paper.id, "published")}>Publish</button>}{canPublish && paper.status !== "archived" && <button type="button" className="button button-light" onClick={() => void onStatus(paper.id, "archived")}>Archive</button>}</div></div></article>)}{!shown.length && <p className="admin-empty">No papers match this search.</p>}</div>
    </section>
  </div>;
}

function TeamPanel({ users, currentId, isSuperAdmin, onSave }: { users: AdminUser[]; currentId: string; isSuperAdmin: boolean; onSave: (body: unknown, method: string) => Promise<string> }) {
  const [editing, setEditing] = useState<AdminUser | null>(null); const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [role, setRole] = useState<"admin" | "editor" | "reviewer">("editor"); const [status, setStatus] = useState<"active" | "inactive">("active");
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  function reset() { setEditing(null); setName(""); setEmail(""); setPassword(""); setRole("editor"); setStatus("active"); }
  function choose(user: AdminUser) { setEditing(user); setName(user.name); setEmail(user.email); setPassword(""); setRole(user.role === "super_admin" ? "admin" : user.role); setStatus(user.status); }
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setNotice(""); const result = await onSave({ id: editing?.id, name, email, password, role, status }, editing ? "PATCH" : "POST"); setBusy(false); setNotice(result); if (result) reset(); }
  return <div className="admin-management-grid">
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">ACCESS CONTROL</span><h3>{editing ? "Edit team account" : "Invite a team member"}</h3></div></div>
      <p className="admin-helper">Roles control who can create content, publish it, or manage accounts. The bootstrap super-admin login is configured in the server environment.</p>
      <form className="admin-form" onSubmit={submit}>
        <label htmlFor="team-name">Full name</label><input id="team-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={140} required />
        <label htmlFor="team-email">Email</label><input id="team-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={190} required />
        <label htmlFor="team-password">{editing ? "New password (leave blank to keep current)" : "Temporary password"}</label><input id="team-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={200} autoComplete="new-password" required={!editing} />
        <label htmlFor="team-role">Role</label><select id="team-role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="editor">Editor · create and edit drafts</option><option value="reviewer">Reviewer · approve and publish</option>{isSuperAdmin && <option value="admin">Admin · manage content and team</option>}</select>
        {editing && <><label htmlFor="team-status">Account status</label><select id="team-status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">Active</option><option value="inactive">Inactive</option></select></>}
        <SuccessMessage>{notice}</SuccessMessage><div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save account" : "Create account"}</button>{editing && <button className="button button-light" type="button" onClick={reset}>Cancel edit</button>}</div>
        <p className="form-hint">Passwords need at least 12 characters and are stored as salted scrypt hashes. Never send passwords over chat.</p>
      </form>
    </section>
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">TEAM DIRECTORY</span><h3>{users.length} accounts</h3></div></div><p className="admin-helper">Your own account cannot be disabled or assigned a different role.</p>
      <div className="admin-record-list">{users.map((user) => <article className="admin-record" key={user.id}><div><div className="admin-record-title"><strong>{user.name}</strong><StatusBadge status={user.status} /></div><small>{user.email} · {user.role.replace("_", " ")}{user.id === currentId ? " · you" : ""}</small></div><button type="button" className="button button-light" disabled={user.id === currentId || (!isSuperAdmin && user.role === "admin")} onClick={() => choose(user)}>Edit</button></article>)}{!users.length && <p className="admin-empty">No team accounts yet.</p>}</div>
    </section>
  </div>;
}
