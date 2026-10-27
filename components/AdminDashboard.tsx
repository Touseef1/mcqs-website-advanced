"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminSignOutButton } from "@/components/AdminSignOutButton";
import { AdminQuestionWorkspace } from "@/components/AdminQuestionWorkspace";
import { AdminExams } from "@/components/AdminExams";
import type { AdminCapabilities, AdminPrincipal, AdminRole } from "@/lib/admin-auth";

type Status = "draft" | "in_review" | "approved" | "published" | "rejected" | "archived";
type SubjectRow = { id: number; name: string; slug: string; description: string; status: Status; topic_count: number };
type TopicRow = { id: number; subject_id: number; subject_name: string; name: string; slug: string; description: string; status: Status; question_count: number };
type AdminQuestion = { id: number; createdBy?: number | string; topicId: number; topicName: string; subjectName: string; prompt: string; explanation: string; sourceNote: string; correctChoice: string; difficulty: "easy" | "medium" | "hard"; status: Status; reviewNote?: string | null; paperIds: number[]; choices: Array<{ label: string; text: string }> };
type AdminPaper = { id: number; examId: number; examName: string; title: string; slug: string; year: number; type: "Past paper" | "Model paper" | "Mock test"; description: string; shiftSession?: string | null; expectedQuestionCount?: number | null; status: Status; questionCount: number; questionIds: number[] };
type PickerQuestion = { id: number; topicId: number; topicName: string; subjectId: number; subjectName: string; prompt: string; sourceNote: string; status: Status; difficulty: "easy" | "medium" | "hard" };
type AdminUser = { id: string; name: string; email: string; role: AdminRole; status: "active" | "inactive"; last_login_at?: string | null };
type ExamRow = { id: number; name: string; slug: string };
type DashboardStats = { statuses: Record<string, number>; categories: Array<{ subject_name: string; topic_name: string; question_count: number }>; emptyCategories: Array<{ subject_name: string; topic_name: string; question_count: number }>; shortPapers: Array<{ id: number; title: string; expected_question_count: number; question_count: number }> };
type Tab = "overview" | "questions" | "review" | "categories" | "exams" | "papers" | "team";

const tabLabels: Record<Tab, string> = { overview: "Overview", questions: "MCQ bank", review: "Review queue", categories: "Categories", exams: "Exams", papers: "Past papers", team: "Team & roles" };
const tabIcons: Record<Tab, string> = { overview: "⌂", questions: "▤", review: "◷", categories: "◈", exams: "◇", papers: "▣", team: "♙" };
const roleLabels: Record<AdminRole, string> = { data_entry: "Data Entry", reviewer: "Reviewer", publisher: "Publisher", admin: "Admin", super_admin: "Super Admin" };

