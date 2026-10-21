"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminSignOutButton } from "@/components/AdminSignOutButton";
import type { AdminPrincipal, AdminRole } from "@/lib/admin-auth";

type Status = "draft" | "published" | "archived";
type SubjectRow = { id: number; name: string; slug: string; description: string; status: Status; topic_count: number };
type TopicRow = { id: number; subject_id: number; subject_name: string; name: string; slug: string; description: string; status: Status; question_count: number };
type AdminQuestion = { id: number; topicId: number; topicName: string; subjectName: string; prompt: string; explanation: string; sourceNote: string; correctChoice: string; difficulty: "easy" | "medium" | "hard"; status: Status; choices: Array<{ label: string; text: string }> };
type AdminPaper = { id: number; examId: number; examName: string; title: string; slug: string; year: number; type: "Past paper"; description: string; status: Status; questionCount: number; questionIds: number[] };
type PickerQuestion = { id: number; topicId: number; topicName: string; subjectId: number; subjectName: string; prompt: string; sourceNote: string; status: Status; difficulty: "easy" | "medium" | "hard" };
type AdminUser = { id: string; name: string; email: string; role: AdminRole; status: "active" | "inactive" };
type Tab = "overview" | "questions" | "categories" | "papers" | "team";

type QuestionForm = { topicId: string; prompt: string; choices: string[]; correctChoice: string; explanation: string; sourceNote: string; difficulty: "easy" | "medium" | "hard"; status: "draft" | "published" };
const blankQuestion: QuestionForm = { topicId: "", prompt: "", choices: ["", "", "", ""], correctChoice: "", explanation: "", sourceNote: "", difficulty: "medium", status: "draft" };
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
        {tab === "papers" && <PapersPanel papers={papers} subjects={subjects} topics={topics} canEdit={principal.role !== "reviewer"} canPublish={principal.role === "admin" || principal.role === "super_admin" || principal.role === "reviewer"} onSave={(body, method) => perform(() => sendAdmin("/api/admin/papers", method, body), "Past paper saved.")} onStatus={(id, status) => perform(() => sendAdmin("/api/admin/papers", "PATCH", { id, status }), `Past paper ${status}.`)} />}
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
    setForm({ topicId: String(question.topicId), prompt: question.prompt, choices: ["A", "B", "C", "D"].map((label) => question.choices.find((choice) => choice.label === label)?.text ?? ""), correctChoice: question.correctChoice, explanation: question.explanation, sourceNote: question.sourceNote, difficulty: question.difficulty, status: question.status === "published" ? "published" : "draft" });
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
        <label htmlFor="question-source">Source / exam reference</label><input id="question-source" value={form.sourceNote} onChange={(event) => setForm({ ...form, sourceNote: event.target.value })} minLength={4} maxLength={500} placeholder="e.g. PPSC Junior Clerk, 2024, Paper I, Question 17" required /><p className="admin-helper">Add the exam, year, and paper or a reliable source. MCQs without a source cannot be published.</p>
        <label htmlFor="question-status">Publishing status</label><select id="question-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as QuestionForm["status"] })}><option value="draft">Save as draft</option>{canPublish && <option value="published">Publish now</option>}</select>
        <SuccessMessage>{notice}</SuccessMessage><div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy || !activeTopics.length}>{busy ? "Saving…" : editingId ? "Save MCQ" : "Add MCQ"}</button>{editingId && <button type="button" className="button button-light" onClick={() => { setEditingId(null); setForm(blankQuestion); }}>Cancel edit</button>}</div>
        {!activeTopics.length && <p className="form-hint">Create a subject and topic first.</p>}{!canPublish && <p className="form-hint">Your editor role saves questions as drafts. A reviewer or admin can publish them.</p>}
      </form>
    </section>}
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">MCQ BANK</span><h3>{questions.length} questions</h3></div><StatusBadge status="draft" /></div>
      <input className="admin-filter" aria-label="Search MCQ bank" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search by question, topic, or status" />
      <div className="admin-record-list">{shown.map((question) => <article className="admin-record" key={question.id}><div><div className="admin-record-title"><strong>{question.prompt}</strong><StatusBadge status={question.status} /></div><small>{question.subjectName} · {question.topicName} · {question.difficulty}</small><p>{question.choices.map((choice) => `${choice.label}. ${choice.text}`).join("  ·  ")}</p><small>Correct: {question.correctChoice} · {question.explanation}</small><small>Source: {question.sourceNote || "Add a source before publishing."}</small><div className="admin-inline-actions">{canEdit && <button type="button" className="button button-light" onClick={() => editQuestion(question)}>Edit</button>}{canPublish && question.status !== "published" && <button type="button" className="button button-primary" onClick={() => void onStatus(question.id, "published")}>Publish</button>}{canPublish && question.status !== "archived" && <button type="button" className="button button-light" onClick={() => void onArchive(question.id)}>Archive</button>}</div></div></article>)}{!shown.length && <p className="admin-empty">No questions match this search.</p>}</div>
    </section>
  </div>;
}

