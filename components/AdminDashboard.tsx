"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminSignOutButton } from "@/components/AdminSignOutButton";
import { AdminQuestionWorkspace } from "@/components/AdminQuestionWorkspace";
import { AdminExams } from "@/components/AdminExams";
import { AdminActivityLogs } from "@/components/AdminActivityLogs";
import { useConfirmModal } from "@/components/ConfirmModal";
import { Activity, Archive, Building2, Clock3, Download, FileText, FolderOpen, KeyRound, LayoutDashboard, ListChecks, Pencil, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Users } from "lucide-react";
import type { AdminCapabilities, AdminPrincipal, AdminRole } from "@/lib/admin-auth";
import { ROLE_PERMISSIONS, type AdminPermission } from "@/lib/admin-role-permissions";
import { ApiResponseError, ConfirmationCancelledError, getErrorMessage, isConfirmationCancelled, parseApiResponse } from "@/lib/error-message";
import { notify } from "@/lib/toast";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LocalizedText } from "@/components/LocalizedText";

type Status = "draft" | "in_review" | "approved" | "published" | "rejected" | "archived";
type SubjectRow = { id: number; name: string; slug: string; description: string; status: Status; topic_count: number };
type TopicRow = { id: number; subject_id: number; subject_name: string; name: string; slug: string; description: string; status: Status; question_count: number };
type AdminQuestion = { id: number; createdBy?: number | string; topicId: number; topicName: string; subjectName: string; prompt: string; explanation: string; sourceNote: string; correctChoice: string; difficulty: "easy" | "medium" | "hard"; status: Status; reviewNote?: string | null; paperIds: number[]; choices: Array<{ label: string; text: string }> };
type AdminPaper = { id: number; examId: number; examName: string; title: string; slug: string; year: number; type: "Past paper" | "Model paper" | "Mock test"; description: string; shiftSession?: string | null; expectedQuestionCount?: number | null; status: Status; questionCount: number; publishedQuestionCount: number; questionIds: number[] };
type PickerQuestion = { id: number; topicId: number; topicName: string; subjectId: number; subjectName: string; prompt: string; sourceNote: string; status: Status; difficulty: "easy" | "medium" | "hard" };
type AdminUser = { id: string; name: string; email: string; role: AdminRole; status: "active" | "inactive"; last_login_at?: string | null; permissionOverrides?: Record<string, boolean> };
type ExamRow = { id: number; name: string; slug: string };
type DashboardStats = { statuses: Record<string, number>; myStatuses: Record<string, number>; categories: Array<{ subject_name: string; topic_name: string; question_count: number }>; emptyCategories: Array<{ subject_name: string; topic_name: string; question_count: number }>; shortPapers: Array<{ id: number; title: string; expected_question_count: number; question_count: number }> };
type AdminApiData = { subjects?: SubjectRow[]; topics?: TopicRow[]; questions?: AdminQuestion[]; papers?: AdminPaper[]; exams?: ExamRow[]; users?: AdminUser[]; statuses?: Record<string, number>; categories?: DashboardStats["categories"]; emptyCategories?: DashboardStats["emptyCategories"]; shortPapers?: DashboardStats["shortPapers"]; [key: string]: unknown };
type Tab = "overview" | "questions" | "review" | "categories" | "exams" | "papers" | "team" | "activity";

const tabLabels: Record<Tab, string> = { overview: "Overview", questions: "MCQ bank", review: "Review queue", categories: "Categories", exams: "Exams", papers: "Past papers", team: "Team & roles", activity: "Activity logs" };
const roleLabels: Record<AdminRole, string> = { data_entry: "Data Entry", reviewer: "Reviewer", publisher: "Publisher", admin: "Admin", super_admin: "Super Admin" };

function NavIcon({ tab }: { tab: Tab }) {
  const icons = { overview: LayoutDashboard, questions: ListChecks, review: Clock3, categories: FolderOpen, exams: Building2, papers: FileText, activity: Activity, team: Users };
  const Icon = icons[tab];
  return <Icon size={18} strokeWidth={1.8} aria-hidden="true" />;
}