async function sendAdmin(path: string, method = "GET", body?: unknown) {
  const send = (payload?: unknown) => fetch(path, {
    method,
    cache: "no-store",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  let response = await send(body);
  const result = await response.json().catch(() => ({}));
  if (!response.ok && Array.isArray(result.affectedPapers) && body && typeof body === "object" && !("confirmPaperRemoval" in body)) {
    const names = (result.affectedPapers as Array<{ title?: string }>).map((paper) => paper.title).filter(Boolean).join("\n• ");
    if (window.confirm(`${result.error || "This change affects published papers."}\n\nAffected papers:\n• ${names}\n\nConfirm and continue?`)) {
      response = await send({ ...(body as Record<string, unknown>), confirmPaperRemoval: true });
      const confirmed = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(confirmed.error || "The request could not be completed.");
      return confirmed;
    }
  }
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

export function AdminDashboard({ principal, capabilities }: { principal: AdminPrincipal; capabilities: AdminCapabilities }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [globalSearch, setGlobalSearch] = useState("");
  const [entryPaperId, setEntryPaperId] = useState<number | null>(null);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [papers, setPapers] = useState<AdminPaper[]>([]);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({ statuses: {}, categories: [], emptyCategories: [], shortPapers: [] });
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadData = useCallback(async () => {
    const [categoryResult, questionResult, paperResult, examResult, statsResult, userResult] = await Promise.allSettled([
      sendAdmin("/api/admin/categories"), sendAdmin("/api/admin/questions"), sendAdmin("/api/admin/papers"),
      capabilities.managePapers ? sendAdmin("/api/admin/exams") : Promise.resolve({ exams: [] }),
      sendAdmin("/api/admin/dashboard"),
      capabilities.manageUsers ? sendAdmin("/api/admin/users") : Promise.resolve({ users: [] }),
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
    if (examResult.status === "fulfilled") setExams(examResult.value.exams ?? []);
    else failure ||= examResult.reason instanceof Error ? examResult.reason.message : "Could not load exams.";
    if (statsResult.status === "fulfilled") setDashboardStats(statsResult.value);
    if (userResult.status === "fulfilled") setUsers(userResult.value.users ?? []);
    setLoadError(failure);
    setLoading(false);
  }, [capabilities.managePapers, capabilities.manageUsers]);

  async function refresh() { setLoading(true); await loadData(); }

  useEffect(() => {
    const request = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(request);
  }, [loadData]);

  const allowedTabs = useMemo<Tab[]>(() => [
    "overview",
    "questions",
    ...(capabilities.reviewMcqs ? ["review" as const] : []),
    ...(capabilities.manageCategories ? ["categories" as const] : []),
    ...(capabilities.managePapers ? ["exams" as const, "papers" as const] : []),
    ...(capabilities.manageUsers ? ["team" as const] : []),
  ], [capabilities.manageCategories, capabilities.managePapers, capabilities.manageUsers, capabilities.reviewMcqs]);

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
        <a className="admin-brand" href="/admin" aria-label="MCQPath admin home"><span className="admin-brand-mark">M</span><span><strong>MCQPath</strong><small>ADMIN WORKSPACE</small></span></a>
        <div className="admin-sidebar-label">WORKSPACE</div>
        <nav aria-label="Admin sections">
          {allowedTabs.map((item) => <button type="button" key={item} className={tab === item ? "active" : ""} aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}><span className="admin-nav-icon" aria-hidden="true">{tabIcons[item]}</span><span>{tabLabels[item]}</span>{item === "review" && <span className="admin-nav-count">{dashboardStats.statuses.in_review ?? 0}</span>}</button>)}
        </nav>
        <div className="admin-sidebar-spacer" />
        <div className="admin-user-chip"><span className="admin-avatar">{principal.name.slice(0, 1).toUpperCase()}</span><span><strong>{principal.name}</strong><small>{roleLabels[principal.role]}</small></span></div>
        <div className="admin-sidebar-foot"><AdminSignOutButton /></div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-workspace-heading">
          <form className="admin-global-search" onSubmit={(event) => { event.preventDefault(); setTab("questions"); }} role="search"><span aria-hidden="true">⌕</span><input aria-label="Search MCQs" value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Search MCQs" /><kbd>↵</kbd></form>
          <div className="admin-topbar-actions"><span className="admin-topbar-user"><span><strong>{principal.name} · {roleLabels[principal.role]}</strong></span><span className="admin-avatar">{principal.name.slice(0, 1).toUpperCase()}</span></span><a className="button button-light" href="/admin/password" aria-label="Change password">•••</a><button className="button button-light admin-refresh" type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh data">{loading ? "…" : "↻"}</button></div>
        </header>
        <main className="admin-content-area">
          <div className="admin-section-intro"><div><h1>{tabLabels[tab]}</h1><p>{tab === "overview" ? "Content status, coverage and papers that need attention." : tab === "questions" ? "Search, filter, review and publish questions." : tab === "review" ? "Review submitted questions and record a decision." : tab === "categories" ? "Subjects contain topics. Every MCQ belongs to one topic." : tab === "exams" ? "Manage exam bodies used by your paper records." : tab === "papers" ? "Create papers, then build them from the question bank." : "Manage staff access and content permissions."}</p></div>{(tab === "overview" || tab === "questions") && capabilities.createMcqs && <button type="button" className="button button-primary" onClick={() => { setGlobalSearch(""); setTab("questions"); }}>＋ Add MCQs</button>}{tab === "papers" && capabilities.managePapers && <button type="button" className="button button-primary" onClick={() => document.getElementById("create-paper-start")?.scrollIntoView({ behavior: "smooth", block: "start" })}>＋ Create paper</button>}</div>
          <ErrorMessage>{loadError}</ErrorMessage>
          {loading && !subjects.length && !questions.length && !papers.length ? <div className="loading-panel">Loading admin records…</div> : null}
          {tab === "overview" && <OverviewPanel subjects={subjects} topics={topics} questions={questions} papers={papers} users={users} metrics={dashboardStats} canManageCategories={capabilities.manageCategories} canManagePapers={capabilities.managePapers} canManageUsers={capabilities.manageUsers} canCreateMcqs={capabilities.createMcqs} canReviewMcqs={capabilities.reviewMcqs} onSelect={setTab} />}
          {tab === "categories" && capabilities.manageCategories && <CategoriesPanel subjects={subjects} topics={topics} canEdit={capabilities.manageCategories} canPublish={capabilities.publishContent} canDelete={capabilities.deleteContent} onSave={(body, method) => perform(() => sendAdmin("/api/admin/categories", method, body), "Category saved.")} onStatus={(kind, id, status) => perform(() => sendAdmin("/api/admin/categories", "PATCH", { kind, id, status }), `Category ${status}.`)} />}
          {(tab === "questions" || tab === "review") && <QuestionsPanel key={tab} topics={topics} papers={papers} canManagePapers={capabilities.managePapers} canAddQuestionsToPapers={capabilities.addQuestionsToPapers} canQuickCreatePaper={capabilities.quickCreatePapers} canPublish={capabilities.publishContent} canDelete={capabilities.deleteContent} canCreateMcqs={capabilities.createMcqs} canReviewMcqs={capabilities.reviewMcqs} canEditOwnMcqs={capabilities.editOwnMcqs} canEditAnyMcqs={capabilities.editAnyMcqs} currentUserId={principal.id} initialPaperId={entryPaperId} initialSearch={tab === "questions" ? globalSearch : ""} initialStatus={tab === "review" ? "in_review" : "all"} startInBank={tab === "review" || Boolean(globalSearch)} onUpdated={refresh} />}
          {tab === "exams" && capabilities.managePapers && <AdminExams exams={exams} onSave={(body, method) => perform(() => sendAdmin("/api/admin/exams", method, body), "Exam saved.")} />}
          {tab === "papers" && capabilities.managePapers && <PapersPanel papers={papers} exams={exams} subjects={subjects} topics={topics} canEdit={capabilities.managePapers} canPublish={capabilities.publishContent} canDelete={capabilities.managePapers} onSave={(body, method) => perform(() => sendAdmin("/api/admin/papers", method, body), "Paper saved.")} onStatus={(id, status) => perform(() => sendAdmin("/api/admin/papers", "PATCH", { id, status }), `Paper ${status}.`)} onReorder={(paperId, questionIds) => perform(() => sendAdmin("/api/admin/papers/reorder", "POST", { paperId, questionIds }), "Question order saved.")} onAddMcqs={(paperId) => { setEntryPaperId(paperId); setTab("questions"); }} />}
          {tab === "team" && capabilities.manageUsers && <TeamPanel users={users} currentId={principal.id} isSuperAdmin={principal.role === "super_admin"} onSave={(body, method) => perform(() => sendAdmin("/api/admin/users", method, body), "User account saved.")} />}
        </main>
      </div>
    </div>
  );
}

function OverviewPanel({ subjects, topics, questions, papers, users, metrics, canManageCategories, canManagePapers, canManageUsers, canCreateMcqs, canReviewMcqs, onSelect }: { subjects: SubjectRow[]; topics: TopicRow[]; questions: AdminQuestion[]; papers: AdminPaper[]; users: AdminUser[]; metrics: DashboardStats; canManageCategories: boolean; canManagePapers: boolean; canManageUsers: boolean; canCreateMcqs: boolean; canReviewMcqs: boolean; onSelect: (tab: Tab) => void }) {
  const total = Object.entries(metrics.statuses).reduce((sum, [status, count]) => status === "archived" ? sum : sum + Number(count), 0);
  const drafts = Number(metrics.statuses.draft ?? 0);
  const waiting = Number(metrics.statuses.in_review ?? 0);
  const published = Number(metrics.statuses.published ?? 0);
  const rejected = Number(metrics.statuses.rejected ?? 0);
  const approved = Number(metrics.statuses.approved ?? 0);
  const bySubject = metrics.categories.reduce<Array<{ name: string; count: number }>>((rows, item) => {
    const row = rows.find((value) => value.name === item.subject_name);
    if (row) row.count += Number(item.question_count);
    else rows.push({ name: item.subject_name, count: Number(item.question_count) });
    return rows;
  }, []).sort((a, b) => b.count - a.count).slice(0, 5);
  const maxCount = Math.max(1, ...bySubject.map((row) => row.count));
  const stats = [
    { title: "Total MCQs", value: total, hint: "Across active categories", tone: "neutral", target: "questions" as Tab },
    { title: "Drafts", value: drafts, hint: "Need completion", tone: "neutral", target: "questions" as Tab },
    { title: "In review", value: waiting, hint: "Waiting for review", tone: "warning", target: canReviewMcqs ? "review" as Tab : "questions" as Tab },
    { title: "Published", value: published, hint: "Live to learners", tone: "success", target: "questions" as Tab },
  ];
  return <div className="admin-content-stack">
    <div className="admin-metric-grid">{stats.map((item) => <button type="button" className="admin-metric-card" key={item.title} onClick={() => onSelect(item.target)}><span>{item.title}</span><strong>{item.value.toLocaleString()}</strong><small className={`metric-pill metric-pill-${item.tone}`}>{item.hint}</small></button>)}</div>
    <div className="overview-insight-grid">
      {canManageCategories && <section className="admin-panel overview-category-panel"><div className="admin-panel-heading"><h3>MCQs by category</h3><button type="button" className="text-link" onClick={() => onSelect("categories")}>View categories</button></div>{bySubject.map((row) => <div className="overview-category-row" key={row.name}><span>{row.name}</span><span className="overview-category-track"><i style={{ width: `${Math.max(2, row.count / maxCount * 100)}%` }} /></span><strong>{row.count.toLocaleString()}</strong></div>)}{!bySubject.length && <p className="admin-empty">Category totals will appear when MCQs are available.</p>}<p className="overview-subtle-note">{metrics.emptyCategories.length} topics have no MCQs yet.</p></section>}
      <section className="admin-panel overview-queue-panel"><div className="admin-panel-heading"><h3>Your queue</h3><span className="overview-queue-total">{(waiting + rejected + approved).toLocaleString()}</span></div><button type="button" onClick={() => onSelect(canReviewMcqs ? "review" : "questions")}><span>Waiting for review</span><b className="queue-pill queue-pill-warning">{waiting}</b></button><button type="button" onClick={() => onSelect("questions")}><span>Rejected with comments</span><b className="queue-pill queue-pill-danger">{rejected}</b></button><button type="button" onClick={() => onSelect("questions")}><span>Approved, ready to publish</span><b className="queue-pill queue-pill-blue">{approved}</b></button></section>
    </div>
    {canManagePapers && <section className="admin-panel overview-papers-panel"><div className="admin-panel-heading"><h3>Papers needing attention</h3><button type="button" className="text-link" onClick={() => onSelect("papers")}>View all papers</button></div>{metrics.shortPapers.length ? <div className="admin-table-wrap"><table className="admin-data-table"><thead><tr><th>Paper</th><th>Exam</th><th>Questions</th><th>Status</th></tr></thead><tbody>{metrics.shortPapers.slice(0, 5).map((item) => { const paper = papers.find((value) => value.id === item.id); const missing = item.expected_question_count - item.question_count; return <tr key={item.id}><td><strong>{item.title}</strong></td><td>{paper?.examName ?? "—"}</td><td>{item.question_count} / {item.expected_question_count}</td><td><span className="queue-pill queue-pill-warning">{missing} missing</span></td></tr>; })}</tbody></table></div> : <p className="admin-empty">No papers are below their expected question count.</p>}</section>}
    {canCreateMcqs && <section className="admin-panel overview-my-work"><div><span className="eyebrow">MY WORK</span><h3>Keep the question bank moving</h3><p>{drafts} drafts need completion. {waiting} MCQs are currently in review.</p></div><button type="button" className="button button-primary" onClick={() => onSelect("questions")}>Add MCQs</button></section>}
    {canManageUsers && <section className="admin-panel overview-team-note"><div className="admin-panel-heading"><h3>Team access</h3><button type="button" className="text-link" onClick={() => onSelect("team")}>Manage team</button></div><p>{users.filter((user) => user.status === "active").length} active staff accounts. Role permissions control which tools are available to each account.</p></section>}
    {!subjects.length && !topics.length && !questions.length && <p className="admin-empty">Your admin workspace is ready. Add a category to get started.</p>}
  </div>;
}

function CategoriesPanel({ subjects, topics, canEdit, canPublish, canDelete, onSave, onStatus }: { subjects: SubjectRow[]; topics: TopicRow[]; canEdit: boolean; canPublish: boolean; canDelete: boolean; onSave: (body: unknown, method: string) => Promise<string>; onStatus: (kind: string, id: number, status: string) => Promise<string> }) {
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
        <label htmlFor="category-status">Publishing status</label><select id="category-status" name="status" defaultValue="draft"><option value="draft">Draft</option>{canPublish && <option value="published">Published</option>}</select>
        <ErrorMessage>{""}</ErrorMessage><SuccessMessage>{notice}</SuccessMessage>
        <div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy || (kind === "topic" && !subjects.length)}>{busy ? "Saving…" : edit ? "Save changes" : "Create category"}</button>{edit && <button className="button button-light" type="button" onClick={() => setEdit(null)}>Cancel edit</button>}</div>
        {kind === "topic" && !subjects.length && <p className="form-hint">Create a subject before adding topics.</p>}
      </form>
    </section>}
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">SUBJECTS & TOPICS</span><h3>{subjects.length} subjects · {topics.length} topics</h3></div></div>
      <div className="admin-record-list">
        {subjects.map((subject) => <article className="admin-record" key={`s-${subject.id}`}><div><div className="admin-record-title"><strong>{subject.name}</strong><StatusBadge status={subject.status} /></div><small>/{subject.slug} · {subject.topic_count} topics</small><p>{subject.description || "No description provided."}</p><div className="admin-inline-actions"><a className="text-link" href={`/api/admin/export?kind=category&categoryType=subject&id=${subject.id}&format=csv`}>Export CSV</a><a className="text-link" href={`/api/admin/export?kind=category&categoryType=subject&id=${subject.id}&format=pdf`}>Export PDF</a>{canEdit && (subject.status !== "published" || canPublish) && <button type="button" className="button button-light" onClick={() => chooseEdit(subject, "subject")}>Edit</button>}{canPublish && subject.status !== "published" && <button type="button" className="button button-primary" onClick={() => void onStatus("subject", subject.id, "published")}>Publish</button>}{canDelete && subject.status !== "archived" && <button type="button" className="button button-light" onClick={() => void onStatus("subject", subject.id, "archived")}>Archive</button>}</div></div></article>)}
        {topics.map((topic) => <article className="admin-record admin-record-nested" key={`t-${topic.id}`}><div><div className="admin-record-title"><strong>{topic.name}</strong><StatusBadge status={topic.status} /></div><small>{topic.subject_name} · /{topic.slug} · {topic.question_count} questions</small><p>{topic.description || "No description provided."}</p><div className="admin-inline-actions"><a className="text-link" href={`/api/admin/export?kind=category&id=${topic.id}&format=csv`}>Export CSV</a><a className="text-link" href={`/api/admin/export?kind=category&id=${topic.id}&format=pdf`}>Export PDF</a>{canEdit && (topic.status !== "published" || canPublish) && <button type="button" className="button button-light" onClick={() => chooseEdit(topic, "topic")}>Edit</button>}{canPublish && topic.status !== "published" && <button type="button" className="button button-primary" onClick={() => void onStatus("topic", topic.id, "published")}>Publish</button>}{canDelete && topic.status !== "archived" && <button type="button" className="button button-light" onClick={() => void onStatus("topic", topic.id, "archived")}>Archive</button>}</div></div></article>)}
        {!subjects.length && <p className="admin-empty">No categories yet. Add your first subject on the left.</p>}
      </div>
    </section>
  </div>;
}

function QuestionsPanel({ topics, papers, canManagePapers, canAddQuestionsToPapers, canQuickCreatePaper, canPublish, canDelete, canCreateMcqs, canReviewMcqs, canEditOwnMcqs, canEditAnyMcqs, currentUserId, initialPaperId, initialSearch, initialStatus, startInBank, onUpdated }: { topics: TopicRow[]; papers: AdminPaper[]; canManagePapers: boolean; canAddQuestionsToPapers: boolean; canQuickCreatePaper: boolean; canPublish: boolean; canDelete: boolean; canCreateMcqs: boolean; canReviewMcqs: boolean; canEditOwnMcqs: boolean; canEditAnyMcqs: boolean; currentUserId: string; initialPaperId: number | null; initialSearch: string; initialStatus: string; startInBank: boolean; onUpdated: () => Promise<void> }) {
  return <AdminQuestionWorkspace topics={topics} papers={papers} canManagePapers={canManagePapers} canAddQuestionsToPapers={canAddQuestionsToPapers} canQuickCreatePaper={canQuickCreatePaper} canPublish={canPublish} canDelete={canDelete} canCreateMcqs={canCreateMcqs} canReviewMcqs={canReviewMcqs} canEditOwnMcqs={canEditOwnMcqs} canEditAnyMcqs={canEditAnyMcqs} currentUserId={currentUserId} initialPaperId={initialPaperId} initialSearch={initialSearch} initialStatus={initialStatus} startInBank={startInBank} onUpdated={onUpdated} />;
}

function PapersPanel({ papers, exams, subjects, topics, canEdit, canPublish, canDelete, onSave, onStatus, onReorder, onAddMcqs }: { papers: AdminPaper[]; exams: ExamRow[]; subjects: SubjectRow[]; topics: TopicRow[]; canEdit: boolean; canPublish: boolean; canDelete: boolean; onSave: (body: unknown, method: string) => Promise<string>; onStatus: (id: number, status: string) => Promise<string>; onReorder: (paperId: number, questionIds: number[]) => Promise<string>; onAddMcqs: (paperId: number) => void }) {
  const [editing, setEditing] = useState<AdminPaper | null>(null);
  const [examName, setExamName] = useState(""); const [title, setTitle] = useState(""); const [slug, setSlug] = useState(""); const [year, setYear] = useState(String(new Date().getFullYear()));
  const [description, setDescription] = useState(""); const [status, setStatus] = useState<"draft" | "published">("draft");
  const [paperType, setPaperType] = useState<AdminPaper["type"]>("Past paper"); const [shiftSession, setShiftSession] = useState(""); const [expectedQuestionCount, setExpectedQuestionCount] = useState("");
  const [selectedQuestions, setSelectedQuestions] = useState<PickerQuestion[]>([]);
  const [search, setSearch] = useState(""); const [subjectId, setSubjectId] = useState(""); const [topicId, setTopicId] = useState(""); const [questionStatus, setQuestionStatus] = useState("published");
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25); const [results, setResults] = useState<PickerQuestion[]>([]); const [total, setTotal] = useState(0);
  const [pickerLoading, setPickerLoading] = useState(true); const [pickerError, setPickerError] = useState(""); const [filter, setFilter] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
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

  function reset() { setEditing(null); setExamName(""); setTitle(""); setSlug(""); setYear(String(new Date().getFullYear())); setDescription(""); setStatus("draft"); setPaperType("Past paper"); setShiftSession(""); setExpectedQuestionCount(""); setSelectedQuestions([]); }
  async function selectPaper(paper: AdminPaper) {
    setEditing(paper); setExamName(paper.examName); setTitle(paper.title); setSlug(paper.slug); setYear(String(paper.year)); setDescription(paper.description); setStatus(paper.status === "published" ? "published" : "draft"); setPaperType(paper.type); setShiftSession(paper.shiftSession ?? ""); setExpectedQuestionCount(paper.expectedQuestionCount == null ? "" : String(paper.expectedQuestionCount));
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
    const updated = [...selectedQuestions]; [updated[index], updated[destination]] = [updated[destination], updated[index]];
    setSelectedQuestions(updated);
    if (editing) void onReorder(editing.id, updated.map((question) => question.id));
  }
  function dropQuestion(index: number) {
    if (dragIndex === null || dragIndex === index) { setDragIndex(null); return; }
    const updated = [...selectedQuestions];
    const [moved] = updated.splice(dragIndex, 1);
    updated.splice(index, 0, moved);
    setSelectedQuestions(updated); setDragIndex(null);
    if (editing) void onReorder(editing.id, updated.map((question) => question.id));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    const result = await onSave({ id: editing?.id, examName, title, slug, year: Number(year), type: paperType, shiftSession, expectedQuestionCount, description, status, questionIds }, editing ? "PATCH" : "POST");
    setBusy(false); setNotice(result); if (result) reset();
  }

  return <div className="admin-content-stack">
    {canEdit && <section className="admin-panel" id="create-paper-start"><div className="admin-panel-heading"><div><span className="eyebrow">PAPER BUILDER</span><h3>{editing ? "Edit exam paper" : "Create a past paper"}</h3><p>Build the paper from verified MCQs. Search by words, then filter by subject and topic.</p></div></div>
      <form className="admin-form" onSubmit={submit}>
        <div className="paper-details-grid">
          <div><label htmlFor="paper-exam">Exam / commission</label><select id="paper-exam" value={examName} onChange={(event) => setExamName(event.target.value)} required><option value="">Select exam</option>{exams.map((exam) => <option key={exam.id} value={exam.name}>{exam.name}</option>)}</select></div>
          <div><label htmlFor="paper-title">Paper title</label><input id="paper-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="PPSC Junior Clerk Written Test" minLength={3} maxLength={220} required /></div>
          <div><label htmlFor="paper-year">Exam year</label><input id="paper-year" type="number" value={year} onChange={(event) => setYear(event.target.value)} min="1900" max="2200" required /></div>
          <div><label htmlFor="paper-slug">URL slug (optional)</label><input id="paper-slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="Generated from title if blank" /></div>
          <div><label htmlFor="paper-type">Paper type</label><select id="paper-type" value={paperType} onChange={(event) => setPaperType(event.target.value as AdminPaper["type"])}><option>Past paper</option><option>Model paper</option><option>Mock test</option></select></div>
          <div><label htmlFor="paper-shift">Shift / session (optional)</label><input id="paper-shift" value={shiftSession} onChange={(event) => setShiftSession(event.target.value)} maxLength={120} placeholder="Morning shift, Session A…" /></div>
          <div><label htmlFor="paper-expected">Expected questions (optional)</label><input id="paper-expected" type="number" value={expectedQuestionCount} onChange={(event) => setExpectedQuestionCount(event.target.value)} min="1" max="500" placeholder="e.g. 100" /></div>
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
          <section className="paper-selected-list"><div className="paper-selected-heading"><strong>Paper order</strong><span>Drag a question or use the arrows to reorder.</span></div>{selectedQuestions.map((question, index) => <article key={question.id} draggable onDragStart={() => setDragIndex(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropQuestion(index)} className={dragIndex === index ? "is-dragging" : ""}><button type="button" className="paper-drag-handle" aria-label={`Drag question ${index + 1}`} title="Drag to reorder">⠿</button><b>{String(index + 1).padStart(2, "0")}</b><span>{question.prompt}<small>{question.subjectName} · {question.topicName} · {question.sourceNote || "Source required"}</small></span><StatusBadge status={question.status} /><div className="paper-order-actions"><button type="button" aria-label={`Move question ${index + 1} up`} title="Move up" disabled={index === 0} onClick={() => moveQuestion(index, -1)}>↑</button><button type="button" aria-label={`Move question ${index + 1} down`} title="Move down" disabled={index === selectedQuestions.length - 1} onClick={() => moveQuestion(index, 1)}>↓</button><button type="button" aria-label={`Remove question ${index + 1}`} title="Remove" onClick={() => toggleQuestion(question, false)}>×</button></div></article>)}{!selectedQuestions.length && <p className="admin-empty">Search for an MCQ above, then add it to this paper.</p>}</section>
        </div>

        <SuccessMessage>{notice}</SuccessMessage><div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy || !selectedQuestions.length}>{busy ? "Saving…" : editing ? "Save paper" : "Create paper"}</button>{editing && <button className="button button-light" type="button" onClick={reset}>Cancel edit</button>}</div>
        {selectedQuestions.some((question) => question.status !== "published") && <p className="form-hint">This paper contains draft or archived MCQs, so it must stay a draft until you replace or publish them.</p>}{!canPublish && <p className="form-hint">Your editor role saves papers as drafts for review.</p>}
      </form>
    </section>}
    <section className="admin-panel admin-paper-library"><div className="admin-panel-heading"><div><span className="eyebrow">PAPER LIBRARY</span><h3>{papers.length} past papers</h3></div></div>
      <input className="admin-filter" aria-label="Search past papers" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search by title, exam, year, or status" />
      <div className="admin-table-wrap"><table className="admin-data-table"><thead><tr><th>Paper</th><th>Exam</th><th>Type</th><th>Year / shift</th><th>Questions</th><th>Status</th><th>Actions</th></tr></thead><tbody>{shown.map((paper) => <tr key={paper.id}><td><strong>{paper.title}</strong>{paper.description && <small className="admin-paper-description">{paper.description}</small>}</td><td>{paper.examName}</td><td>{paper.type}</td><td>{paper.year} · {paper.shiftSession || "—"}</td><td>{paper.questionCount}{paper.expectedQuestionCount ? ` / ${paper.expectedQuestionCount}` : ""}</td><td><StatusBadge status={paper.status} /></td><td><div className="admin-inline-actions admin-paper-actions"><a className="text-link" href={`/api/admin/export?kind=paper&id=${paper.id}&format=csv`}>CSV</a><a className="text-link" href={`/api/admin/export?kind=paper&id=${paper.id}&format=pdf`}>PDF</a>{canEdit && paper.status !== "archived" && <button type="button" className="button button-light" onClick={() => onAddMcqs(paper.id)}>Add MCQs</button>}{canEdit && <button type="button" className="button button-light" onClick={() => void selectPaper(paper)}>Edit</button>}{canPublish && paper.status !== "published" && <button type="button" className="button button-primary" onClick={() => void onStatus(paper.id, "published")}>Publish</button>}{canDelete && paper.status !== "archived" && <button type="button" className="button button-light" onClick={() => void onStatus(paper.id, "archived")}>Archive</button>}</div></td></tr>)}</tbody></table>{!shown.length && <p className="admin-empty">No papers match this search.</p>}</div>
    </section>
  </div>;
}