function PapersPanel({ papers, subjects, topics, canEdit, canPublish, onSave, onStatus }: { papers: AdminPaper[]; subjects: SubjectRow[]; topics: TopicRow[]; canEdit: boolean; canPublish: boolean; onSave: (body: unknown, method: string) => Promise<string>; onStatus: (id: number, status: string) => Promise<string> }) {
  const [editing, setEditing] = useState<AdminPaper | null>(null);
  const [examName, setExamName] = useState(""); const [title, setTitle] = useState(""); const [slug, setSlug] = useState(""); const [year, setYear] = useState(String(new Date().getFullYear()));
  const [description, setDescription] = useState(""); const [status, setStatus] = useState<"draft" | "published">("draft");
  const [selectedQuestions, setSelectedQuestions] = useState<PickerQuestion[]>([]);
  const [search, setSearch] = useState(""); const [subjectId, setSubjectId] = useState(""); const [topicId, setTopicId] = useState(""); const [questionStatus, setQuestionStatus] = useState("published");
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25); const [results, setResults] = useState<PickerQuestion[]>([]); const [total, setTotal] = useState(0);
  const [pickerLoading, setPickerLoading] = useState(true); const [pickerError, setPickerError] = useState(""); const [filter, setFilter] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const questionIds = selectedQuestions.map((question) => question.id);
  const selectedIdSet = new Set(questionIds);
  const shown = papers.filter((paper) => `${paper.title} ${paper.examName} ${paper.year} ${paper.status}`.toLowerCase().includes(filter.toLowerCase()));
  const availableTopics = topics.filter((topic) => !subjectId || topic.subject_id === Number(subjectId));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    const controller = new AbortController();
    const delay = window.setTimeout(async () => {
      setPickerLoading(true); setPickerError("");
      const query = new URLSearchParams({ search, status: questionStatus, page: String(page), pageSize: String(pageSize) });
      if (subjectId) query.set("subjectId", subjectId);
      if (topicId) query.set("topicId", topicId);
      try {
        const response = await fetch(`/api/admin/question-picker?${query}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not search the MCQ bank.");
        setResults(data.questions ?? []); setTotal(Number(data.total ?? 0));
      } catch (error) {
        if (!controller.signal.aborted) setPickerError(error instanceof Error ? error.message : "Could not search the MCQ bank.");
      } finally {
        if (!controller.signal.aborted) setPickerLoading(false);
      }
    }, 180);
    return () => { window.clearTimeout(delay); controller.abort(); };
  }, [search, subjectId, topicId, questionStatus, page, pageSize]);

  function reset() { setEditing(null); setExamName(""); setTitle(""); setSlug(""); setYear(String(new Date().getFullYear())); setDescription(""); setStatus("draft"); setSelectedQuestions([]); }
  async function selectPaper(paper: AdminPaper) {
    setEditing(paper); setExamName(paper.examName); setTitle(paper.title); setSlug(paper.slug); setYear(String(paper.year)); setDescription(paper.description); setStatus(paper.status === "published" ? "published" : "draft");
    setSelectedQuestions([]);
    setPickerError("");
    try {
      const query = new URLSearchParams({ ids: paper.questionIds.join(",") });
      const response = await fetch(`/api/admin/question-picker?${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load this paper's questions.");
      setSelectedQuestions(data.questions ?? []);
    } catch (error) { setPickerError(error instanceof Error ? error.message : "Could not load this paper's questions."); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function toggleQuestion(question: PickerQuestion, checked: boolean) {
    if (checked) setSelectedQuestions((current) => current.some((item) => item.id === question.id) ? current : [...current, question]);
    else setSelectedQuestions((current) => current.filter((item) => item.id !== question.id));
  }
  function addPageQuestions() {
    setSelectedQuestions((current) => {
      const existing = new Set(current.map((question) => question.id));
      return [...current, ...results.filter((question) => question.status !== "archived" && !existing.has(question.id))];
    });
  }
  function moveQuestion(index: number, offset: number) {
    const destination = index + offset;
    if (destination < 0 || destination >= selectedQuestions.length) return;
    setSelectedQuestions((current) => { const updated = [...current]; [updated[index], updated[destination]] = [updated[destination], updated[index]]; return updated; });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    const result = await onSave({ id: editing?.id, examName, title, slug, year: Number(year), type: "Past paper", description, status, questionIds }, editing ? "PATCH" : "POST");
    setBusy(false); setNotice(result); if (result) reset();
  }

  return <div className="admin-content-stack">
    {canEdit && <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">PAPER BUILDER</span><h3>{editing ? "Edit exam paper" : "Create a past paper"}</h3><p>Build the paper from verified MCQs. Search by words, then filter by subject and topic.</p></div></div>
      <form className="admin-form" onSubmit={submit}>
        <div className="paper-details-grid">
          <div><label htmlFor="paper-exam">Exam / commission</label><input id="paper-exam" value={examName} onChange={(event) => setExamName(event.target.value)} placeholder="PPSC, FPSC, NTS…" minLength={2} maxLength={160} required /></div>
          <div><label htmlFor="paper-title">Paper title</label><input id="paper-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="PPSC Junior Clerk Written Test" minLength={3} maxLength={220} required /></div>
          <div><label htmlFor="paper-year">Exam year</label><input id="paper-year" type="number" value={year} onChange={(event) => setYear(event.target.value)} min="1900" max="2200" required /></div>
          <div><label htmlFor="paper-slug">URL slug (optional)</label><input id="paper-slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="Generated from title if blank" /></div>
        </div>
        <label htmlFor="paper-description">Source and paper details</label><textarea id="paper-description" value={description} onChange={(event) => setDescription(event.target.value)} minLength={3} maxLength={3000} rows={2} placeholder="Add source, exam details, and any notes for learners." required />
        <label htmlFor="paper-status">Publishing status</label><select id="paper-status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="draft">Save as draft</option>{canPublish && <option value="published">Publish now</option>}</select>

        <div className="paper-question-builder">
          <div className="paper-picker-heading"><div><span className="eyebrow">QUESTION BANK</span><h4>Add questions to this paper</h4><p>{total.toLocaleString()} matching MCQs · page {page} of {totalPages}</p></div><span className="paper-selected-count">{selectedQuestions.length} selected</span></div>
          <div className="paper-picker-filters">
            <input className="admin-filter" aria-label="Search MCQs for paper" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search question text, source, subject, or topic…" />
            <select aria-label="Filter by subject" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(""); setPage(1); }}><option value="">All subjects</option>{subjects.filter((subject) => subject.status !== "archived").map((subject) => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select>
            <select aria-label="Filter by topic" value={topicId} onChange={(event) => { setTopicId(event.target.value); setPage(1); }}><option value="">All topics</option>{availableTopics.filter((topic) => topic.status !== "archived").map((topic) => <option value={topic.id} key={topic.id}>{topic.name}</option>)}</select>
            <select aria-label="Filter by MCQ status" value={questionStatus} onChange={(event) => { setQuestionStatus(event.target.value); setPage(1); }}><option value="published">Published only</option><option value="active">Published and drafts</option><option value="archived">Archived</option><option value="all">All statuses</option></select>
          </div>
          <div className="paper-picker-toolbar"><span>{pickerLoading ? "Searching…" : `${results.length} shown on this page`}</span><div><label htmlFor="paper-page-size">Rows <select id="paper-page-size" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><button type="button" className="text-link" onClick={addPageQuestions} disabled={!results.some((question) => question.status !== "archived" && !selectedIdSet.has(question.id))}>Add all available on this page</button></div></div>
          {pickerError && <ErrorMessage>{pickerError}</ErrorMessage>}
          <div className="paper-picker-results">{results.map((question) => <label className={`paper-picker-result ${question.status === "archived" ? "is-muted" : ""}`} key={question.id}><input type="checkbox" disabled={question.status === "archived" && !selectedIdSet.has(question.id)} checked={selectedIdSet.has(question.id)} onChange={(event) => toggleQuestion(question, event.target.checked)} /><span className="paper-picker-result-copy"><strong>{question.prompt}</strong><small>{question.subjectName} · {question.topicName} · {question.difficulty}</small><small>Source: {question.sourceNote || "Source reference required"}</small></span><StatusBadge status={question.status} /></label>)}{!pickerLoading && !results.length && <p className="admin-empty">No MCQs match these filters.</p>}</div>
          <div className="paper-picker-pagination"><button type="button" className="button button-light" disabled={page <= 1 || pickerLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>← Previous</button><span>Page {page} / {totalPages}</span><button type="button" className="button button-light" disabled={page >= totalPages || pickerLoading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next →</button></div>
          <section className="paper-selected-list"><div className="paper-selected-heading"><strong>Paper order</strong><span>Use arrows to arrange the final question order.</span></div>{selectedQuestions.map((question, index) => <article key={question.id}><b>{String(index + 1).padStart(2, "0")}</b><span>{question.prompt}<small>{question.subjectName} · {question.topicName} · {question.sourceNote || "Source required"}</small></span><StatusBadge status={question.status} /><div className="paper-order-actions"><button type="button" aria-label={`Move question ${index + 1} up`} title="Move up" disabled={index === 0} onClick={() => moveQuestion(index, -1)}>↑</button><button type="button" aria-label={`Move question ${index + 1} down`} title="Move down" disabled={index === selectedQuestions.length - 1} onClick={() => moveQuestion(index, 1)}>↓</button><button type="button" aria-label={`Remove question ${index + 1}`} title="Remove" onClick={() => toggleQuestion(question, false)}>×</button></div></article>)}{!selectedQuestions.length && <p className="admin-empty">Search for an MCQ above, then add it to this paper.</p>}</section>
        </div>

        <SuccessMessage>{notice}</SuccessMessage><div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy || !selectedQuestions.length}>{busy ? "Saving…" : editing ? "Save paper" : "Create paper"}</button>{editing && <button className="button button-light" type="button" onClick={reset}>Cancel edit</button>}</div>
        {selectedQuestions.some((question) => question.status !== "published") && <p className="form-hint">This paper contains draft or archived MCQs, so it must stay a draft until you replace or publish them.</p>}{!canPublish && <p className="form-hint">Your editor role saves papers as drafts for review.</p>}
      </form>
    </section>}
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">PAPER LIBRARY</span><h3>{papers.length} past papers</h3></div></div>
      <input className="admin-filter" aria-label="Search past papers" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search by title, exam, year, or status" />
      <div className="admin-record-list">{shown.map((paper) => <article className="admin-record" key={paper.id}><div><div className="admin-record-title"><strong>{paper.title}</strong><StatusBadge status={paper.status} /></div><small>{paper.examName} · {paper.year} · {paper.questionCount} MCQs</small><p>{paper.description}</p><div className="admin-inline-actions">{canEdit && <button type="button" className="button button-light" onClick={() => void selectPaper(paper)}>Edit</button>}{canPublish && paper.status !== "published" && <button type="button" className="button button-primary" onClick={() => void onStatus(paper.id, "published")}>Publish</button>}{canPublish && paper.status !== "archived" && <button type="button" className="button button-light" onClick={() => void onStatus(paper.id, "archived")}>Archive</button>}</div></div></article>)}{!shown.length && <p className="admin-empty">No past papers match this search.</p>}</div>
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