async function sendAdmin<T = AdminApiData>(path: string, method = "GET", body?: unknown, confirm?: ReturnType<typeof useConfirmModal>): Promise<T> {
  const send = (payload?: unknown) => fetch(path, {
    method,
    cache: "no-store",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  let response = await send(body);
  const result: unknown = await response.json().catch(() => null);
  const data = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
  if (!response.ok && Array.isArray(data.affectedPapers) && body && typeof body === "object" && !("confirmPaperRemoval" in body) && confirm) {
    const names = (data.affectedPapers as Array<{ title?: string }>).map((paper) => paper.title).filter(Boolean).join("\n• ");
    let confirmedResult: unknown;
    const accepted = await confirm({
      title: "Remove MCQ from published papers?",
      message: `${getErrorMessage(data, "This change affects published papers.")}\n\nAffected papers:\n• ${names}`,
      confirmLabel: "Remove and continue",
      variant: "danger",
    }, async () => {
      response = await send({ ...(body as Record<string, unknown>), confirmPaperRemoval: true });
      confirmedResult = await parseApiResponse(response, "The request could not be completed.");
    });
    if (!accepted) throw new ConfirmationCancelledError();
    return confirmedResult as T;
  }
  if (!response.ok) throw new ApiResponseError(response.status, result, "The request could not be completed.");
  if (result === null) throw new Error("The server returned an unreadable response. Please try again.");
  return result as T;
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
  const confirm = useConfirmModal();
  const [tab, setTab] = useState<Tab>("overview");
  const [questionStatusFilter, setQuestionStatusFilter] = useState("all");
  const [paperQuickFilter, setPaperQuickFilter] = useState("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [entryPaperId, setEntryPaperId] = useState<number | null>(null);
  const [paperComposeToken, setPaperComposeToken] = useState(0);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [papers, setPapers] = useState<AdminPaper[]>([]);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({ statuses: {}, myStatuses: {}, categories: [], emptyCategories: [], shortPapers: [] });
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadData = useCallback(async () => {
    const [categoryResult, questionResult, paperResult, examResult, statsResult, userResult] = await Promise.allSettled([
      sendAdmin("/api/admin/categories"), sendAdmin("/api/admin/questions"), sendAdmin("/api/admin/papers"),
      capabilities.managePapers ? sendAdmin("/api/admin/exams") : Promise.resolve({ exams: [] }),
      sendAdmin<DashboardStats>("/api/admin/dashboard"),
      capabilities.manageUsers ? sendAdmin("/api/admin/users") : Promise.resolve({ users: [] }),
    ]);
    const failures: string[] = [];
    if (categoryResult.status === "fulfilled") {
      setSubjects(categoryResult.value.subjects ?? []);
      setTopics(categoryResult.value.topics ?? []);
    } else failures.push(getErrorMessage(categoryResult.reason, "Could not load categories."));
    if (questionResult.status === "fulfilled") setQuestions(questionResult.value.questions ?? []);
    else failures.push(getErrorMessage(questionResult.reason, "Could not load questions."));
    if (paperResult.status === "fulfilled") setPapers(paperResult.value.papers ?? []);
    else failures.push(getErrorMessage(paperResult.reason, "Could not load past papers."));
    if (examResult.status === "fulfilled") setExams(examResult.value.exams ?? []);
    else failures.push(getErrorMessage(examResult.reason, "Could not load exams."));
    if (statsResult.status === "fulfilled") setDashboardStats(statsResult.value);
    else failures.push(getErrorMessage(statsResult.reason, "Could not load dashboard statistics."));
    if (userResult.status === "fulfilled") setUsers(userResult.value.users ?? []);
    else failures.push(getErrorMessage(userResult.reason, "Could not load team accounts."));
    const failure = [...new Set(failures)].join("\n");
    setLoadError(failure);
    if (failure) notify.error(failure);
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
    ...(principal.role === "super_admin" ? ["activity" as const] : []),
  ], [capabilities.manageCategories, capabilities.managePapers, capabilities.manageUsers, capabilities.reviewMcqs, principal.role]);

  function selectTab(next: Tab, status = "all") {
    setQuestionStatusFilter(status);
    if (next === "papers") setPaperQuickFilter(status);
    setTab(next);
  }

  async function perform(action: () => Promise<unknown>, success: string) {
    setLoadError("");
    try {
      await action();
      await refresh();
      router.refresh();
      return success;
    } catch (error) {
      if (isConfirmationCancelled(error)) return "";
      const message = getErrorMessage(error);
      setLoadError(message);
      notify.error(message);
      return "";
    }
  }

  async function downloadExport(path: string) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new ApiResponseError(response.status, body, "Could not download this export.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const fileName = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)?.slice(1).find(Boolean);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName ? decodeURIComponent(fileName) : "mcqpath-export";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (cause) {
      notify.error(getErrorMessage(cause, "Could not download this export."));
    }
  }

  return (
    <div className={`admin-dashboard ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <aside className="admin-sidebar">
        <div className="admin-sidebar-head">
          <a className="admin-brand" href="/admin" aria-label="MCQPath admin home"><span className="admin-brand-mark">M</span><span><strong>MCQPath</strong><small>ADMIN WORKSPACE</small></span></a>
          <button type="button" className="admin-sidebar-collapse" aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}</button>
        </div>
        <nav aria-label="Admin sections">
          <div className="admin-sidebar-group"><div className="admin-sidebar-label">CONTENT</div>{allowedTabs.filter((item) => ["overview", "questions", "review", "categories"].includes(item)).map((item) => <button type="button" key={item} className={tab === item ? "active" : ""} aria-current={tab === item ? "page" : undefined} onClick={() => selectTab(item)} title={tabLabels[item]}><span className="admin-nav-icon"><NavIcon tab={item} /></span><span>{tabLabels[item]}</span>{item === "review" && <span className="admin-nav-count" title={`${dashboardStats.statuses.in_review ?? 0} questions waiting for review`} aria-label={`${dashboardStats.statuses.in_review ?? 0} questions waiting for review`}>{dashboardStats.statuses.in_review ?? 0}</span>}</button>)}</div>
          {allowedTabs.some((item) => ["exams", "papers"].includes(item)) && <div className="admin-sidebar-group"><div className="admin-sidebar-label">PAPERS</div>{allowedTabs.filter((item) => ["exams", "papers"].includes(item)).map((item) => <button type="button" key={item} className={tab === item ? "active" : ""} aria-current={tab === item ? "page" : undefined} onClick={() => selectTab(item)} title={tabLabels[item]}><span className="admin-nav-icon"><NavIcon tab={item} /></span><span>{tabLabels[item]}</span></button>)}</div>}
          {allowedTabs.some((item) => ["team", "activity"].includes(item)) && <div className="admin-sidebar-group"><div className="admin-sidebar-label">ADMIN</div>{allowedTabs.filter((item) => ["team", "activity"].includes(item)).map((item) => <button type="button" key={item} className={tab === item ? "active" : ""} aria-current={tab === item ? "page" : undefined} onClick={() => selectTab(item)} title={tabLabels[item]}><span className="admin-nav-icon"><NavIcon tab={item} /></span><span>{tabLabels[item]}</span></button>)}</div>}
        </nav>
        <div className="admin-sidebar-spacer" />
        <div className="admin-user-chip"><span className="admin-avatar">{principal.name.slice(0, 1).toUpperCase()}</span><span><strong>{principal.name}</strong><small>{roleLabels[principal.role]}</small></span></div>
        <div className="admin-sidebar-foot"><AdminSignOutButton /></div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-workspace-heading">
          <form className="admin-global-search" onSubmit={(event) => { event.preventDefault(); setTab("questions"); }} role="search"><Search size={17} aria-hidden="true" /><input aria-label="Search MCQs" value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Search MCQs" /><kbd>↵</kbd></form>
          <div className="admin-topbar-actions"><ThemeToggle /><span className="admin-topbar-user"><span className="admin-avatar">{principal.name.slice(0, 1).toUpperCase()}</span><span className="admin-topbar-meta"><strong>{principal.name}</strong><small>{roleLabels[principal.role]}</small></span></span><a className="button button-light" href="/admin/password"><KeyRound size={15} aria-hidden="true" /><span>Password</span></a><button className="button button-light admin-refresh" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} aria-hidden="true" /><span>{loading ? "Refreshing…" : "Refresh"}</span></button></div>
        </header>
        <main className="admin-content-area">
          <div className="admin-section-intro"><div><p className="admin-kicker">Workspace</p><h1>{tabLabels[tab]}</h1><p>{tab === "overview" ? "See what needs attention, then jump into categories, papers, or the MCQ bank." : tab === "questions" ? "Set the category once, then add questions one by one or from a paste." : tab === "review" ? "Review submitted questions and record a decision." : tab === "categories" ? "Subjects hold topics. Every MCQ belongs to one topic." : tab === "exams" ? "Keep exam bodies consistent before you build papers." : tab === "papers" ? "Create a paper, then add MCQs from the bank and set their order." : tab === "team" ? "Manage staff access and content permissions." : "Review staff sign-ins and content changes."}</p></div>{(tab === "overview" || tab === "questions") && capabilities.createMcqs && <button type="button" className="button button-primary" onClick={() => { setGlobalSearch(""); setTab("questions"); }}><Plus size={16} />Add MCQs</button>}{tab === "papers" && capabilities.managePapers && <button type="button" className="button button-primary" onClick={() => { setTab("papers"); setPaperComposeToken((current) => current + 1); }}><Plus size={16} />Create paper</button>}</div>
          <ErrorMessage>{loadError}</ErrorMessage>
          {loading && !subjects.length && !questions.length && !papers.length ? <div className="loading-panel">Loading admin records…</div> : null}
          {tab === "overview" && <OverviewPanel role={principal.role} subjects={subjects} topics={topics} questions={questions} papers={papers} users={users} metrics={dashboardStats} canManageCategories={capabilities.manageCategories} canManagePapers={capabilities.managePapers} canManageUsers={capabilities.manageUsers} canCreateMcqs={capabilities.createMcqs} canReviewMcqs={capabilities.reviewMcqs} onSelect={selectTab} />}
          {tab === "categories" && capabilities.manageCategories && <CategoriesPanel subjects={subjects} topics={topics} canEdit={capabilities.manageCategories} canPublish={capabilities.publishContent} canDelete={capabilities.deleteContent} onExport={downloadExport} onSave={(body, method) => perform(() => sendAdmin("/api/admin/categories", method, body, confirm), "Category saved.")} onStatus={(kind, id, status) => perform(() => sendAdmin("/api/admin/categories", "PATCH", { kind, id, status }, confirm), `Category ${status}.`)} />}
          {(tab === "questions" || tab === "review") && <QuestionsPanel key={tab} topics={topics} papers={papers} canManagePapers={capabilities.managePapers} canAddQuestionsToPapers={capabilities.addQuestionsToPapers} canQuickCreatePaper={capabilities.quickCreatePapers} canPublish={capabilities.publishContent} canDirectPublish={principal.role === "super_admin"} canDelete={capabilities.deleteContent} canCreateMcqs={capabilities.createMcqs} canReviewMcqs={capabilities.reviewMcqs} canEditOwnMcqs={capabilities.editOwnMcqs} canEditAnyMcqs={capabilities.editAnyMcqs} currentUserId={principal.id} initialPaperId={entryPaperId} initialSearch={tab === "questions" ? globalSearch : ""} initialStatus={tab === "review" ? "in_review" : questionStatusFilter} startInBank={tab === "review" || Boolean(globalSearch) || questionStatusFilter !== "all"} onUpdated={refresh} />}
          {tab === "exams" && capabilities.managePapers && <AdminExams exams={exams} onSave={(body, method) => perform(() => sendAdmin("/api/admin/exams", method, body, confirm), "Exam saved.")} />}
          {tab === "papers" && capabilities.managePapers && <PapersPanel papers={papers} exams={exams} subjects={subjects} topics={topics} composeToken={paperComposeToken} quickFilter={paperQuickFilter} onQuickFilter={setPaperQuickFilter} canEdit={capabilities.managePapers} canPublish={capabilities.publishContent} canDelete={capabilities.managePapers} onExport={downloadExport} onSave={(body, method) => perform(() => sendAdmin("/api/admin/papers", method, body, confirm), "Paper saved.")} onStatus={(id, status) => perform(() => sendAdmin("/api/admin/papers", "PATCH", { id, status }, confirm), `Paper ${status}.`)} onReorder={(paperId, questionIds) => perform(() => sendAdmin("/api/admin/papers/reorder", "POST", { paperId, questionIds }, confirm), "Question order saved.")} onAddMcqs={(paperId) => { setEntryPaperId(paperId); setTab("questions"); }} />}
          {tab === "team" && capabilities.manageUsers && <TeamPanel users={users} currentId={principal.id} isSuperAdmin={principal.role === "super_admin"} onSave={(body, method) => perform(() => sendAdmin("/api/admin/users", method, body, confirm), "User account saved.")} />}
          {tab === "activity" && principal.role === "super_admin" && <AdminActivityLogs />}
        </main>
        <footer className="admin-workspace-footer"><span>MCQPath Admin</span><span>Content operations workspace · {new Date().getFullYear()}</span></footer>
      </div>
    </div>
  );
}

function OverviewPanel({ role, subjects, topics, questions, papers, users, metrics, canManageCategories, canManagePapers, canManageUsers, canCreateMcqs, canReviewMcqs, onSelect }: { role: AdminRole; subjects: SubjectRow[]; topics: TopicRow[]; questions: AdminQuestion[]; papers: AdminPaper[]; users: AdminUser[]; metrics: DashboardStats; canManageCategories: boolean; canManagePapers: boolean; canManageUsers: boolean; canCreateMcqs: boolean; canReviewMcqs: boolean; onSelect: (tab: Tab, status?: string) => void }) {
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
  const globalStats = [
    { title: "Total MCQs", value: total, hint: "Across active categories", tone: "neutral", target: "questions" as Tab },
    { title: "Drafts", value: drafts, hint: "Need completion", tone: "neutral", target: "questions" as Tab },
    { title: "In review", value: waiting, hint: "Waiting for review", tone: "warning", target: canReviewMcqs ? "review" as Tab : "questions" as Tab },
    { title: "Published", value: published, hint: "Live to learners", tone: "success", target: "questions" as Tab },
  ];
  const roleStats = role === "data_entry" ? [
    { title: "Your drafts", value: Number(metrics.myStatuses.draft ?? 0), hint: "Continue your own work", tone: "neutral", target: "questions" as Tab, status: "draft" },
    { title: "Rejected", value: Number(metrics.myStatuses.rejected ?? 0), hint: "Read reviewer comments", tone: "warning", target: "questions" as Tab, status: "rejected" },
    { title: "In review", value: Number(metrics.myStatuses.in_review ?? 0), hint: "Waiting for a decision", tone: "blue", target: "questions" as Tab, status: "in_review" },
  ] : role === "reviewer" ? [
    { title: "Review queue", value: waiting, hint: "Oldest submission first", tone: "warning", target: "review" as Tab, status: "in_review" },
    { title: "Approved", value: approved, hint: "Sent to publishing", tone: "success", target: "questions" as Tab, status: "approved" },
    { title: "Rejected", value: rejected, hint: "Decision recorded", tone: "neutral", target: "questions" as Tab, status: "rejected" },
  ] : role === "publisher" ? [
    { title: "Ready to publish", value: approved, hint: "Approved MCQs", tone: "success", target: "questions" as Tab, status: "approved" },
    { title: "Published MCQs", value: published, hint: "Visible to learners", tone: "neutral", target: "questions" as Tab, status: "published" },
    { title: "Published papers", value: papers.filter((paper) => paper.status === "published").length, hint: "Paper library", tone: "blue", target: "papers" as Tab, status: "published" },
    { title: "Papers needing questions", value: metrics.shortPapers.length, hint: "Check readiness", tone: "warning", target: "papers" as Tab, status: "needs_questions" },
  ] : globalStats;
  const isEntry = role === "data_entry";
  return <div className="admin-content-stack">
    <div className={`admin-metric-grid admin-metric-grid-role-${role}`}>{roleStats.map((item) => <button type="button" className="admin-metric-card" key={item.title} onClick={() => onSelect(item.target, "status" in item ? item.status : item.title === "Drafts" ? "draft" : item.title === "In review" ? "in_review" : item.title === "Published" ? "published" : "all")}><span>{item.title}</span><strong>{item.value.toLocaleString()}</strong><small className={`metric-pill metric-pill-${item.tone}`}>{item.hint}</small><span className="admin-card-open">Open filtered list →</span></button>)}</div>
    {isEntry ? <section className="admin-panel role-queue-panel"><div className="admin-panel-heading"><div><span className="eyebrow">YOUR QUESTIONS</span><h3>Drafts and reviewer feedback</h3></div><button type="button" className="text-link" onClick={() => onSelect("questions", "rejected")}>View rejected items</button></div>{questions.filter((question) => question.status === "rejected").slice(0, 5).map((question) => <article className="role-review-row" key={question.id}><strong>#{question.id} · <LocalizedText>{question.prompt}</LocalizedText></strong><small>{question.topicName} · {question.sourceNote}</small><p>{question.reviewNote || "No comment was provided. Open this MCQ and revise it."}</p><button type="button" className="text-link" onClick={() => onSelect("questions", "rejected")}>Open rejected list</button></article>)}{!questions.some((question) => question.status === "rejected") && <div className="admin-empty-state"><strong>No rejected MCQs</strong><span>Reviewer comments will appear here if an item needs changes.</span><button type="button" className="button button-light" onClick={() => onSelect("questions", "draft")}>Continue drafts</button></div>}</section> : <div className="overview-insight-grid">
      {canManageCategories && <section className="admin-panel overview-category-panel"><div className="admin-panel-heading"><h3>MCQs by category</h3><button type="button" className="text-link" onClick={() => onSelect("categories")}>View categories</button></div>{bySubject.map((row) => <div className="overview-category-row" key={row.name}><span>{row.name}</span><span className="overview-category-track"><i style={{ width: `${Math.max(2, row.count / maxCount * 100)}%` }} /></span><strong>{row.count.toLocaleString()}</strong></div>)}{!bySubject.length && <p className="admin-empty">Category totals will appear when MCQs are available.</p>}<p className="overview-subtle-note">{metrics.emptyCategories.length} topics have no MCQs yet.</p></section>}
      <section className="admin-panel overview-queue-panel"><div className="admin-panel-heading"><h3>Your queue</h3><span className="overview-queue-total">{(waiting + rejected + approved).toLocaleString()}</span></div><button type="button" onClick={() => onSelect(canReviewMcqs ? "review" : "questions")}><span>Waiting for review</span><b className="queue-pill queue-pill-warning">{waiting}</b></button><button type="button" onClick={() => onSelect("questions")}><span>Rejected with comments</span><b className="queue-pill queue-pill-danger">{rejected}</b></button><button type="button" onClick={() => onSelect("questions")}><span>Approved, ready to publish</span><b className="queue-pill queue-pill-blue">{approved}</b></button></section>
    </div>}
    {canManagePapers && <section className="admin-panel overview-papers-panel"><div className="admin-panel-heading"><h3>Papers needing attention</h3><button type="button" className="text-link" onClick={() => onSelect("papers")}>View all papers</button></div>{metrics.shortPapers.length ? <div className="admin-table-wrap"><table className="admin-data-table"><thead><tr><th>Paper</th><th>Exam</th><th>Questions</th><th>Status</th></tr></thead><tbody>{metrics.shortPapers.slice(0, 5).map((item) => { const paper = papers.find((value) => value.id === item.id); const missing = item.expected_question_count - item.question_count; return <tr key={item.id}><td><strong>{item.title}</strong></td><td>{paper?.examName ?? "—"}</td><td>{item.question_count} / {item.expected_question_count}</td><td><span className="queue-pill queue-pill-warning">{missing} missing</span></td></tr>; })}</tbody></table></div> : <p className="admin-empty">No papers are below their expected question count.</p>}</section>}
    {canCreateMcqs && <section className="admin-panel overview-my-work"><div><span className="eyebrow">MY WORK</span><h3>Keep the question bank moving</h3><p>{drafts} drafts need completion. {waiting} MCQs are currently in review.</p></div><button type="button" className="button button-primary" onClick={() => onSelect("questions")}>Add MCQs</button></section>}
    {canManageUsers && <section className="admin-panel overview-team-note"><div className="admin-panel-heading"><h3>Team access</h3><button type="button" className="text-link" onClick={() => onSelect("team")}>Manage team</button></div><p>{users.filter((user) => user.status === "active").length} active staff accounts. Role permissions control which tools are available to each account.</p></section>}
    {!subjects.length && !topics.length && !questions.length && <p className="admin-empty">Your admin workspace is ready. Add a category to get started.</p>}
  </div>;
}

function CategoriesPanel({ subjects, topics, canEdit, canPublish, canDelete, onExport, onSave, onStatus }: { subjects: SubjectRow[]; topics: TopicRow[]; canEdit: boolean; canPublish: boolean; canDelete: boolean; onExport: (path: string) => Promise<void>; onSave: (body: unknown, method: string) => Promise<string>; onStatus: (kind: string, id: number, status: string) => Promise<string> }) {
  const [kind, setKind] = useState<"subject" | "topic">("subject");
  const [edit, setEdit] = useState<SubjectRow | TopicRow | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

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

  const needle = query.trim().toLowerCase();
  const subjectMatches = (subject: SubjectRow) => `${subject.name} ${subject.slug} ${subject.description}`.toLowerCase().includes(needle);
  const topicMatches = (topic: TopicRow) => `${topic.name} ${topic.slug} ${topic.subject_name}`.toLowerCase().includes(needle);
  const visibleSubjects = subjects.filter((subject) => !needle || subjectMatches(subject) || topics.some((topic) => topic.subject_id === subject.id && topicMatches(topic)));
  const knownSubjects = new Set(subjects.map((subject) => subject.id));
  const orphanTopics = topics.filter((topic) => !knownSubjects.has(topic.subject_id) && (!needle || topicMatches(topic)));

  return <div className="admin-management-grid">
    {canEdit && <section className="admin-panel admin-form-card"><div className="admin-panel-heading"><div><span className="eyebrow">CONTENT STRUCTURE</span><h3>{edit ? `Edit ${kind}` : kind === "subject" ? "Add a subject" : "Add a topic"}</h3><p>{kind === "subject" ? "Subjects are the top-level categories learners browse." : "Topics sit inside a subject and hold the MCQs."}</p></div></div>
      <form id="admin-category-form" className="admin-form" onSubmit={submit}>
        <div className="admin-segment" role="group" aria-label="Category type">
          <button type="button" className={kind === "subject" ? "active" : ""} aria-pressed={kind === "subject"} onClick={() => { setKind("subject"); setEdit(null); }}>Subject</button>
          <button type="button" className={kind === "topic" ? "active" : ""} aria-pressed={kind === "topic"} onClick={() => { setKind("topic"); setEdit(null); }}>Topic</button>
        </div>
        {kind === "topic" && <><label htmlFor="category-subject">Parent subject</label><select id="category-subject" name="subjectId" required defaultValue=""><option value="" disabled>Select a subject</option>{subjects.filter((subject) => subject.status !== "archived").map((subject) => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select></>}
        <label htmlFor="category-name">Name</label><input id="category-name" name="name" minLength={2} maxLength={160} required placeholder={kind === "subject" ? "e.g. General Knowledge" : "e.g. Everyday Science"} />
        <label htmlFor="category-slug">URL slug</label><input id="category-slug" name="slug" placeholder="Generated from the name if left blank" />
        <label htmlFor="category-description">Description</label><textarea id="category-description" name="description" rows={3} maxLength={3000} placeholder="Short description for learners and search engines" />
        <label htmlFor="category-status">Publishing status</label><select id="category-status" name="status" defaultValue="draft"><option value="draft">Draft</option>{canPublish && <option value="published">Published</option>}</select>
        <SuccessMessage>{notice}</SuccessMessage>
        <div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy || (kind === "topic" && !subjects.length)}>{busy ? "Saving…" : edit ? "Save changes" : kind === "subject" ? "Create subject" : "Create topic"}</button>{edit && <button className="button button-light" type="button" onClick={() => setEdit(null)}>Cancel edit</button>}</div>
        {kind === "topic" && !subjects.length && <p className="form-hint">Create a subject before adding topics.</p>}
      </form>
    </section>}
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">SUBJECTS & TOPICS</span><h3>{subjects.length} subjects · {topics.length} topics</h3></div></div>
      <input className="admin-filter" aria-label="Search categories" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subjects or topics" />
      <div className="admin-table-wrap admin-management-table-wrap"><table className="table table-hover align-middle admin-data-table admin-management-table"><thead><tr><th>Category</th><th>Parent / URL</th><th>MCQs / Topics</th><th>Status</th><th className="admin-actions-column">Actions</th></tr></thead><tbody>
        {visibleSubjects.map((subject) => {
          const showAllTopics = !needle || subjectMatches(subject);
          const subjectTopics = topics.filter((topic) => topic.subject_id === subject.id && (showAllTopics || topicMatches(topic)));
          return <Fragment key={subject.id}><tr className="admin-table-group-row"><td><strong>{subject.name}</strong><small className="admin-table-secondary">Subject · /{subject.slug}</small></td><td>—</td><td>{subject.topic_count} topics</td><td><StatusBadge status={subject.status} /></td><td><div className="admin-table-actions"><button type="button" className="button button-light" title="Export subject CSV" aria-label={`Export ${subject.name} CSV`} onClick={() => void onExport(`/api/admin/export?kind=category&categoryType=subject&id=${subject.id}&format=csv`)}><Download size={15} /><span>CSV</span></button><button type="button" className="button button-light" onClick={() => void onExport(`/api/admin/export?kind=category&categoryType=subject&id=${subject.id}&format=pdf`)} title="Export subject PDF"><Download size={15} /><span>PDF</span></button>{canEdit && (subject.status !== "published" || canPublish) && <button type="button" className="button button-light" onClick={() => chooseEdit(subject, "subject")}><Pencil size={14} /><span>Edit</span></button>}{canPublish && subject.status !== "published" && <button type="button" className="button button-primary" onClick={() => void onStatus("subject", subject.id, "published")}>Publish</button>}{canDelete && subject.status !== "archived" && <button type="button" className="button button-light" onClick={() => void onStatus("subject", subject.id, "archived")}><Archive size={14} /><span>Archive</span></button>}</div></td></tr>
            {subjectTopics.map((topic) => <tr key={topic.id}><td><strong className="admin-table-indented">{topic.name}</strong>{topic.description && <small className="admin-table-secondary admin-table-description">{topic.description}</small>}</td><td>{subject.name}<small className="admin-table-secondary">/{topic.slug}</small></td><td>{topic.question_count.toLocaleString()}</td><td><StatusBadge status={topic.status} /></td><td><div className="admin-table-actions"><button type="button" className="button button-light" onClick={() => void onExport(`/api/admin/export?kind=category&id=${topic.id}&format=csv`)} title="Export topic CSV"><Download size={15} /><span>CSV</span></button><button type="button" className="button button-light" onClick={() => void onExport(`/api/admin/export?kind=category&id=${topic.id}&format=pdf`)} title="Export topic PDF"><Download size={15} /><span>PDF</span></button>{canEdit && (topic.status !== "published" || canPublish) && <button type="button" className="button button-light" onClick={() => chooseEdit(topic, "topic")}><Pencil size={14} /><span>Edit</span></button>}{canPublish && topic.status !== "published" && <button type="button" className="button button-primary" onClick={() => void onStatus("topic", topic.id, "published")}>Publish</button>}{canDelete && topic.status !== "archived" && <button type="button" className="button button-light" onClick={() => void onStatus("topic", topic.id, "archived")}><Archive size={14} /><span>Archive</span></button>}</div></td></tr>)}
            {!subjectTopics.length && <tr><td colSpan={5} className="admin-table-empty">No topics match this subject and search.</td></tr>}
          </Fragment>;
        })}
        {orphanTopics.map((topic) => <tr key={`orphan-${topic.id}`}><td><strong>{topic.name}</strong></td><td>{topic.subject_name}<small className="admin-table-secondary">/{topic.slug}</small></td><td>{topic.question_count.toLocaleString()}</td><td><StatusBadge status={topic.status} /></td><td>—</td></tr>)}
        {!visibleSubjects.length && !orphanTopics.length && <tr><td colSpan={5} className="admin-table-empty">{subjects.length ? "No categories match this search." : "No categories yet. Add your first subject."}</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}

function QuestionsPanel({ topics, papers, canManagePapers, canAddQuestionsToPapers, canQuickCreatePaper, canPublish, canDirectPublish, canDelete, canCreateMcqs, canReviewMcqs, canEditOwnMcqs, canEditAnyMcqs, currentUserId, initialPaperId, initialSearch, initialStatus, startInBank, onUpdated }: { topics: TopicRow[]; papers: AdminPaper[]; canManagePapers: boolean; canAddQuestionsToPapers: boolean; canQuickCreatePaper: boolean; canPublish: boolean; canDirectPublish: boolean; canDelete: boolean; canCreateMcqs: boolean; canReviewMcqs: boolean; canEditOwnMcqs: boolean; canEditAnyMcqs: boolean; currentUserId: string; initialPaperId: number | null; initialSearch: string; initialStatus: string; startInBank: boolean; onUpdated: () => Promise<void> }) {
  return <AdminQuestionWorkspace topics={topics} papers={papers} canManagePapers={canManagePapers} canAddQuestionsToPapers={canAddQuestionsToPapers} canQuickCreatePaper={canQuickCreatePaper} canPublish={canPublish} canDirectPublish={canDirectPublish} canDelete={canDelete} canCreateMcqs={canCreateMcqs} canReviewMcqs={canReviewMcqs} canEditOwnMcqs={canEditOwnMcqs} canEditAnyMcqs={canEditAnyMcqs} currentUserId={currentUserId} initialPaperId={initialPaperId} initialSearch={initialSearch} initialStatus={initialStatus} startInBank={startInBank} onUpdated={onUpdated} />;
}

function PapersPanel({ papers, exams, subjects, topics, composeToken, quickFilter, onQuickFilter, canEdit, canPublish, canDelete, onExport, onSave, onStatus, onReorder, onAddMcqs }: { papers: AdminPaper[]; exams: ExamRow[]; subjects: SubjectRow[]; topics: TopicRow[]; composeToken: number; quickFilter: string; onQuickFilter: (filter: string) => void; canEdit: boolean; canPublish: boolean; canDelete: boolean; onExport: (path: string) => Promise<void>; onSave: (body: unknown, method: string) => Promise<string>; onStatus: (id: number, status: string) => Promise<string>; onReorder: (paperId: number, questionIds: number[]) => Promise<string>; onAddMcqs: (paperId: number) => void }) {
  const [editing, setEditing] = useState<AdminPaper | null>(null);
  const [examName, setExamName] = useState(""); const [title, setTitle] = useState(""); const [slug, setSlug] = useState(""); const [year, setYear] = useState(String(new Date().getFullYear()));
  const [description, setDescription] = useState(""); const [status, setStatus] = useState<"draft" | "published">("draft");
  const [paperType, setPaperType] = useState<AdminPaper["type"]>("Past paper"); const [shiftSession, setShiftSession] = useState(""); const [expectedQuestionCount, setExpectedQuestionCount] = useState("");
  const [selectedQuestions, setSelectedQuestions] = useState<PickerQuestion[]>([]);
  const [search, setSearch] = useState(""); const [subjectId, setSubjectId] = useState(""); const [topicId, setTopicId] = useState(""); const [questionStatus, setQuestionStatus] = useState("active");
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(25); const [results, setResults] = useState<PickerQuestion[]>([]); const [total, setTotal] = useState(0);
  const [pickerLoading, setPickerLoading] = useState(true); const [pickerError, setPickerError] = useState(""); const [filter, setFilter] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const questionIds = selectedQuestions.map((question) => question.id);
  const hasUnpublishedQuestions = selectedQuestions.some((question) => question.status !== "published");
  const selectedIdSet = new Set(questionIds);
  const shown = papers.filter((paper) => (quickFilter === "published" ? paper.status === "published" : quickFilter === "needs_questions" ? Boolean(paper.expectedQuestionCount && paper.questionCount < paper.expectedQuestionCount) : true) && `${paper.title} ${paper.examName} ${paper.year} ${paper.status}`.toLowerCase().includes(filter.toLowerCase()));
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
        const data = await parseApiResponse<{ questions?: PickerQuestion[]; total?: number }>(response, "Could not search the MCQ bank.");
        setResults(data.questions ?? []); setTotal(Number(data.total ?? 0));
      } catch (error) {
        if (!controller.signal.aborted) { const message = getErrorMessage(error, "Could not search the MCQ bank."); setPickerError(message); notify.error(message); }
      } finally {
        if (!controller.signal.aborted) setPickerLoading(false);
      }
    }, 180);
    return () => { window.clearTimeout(delay); controller.abort(); };
  }, [search, subjectId, topicId, questionStatus, page, pageSize]);

  function reset() { setEditing(null); setExamName(""); setTitle(""); setSlug(""); setYear(String(new Date().getFullYear())); setDescription(""); setStatus("draft"); setPaperType("Past paper"); setShiftSession(""); setExpectedQuestionCount(""); setSelectedQuestions([]); setBuilderOpen(false); }
  useEffect(() => {
    if (!composeToken) return;
    const timer = window.setTimeout(() => {
      setBuilderOpen(true);
      document.getElementById("create-paper-start")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [composeToken]);
  async function selectPaper(paper: AdminPaper) {
    setEditing(paper); setExamName(paper.examName); setTitle(paper.title); setSlug(paper.slug); setYear(String(paper.year)); setDescription(paper.description); setStatus(paper.status === "published" ? "published" : "draft"); setPaperType(paper.type); setShiftSession(paper.shiftSession ?? ""); setExpectedQuestionCount(paper.expectedQuestionCount == null ? "" : String(paper.expectedQuestionCount));
    setSelectedQuestions([]);
    setBuilderOpen(true);
    setPickerError("");
    try {
      const query = new URLSearchParams({ ids: paper.questionIds.join(",") });
      const response = await fetch(`/api/admin/question-picker?${query}`, { cache: "no-store" });
      const data = await parseApiResponse<{ questions?: PickerQuestion[] }>(response, "Could not load this paper's questions.");
      setSelectedQuestions(data.questions ?? []);
    } catch (error) { const message = getErrorMessage(error, "Could not load this paper's questions."); setPickerError(message); notify.error(message); }
    window.setTimeout(() => document.getElementById("create-paper-start")?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
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
    const saveStatus = hasUnpublishedQuestions ? "draft" : status;
    const result = await onSave({ id: editing?.id, examName, title, slug, year: Number(year), type: paperType, shiftSession, expectedQuestionCount, description, status: saveStatus, questionIds }, editing ? "PATCH" : "POST");
    setBusy(false); setNotice(result); if (result) reset();
  }

  return <div className="admin-content-stack">
    {canEdit && <section className="admin-panel" id="create-paper-start"><div className="admin-panel-heading"><div><span className="eyebrow">PAPER BUILDER</span><h3>{editing ? "Edit exam paper" : "Create a past paper"}</h3><p>{builderOpen ? "Add the exam details, then tick the MCQs that belong in this paper." : "Open the builder when you are ready. Existing papers stay in the cards below."}</p></div>{!builderOpen && <button type="button" className="button button-primary" onClick={() => setBuilderOpen(true)}>New paper</button>}{builderOpen && <button type="button" className="button button-light" onClick={reset}>Close</button>}</div>
      {builderOpen && <form className="admin-form paper-builder-form" onSubmit={submit}>
        <div className="paper-builder-main">
        <div className="paper-details-grid">
          <div><label htmlFor="paper-exam">Exam</label><select id="paper-exam" value={examName} onChange={(event) => setExamName(event.target.value)} required><option value="">Select exam</option>{exams.map((exam) => <option key={exam.id} value={exam.name}>{exam.name}</option>)}</select></div>
          <div><label htmlFor="paper-title">Paper title</label><input id="paper-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="PPSC Junior Clerk Written Test" minLength={3} maxLength={220} required /></div>
          <div><label htmlFor="paper-year">Year</label><input id="paper-year" type="number" value={year} onChange={(event) => setYear(event.target.value)} min="1900" max="2200" required /></div>
          <div><label htmlFor="paper-type">Type</label><select id="paper-type" value={paperType} onChange={(event) => setPaperType(event.target.value as AdminPaper["type"])}><option>Past paper</option><option>Model paper</option><option>Mock test</option></select></div>
        </div>
        <details className="paper-more-fields"><summary>Optional details</summary><div className="paper-details-grid"><div><label htmlFor="paper-slug">URL slug</label><input id="paper-slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="Generated from the title" /></div><div><label htmlFor="paper-shift">Shift or session</label><input id="paper-shift" value={shiftSession} onChange={(event) => setShiftSession(event.target.value)} maxLength={120} placeholder="Morning shift" /></div><div><label htmlFor="paper-expected">Expected question count</label><input id="paper-expected" type="number" value={expectedQuestionCount} onChange={(event) => setExpectedQuestionCount(event.target.value)} min="1" max="500" placeholder="100" /></div></div></details>
        <label htmlFor="paper-description">Source and paper details</label><textarea id="paper-description" value={description} onChange={(event) => setDescription(event.target.value)} minLength={3} maxLength={3000} rows={2} placeholder="Add source, exam details, and any notes for learners." required />
        <label htmlFor="paper-status">Publishing status</label><select id="paper-status" value={hasUnpublishedQuestions ? "draft" : status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="draft">Save as draft</option>{canPublish && <option value="published" disabled={hasUnpublishedQuestions}>Publish now</option>}</select>

        <div className="paper-question-builder">
          <div className="paper-picker-heading"><div><span className="eyebrow">QUESTION BANK</span><h4>Add questions to this paper</h4><p>{total.toLocaleString()} matching MCQs · page {page} of {totalPages}</p></div><span className="paper-selected-count">{selectedQuestions.length} selected</span></div>
          <div className="paper-picker-filters">
            <input className="admin-filter" aria-label="Search MCQs for paper" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search question text, source, subject, or topic…" />
            <select aria-label="Filter by subject" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(""); setPage(1); }}><option value="">All subjects</option>{subjects.filter((subject) => subject.status !== "archived").map((subject) => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select>
            <select aria-label="Filter by topic" value={topicId} onChange={(event) => { setTopicId(event.target.value); setPage(1); }}><option value="">All topics</option>{availableTopics.filter((topic) => topic.status !== "archived").map((topic) => <option value={topic.id} key={topic.id}>{topic.name}</option>)}</select>
            <select aria-label="Filter by MCQ status" value={questionStatus} onChange={(event) => { setQuestionStatus(event.target.value); setPage(1); }}><option value="active">All except archived</option><option value="published">Published only</option><option value="draft">Draft only</option><option value="archived">Archived</option><option value="all">All statuses</option></select>
          </div>
          <div className="paper-picker-toolbar"><span>{pickerLoading ? "Searching…" : `${results.length} shown on this page`}</span><div><label htmlFor="paper-page-size">Rows <select id="paper-page-size" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><button type="button" className="text-link" onClick={addPageQuestions} disabled={!results.some((question) => question.status !== "archived" && !selectedIdSet.has(question.id))}>Add all available on this page</button></div></div>
          {pickerError && <ErrorMessage>{pickerError}</ErrorMessage>}
          <div className="paper-picker-results">{results.map((question) => <label className={`paper-picker-result ${question.status === "archived" ? "is-muted" : ""}`} key={question.id}><input type="checkbox" disabled={question.status === "archived" && !selectedIdSet.has(question.id)} checked={selectedIdSet.has(question.id)} onChange={(event) => toggleQuestion(question, event.target.checked)} /><span className="paper-picker-result-copy"><strong><LocalizedText>{question.prompt}</LocalizedText></strong><small>{question.subjectName} · {question.topicName} · {question.difficulty}</small><small>Source: {question.sourceNote || "Source reference required"}</small></span><StatusBadge status={question.status} /></label>)}{!pickerLoading && !results.length && <p className="admin-empty">No MCQs match these filters.</p>}</div>
          <div className="paper-picker-pagination"><button type="button" className="button button-light" disabled={page <= 1 || pickerLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><span>Page {page} / {totalPages}</span><button type="button" className="button button-light" disabled={page >= totalPages || pickerLoading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button></div>
        </div>
        </div>
        <aside className="paper-builder-rail" aria-label="Selected paper questions">
          <div className="paper-rail-head"><div><span className="eyebrow">PAPER ORDER</span><strong>{selectedQuestions.length} MCQ{selectedQuestions.length === 1 ? "" : "s"}</strong></div><span>Drag or use the arrows</span></div>
          <section className="paper-selected-list">{selectedQuestions.map((question, index) => <article key={question.id} draggable onDragStart={() => setDragIndex(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropQuestion(index)} className={dragIndex === index ? "is-dragging" : ""}><button type="button" className="paper-drag-handle" aria-label={`Drag question ${index + 1}`} title="Drag to reorder">⠿</button><b>{String(index + 1).padStart(2, "0")}</b><span><LocalizedText>{question.prompt}</LocalizedText><small>{question.subjectName} · {question.topicName}</small></span><div className="paper-order-actions"><button type="button" aria-label={`Move question ${index + 1} up`} title="Move up" disabled={index === 0} onClick={() => moveQuestion(index, -1)}>↑</button><button type="button" aria-label={`Move question ${index + 1} down`} title="Move down" disabled={index === selectedQuestions.length - 1} onClick={() => moveQuestion(index, 1)}>↓</button><button type="button" aria-label={`Remove question ${index + 1}`} title="Remove" onClick={() => toggleQuestion(question, false)}>×</button></div></article>)}{!selectedQuestions.length && <p className="admin-empty">Check MCQs on the left. They appear here in paper order.</p>}</section>
          <SuccessMessage>{notice}</SuccessMessage>
          <div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy || !selectedQuestions.length}>{busy ? "Saving…" : editing ? "Save paper" : "Create paper"}</button>{editing && <button className="button button-light" type="button" onClick={reset}>Cancel</button>}</div>
          {hasUnpublishedQuestions && <p className="form-hint">Draft MCQs cannot go on a published paper. Publish those MCQs first, or save this paper as a draft.</p>}{!canPublish && <p className="form-hint">Your role saves papers as drafts.</p>}
        </aside>
      </form>}
    </section>}
    <section className="admin-panel admin-paper-library"><div className="admin-panel-heading"><div><span className="eyebrow">PAPER LIBRARY</span><h3>{papers.length} past papers</h3></div></div>
      <div className="paper-library-filters"><input className="admin-filter" aria-label="Search past papers" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search by title, exam, year, or status" /><select aria-label="Filter paper readiness" value={quickFilter} onChange={(event) => onQuickFilter(event.target.value)}><option value="all">All papers</option><option value="published">Published papers</option><option value="needs_questions">Below expected count</option></select></div>
      <div className="admin-table-wrap admin-management-table-wrap"><table className="table table-hover align-middle admin-data-table admin-management-table"><thead><tr><th>Paper</th><th>Exam / year</th><th>Questions</th><th>Status</th><th>Readiness</th><th className="admin-actions-column">Actions</th></tr></thead><tbody>
        {shown.map((paper) => {
          const target = paper.expectedQuestionCount ?? Math.max(paper.questionCount, 1);
          const progress = paper.expectedQuestionCount ? Math.min(100, Math.round(paper.questionCount / paper.expectedQuestionCount * 100)) : paper.questionCount ? 100 : 0;
          const readiness = [paper.questionCount > 0, paper.expectedQuestionCount ? paper.questionCount >= paper.expectedQuestionCount : paper.questionCount > 0, paper.questionCount > 0 && paper.publishedQuestionCount === paper.questionCount];
          const checklist = ["Questions assigned", paper.expectedQuestionCount ? `Expected count reached (${paper.expectedQuestionCount})` : "Question target set", "All questions published"];
          return <tr key={paper.id}>
            <td><strong>{paper.title}</strong><small className="admin-table-secondary">{paper.type}{paper.shiftSession ? ` · ${paper.shiftSession}` : ""}</small></td>
            <td>{paper.examName}<small className="admin-table-secondary">{paper.year}</small></td>
            <td><strong>{paper.questionCount.toLocaleString()}</strong><small className="admin-table-secondary">{paper.expectedQuestionCount ? `of ${paper.expectedQuestionCount} expected` : "No target set"}</small></td>
            <td><StatusBadge status={paper.status} /></td>
            <td><div className="admin-paper-table-progress"><div className="paper-progress-track" role="progressbar" aria-label={`${paper.title} question count progress`} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(paper.questionCount, target)}><i style={{ width: `${progress}%` }} /></div><details className="admin-readiness-details"><summary>{readiness.filter(Boolean).length}/3 checks ready</summary><ul className="paper-readiness-checklist" aria-label={`${paper.title} readiness checklist`}>{checklist.map((label, index) => <li className={readiness[index] ? "is-ready" : ""} key={label}><span aria-hidden="true">{readiness[index] ? "✓" : "○"}</span>{label}</li>)}</ul>{paper.publishedQuestionCount < paper.questionCount && <small>{paper.questionCount - paper.publishedQuestionCount} assigned MCQs are not visible to learners.</small>}{paper.description && <small>{paper.description}</small>}</details></div></td>
            <td><div className="admin-table-actions"><button type="button" className="button button-light" onClick={() => void onExport(`/api/admin/export?kind=paper&id=${paper.id}&format=csv`)} title="Export paper CSV"><Download size={15} /><span>CSV</span></button><button type="button" className="button button-light" onClick={() => void onExport(`/api/admin/export?kind=paper&id=${paper.id}&format=pdf`)} title="Export paper PDF"><Download size={15} /><span>PDF</span></button>{canEdit && paper.status !== "archived" && <button type="button" className="button button-light" onClick={() => onAddMcqs(paper.id)}><Plus size={14} /><span>Add MCQs</span></button>}{canEdit && <button type="button" className="button button-light" onClick={() => void selectPaper(paper)}><Pencil size={14} /><span>Edit</span></button>}{canPublish && paper.status !== "published" && <button type="button" className="button button-primary" onClick={() => void onStatus(paper.id, "published")}>Publish</button>}{canDelete && paper.status !== "archived" && <button type="button" className="button button-light" onClick={() => void onStatus(paper.id, "archived")}><Archive size={14} /><span>Archive</span></button>}</div></td>
          </tr>;
        })}
        {!shown.length && <tr><td colSpan={6} className="admin-table-empty"><strong>No papers match these filters</strong><span>Clear the search and readiness filter to return to the full paper library.</span><button type="button" className="button button-light" onClick={() => { setFilter(""); onQuickFilter("all"); }}>Clear filters</button></td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}

function TeamPanel({ users, currentId, isSuperAdmin, onSave }: { users: AdminUser[]; currentId: string; isSuperAdmin: boolean; onSave: (body: unknown, method: string) => Promise<string> }) {
  const permissionKeys: AdminPermission[] = ["content:view", "mcq.create", "mcq.edit_own", "mcq.edit_any", "mcq.review", "mcq.publish", "mcq.archive", "category.manage", "paper.manage", "paper.publish", "paper.add_questions", "paper.quickcreate", "user.manage"];
  const permissionLabels: Record<string, string> = { "content:view": "View content", "mcq.create": "Create MCQs", "mcq.edit_own": "Edit own MCQs", "mcq.edit_any": "Edit any MCQ", "mcq.review": "Review MCQs", "mcq.publish": "Publish MCQs", "mcq.archive": "Archive MCQs", "category.manage": "Manage categories", "paper.manage": "Manage papers", "paper.publish": "Publish papers", "paper.add_questions": "Add questions to papers", "paper.quickcreate": "Quick create papers", "user.manage": "Manage team" };
  const [editing, setEditing] = useState<AdminUser | null>(null); const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [role, setRole] = useState<AdminRole>("data_entry"); const [status, setStatus] = useState<"active" | "inactive">("active");
  const [permissionValues, setPermissionValues] = useState<Record<string, boolean>>(() => Object.fromEntries(permissionKeys.map((key) => [key, ROLE_PERMISSIONS.data_entry.includes(key)])));
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  function defaultsFor(nextRole: AdminRole) { return Object.fromEntries(permissionKeys.map((key) => [key, ROLE_PERMISSIONS[nextRole].includes(key)])); }
  function reset() { setEditing(null); setName(""); setEmail(""); setPassword(""); setRole("data_entry"); setStatus("active"); setPermissionValues(defaultsFor("data_entry")); }
  function choose(user: AdminUser) { setEditing(user); setName(user.name); setEmail(user.email); setPassword(""); setRole(user.role); setStatus(user.status); setPermissionValues({ ...defaultsFor(user.role), ...(user.permissionOverrides ?? {}) }); }
  function changeRole(nextRole: AdminRole) { setRole(nextRole); setPermissionValues((current) => Object.fromEntries(permissionKeys.map((key) => [key, Object.hasOwn(current, key) && current[key] !== ROLE_PERMISSIONS[role].includes(key) ? current[key] : ROLE_PERMISSIONS[nextRole].includes(key)]))); }
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setNotice(""); const result = await onSave({ id: editing?.id, name, email, password, role, status, permissionOverrides: permissionValues }, editing ? "PATCH" : "POST"); setBusy(false); setNotice(result); if (result) reset(); }
  return <div className="admin-management-grid">
    <section className="admin-panel"><div className="admin-panel-heading"><div><span className="eyebrow">ACCESS CONTROL</span><h3>{editing ? "Edit team account" : "Invite a team member"}</h3></div></div>
      <p className="admin-helper">Data Entry creates MCQs and edits own drafts. Reviewers decide submitted MCQs. Publishers manage papers and publish approved content. Admins manage workspace operations; Super Admins also manage super admins and system settings.</p>
      <form className="admin-form" onSubmit={submit}>
        <label htmlFor="team-name">Full name</label><input id="team-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={140} required />
        <label htmlFor="team-email">Email</label><input id="team-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={190} required />
        <label htmlFor="team-password">{editing ? "New password (leave blank to keep current)" : "Temporary password"}</label><input id="team-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={200} autoComplete="new-password" required={!editing} />
        <label htmlFor="team-role">Role</label><select id="team-role" value={role} onChange={(event) => changeRole(event.target.value as AdminRole)}><option value="data_entry">Data Entry · create MCQs and edit own drafts</option><option value="reviewer">Reviewer · approve or reject submitted MCQs</option><option value="publisher">Publisher · publish approved MCQs and manage papers</option>{isSuperAdmin && <option value="admin">Admin · full workspace access except super-admin settings</option>}{isSuperAdmin && <option value="super_admin">Super Admin · all permissions, including other super admins</option>}</select>
        <section className="permission-matrix" aria-label="Permission matrix"><div className="permission-matrix-heading"><strong>Effective permissions</strong><span>Role defaults for {roleLabels[role]}; changed values are marked as overrides.</span></div>{permissionKeys.map((key) => { const roleDefault = ROLE_PERMISSIONS[role].includes(key); const isOverride = permissionValues[key] !== roleDefault; return <label className="permission-matrix-row" key={key}><span>{permissionLabels[key]}</span><span className="permission-default">Default: {roleDefault ? "On" : "Off"}</span>{isOverride && <b className="permission-override-badge">Override</b>}<input type="checkbox" checked={permissionValues[key] ?? roleDefault} onChange={(event) => setPermissionValues((current) => ({ ...current, [key]: event.target.checked }))} aria-label={`${permissionLabels[key]} permission`} /> </label>; })}<p className="form-hint">Super Admin management and system settings are protected and cannot be overridden.</p></section>
        {editing && <><label htmlFor="team-status">Account status</label><select id="team-status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">Active</option><option value="inactive">Inactive</option></select></>}
        <SuccessMessage>{notice}</SuccessMessage><div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save account" : "Create account"}</button>{editing && <button className="button button-light" type="button" onClick={reset}>Cancel edit</button>}</div>
        <p className="form-hint">Passwords need at least 12 characters and are stored as salted scrypt hashes. Never send passwords over chat.</p>
      </form>
    </section>
    <section className="admin-panel admin-team-directory"><div className="admin-panel-heading"><div><span className="eyebrow">TEAM DIRECTORY</span><h3>{users.length} accounts</h3></div></div><p className="admin-helper">Your own account cannot be disabled or assigned a different role.</p>
      <div className="admin-table-wrap admin-management-table-wrap"><table className="table table-hover align-middle admin-data-table admin-management-table"><thead><tr><th>Staff member</th><th>Role</th><th>Last login</th><th>Status</th><th className="admin-actions-column">Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.name}{user.id === currentId ? " (you)" : ""}</strong><small className="admin-table-secondary">{user.email}</small></td><td>{roleLabels[user.role]}</td><td>{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : "Never"}</td><td><StatusBadge status={user.status} /></td><td><div className="admin-table-actions"><button type="button" className="button button-light" disabled={user.id === currentId} onClick={() => choose(user)}><Pencil size={14} /><span>Edit account</span></button></div></td></tr>)}{!users.length && <tr><td colSpan={5} className="admin-table-empty">No team accounts yet. Invite a team member using the form.</td></tr>}</tbody></table></div>
    </section>
  </div>;
}