function TeamPanel({ users, currentId, isSuperAdmin, onSave }: { users: AdminUser[]; currentId: string; isSuperAdmin: boolean; onSave: (body: unknown, method: string) => Promise<string> }) {
  const [editing, setEditing] = useState<AdminUser | null>(null); const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [role, setRole] = useState<"admin" | "data_entry" | "reviewer" | "publisher" | "super_admin">("data_entry"); const [status, setStatus] = useState<"active" | "inactive">("active");
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  function reset() { setEditing(null); setName(""); setEmail(""); setPassword(""); setRole("data_entry"); setStatus("active"); }
  function choose(user: AdminUser) { setEditing(user); setName(user.name); setEmail(user.email); setPassword(""); setRole(user.role); setStatus(user.status); }
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setNotice(""); const result = await onSave({ id: editing?.id, name, email, password, role, status }, editing ? "PATCH" : "POST"); setBusy(false); setNotice(result); if (result) reset(); }
  return <div className="admin-management-grid">
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">ACCESS CONTROL</span><h3>{editing ? "Edit team account" : "Invite a team member"}</h3></div></div>
      <p className="admin-helper">Data Entry creates MCQs and edits own drafts. Reviewers decide submitted MCQs. Publishers manage papers and publish approved content. Admins manage workspace operations; Super Admins also manage super admins and system settings.</p>
      <form className="admin-form" onSubmit={submit}>
        <label htmlFor="team-name">Full name</label><input id="team-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={140} required />
        <label htmlFor="team-email">Email</label><input id="team-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={190} required />
        <label htmlFor="team-password">{editing ? "New password (leave blank to keep current)" : "Temporary password"}</label><input id="team-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={200} autoComplete="new-password" required={!editing} />
        <label htmlFor="team-role">Role</label><select id="team-role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="editor">MCQ Contributor · add and edit MCQs only</option><option value="reviewer">Category & MCQ Manager · manage MCQs and categories</option>{isSuperAdmin && <option value="admin">Paper Manager · manage MCQs, categories, and papers</option>}</select>
        {editing && <><label htmlFor="team-status">Account status</label><select id="team-status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">Active</option><option value="inactive">Inactive</option></select></>}
        <SuccessMessage>{notice}</SuccessMessage><div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save account" : "Create account"}</button>{editing && <button className="button button-light" type="button" onClick={reset}>Cancel edit</button>}</div>
        <p className="form-hint">Passwords need at least 12 characters and are stored as salted scrypt hashes. Never send passwords over chat.</p>
      </form>
    </section>
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">TEAM DIRECTORY</span><h3>{users.length} accounts</h3></div></div><p className="admin-helper">Your own account cannot be disabled or assigned a different role.</p>
      <div className="admin-record-list">{users.map((user) => <article className="admin-record" key={user.id}><div><div className="admin-record-title"><strong>{user.name}</strong><StatusBadge status={user.status} /></div><small>{user.email} · {roleLabels[user.role]}{user.id === currentId ? " · you" : ""}</small><small>Last login: {user.last_login_at ? new Date(user.last_login_at).toLocaleString() : "Never"}</small></div><button type="button" className="button button-light" disabled={user.id === currentId} onClick={() => choose(user)}>Edit</button></article>)}{!users.length && <p className="admin-empty">No team accounts yet.</p>}</div>
    </section>
  </div>;
}
