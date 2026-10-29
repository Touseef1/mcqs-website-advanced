"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getErrorMessage, parseApiResponse } from "@/lib/error-message";
import { notify } from "@/lib/toast";

type ActivityAction = "login" | "logout" | "mcq_added" | "mcq_edited" | "mcq_archived" | "mcq_unarchived" | "mcq_deleted" | "paper_added" | "paper_edited" | "paper_archived" | "paper_unarchived" | "paper_deleted";
type ActivityLog = { id: number; userId: string; userName: string; userRole: string; action: ActivityAction; targetType: "mcq" | "paper" | null; targetId: number | null; targetTitle: string | null; ipAddress: string | null; occurredAtUtc: string };
type UserSummary = { id: string; name: string; role: string; lastLoginAtUtc: string | null; mcqsAdded: number; mcqsArchived: number; papersAdded: number; papersArchived: number };
type ActivityResponse = { logs: ActivityLog[]; users: UserSummary[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };

const actionLabels: Record<ActivityAction, string> = {
  login: "User login", logout: "User logout", mcq_added: "MCQ added", mcq_edited: "MCQ edited",
  mcq_archived: "MCQ archived", mcq_unarchived: "MCQ unarchived", mcq_deleted: "MCQ deleted",
  paper_added: "Paper added", paper_edited: "Paper edited", paper_archived: "Paper archived",
  paper_unarchived: "Paper unarchived", paper_deleted: "Paper deleted",
};

const roleLabels: Record<string, string> = { super_admin: "Super Admin", admin: "Admin", data_entry: "Data Entry", reviewer: "Reviewer", publisher: "Publisher" };

function formatUtc(value: string | null) {
  return value ? `${value} UTC` : "Never";
}

export function AdminActivityLogs() {
  const [data, setData] = useState<ActivityResponse>({ logs: [], users: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } });
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [appliedFilters, setAppliedFilters] = useState({ userId: "", action: "", from: "", to: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (appliedFilters.userId) query.set("userId", appliedFilters.userId);
    if (appliedFilters.action) query.set("action", appliedFilters.action);
    if (appliedFilters.from) query.set("from", appliedFilters.from);
    if (appliedFilters.to) query.set("to", appliedFilters.to);
    void fetch(`/api/admin/activity-logs?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => setData(await parseApiResponse<ActivityResponse>(response, "Could not load activity logs.")))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) { const message = getErrorMessage(reason, "Could not load activity logs."); setError(message); notify.error(message); }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, appliedFilters]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setAppliedFilters({ userId, action, from, to });
    setPage(1);
  }

  function clearFilters() {
    setLoading(true);
    setError("");
    setUserId(""); setAction(""); setFrom(""); setTo("");
    setAppliedFilters({ userId: "", action: "", from: "", to: "" });
    setPage(1);
  }

  function movePage(nextPage: number) {
    setLoading(true);
    setError("");
    setPage(nextPage);
  }

  return <div className="admin-content-stack admin-activity-page">
    <section className="admin-panel">
      <div className="admin-panel-heading"><div><span className="eyebrow">AUDIT TRAIL</span><h3>Activity log filters</h3></div></div>
      <form className="admin-activity-filters" onSubmit={applyFilters}>
        <label>User<select aria-label="Filter by user" value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">All users</option>{data.users.map((user) => <option key={user.id} value={user.id}>{user.name} · {roleLabels[user.role] ?? user.role}</option>)}</select></label>
        <label>Action<select aria-label="Filter by action type" value={action} onChange={(event) => setAction(event.target.value)}><option value="">All actions</option>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>From<input type="date" aria-label="From date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To<input type="date" aria-label="To date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <div className="admin-inline-actions"><button className="button button-primary" type="submit">Apply filters</button><button className="button button-light" type="button" onClick={clearFilters}>Clear</button></div>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>

    <section className="admin-panel admin-activity-summary">
      <div className="admin-panel-heading"><div><span className="eyebrow">STAFF SUMMARY</span><h3>Activity by user</h3></div><span className="form-hint">Counts cover all recorded activity.</span></div>
      <div className="admin-table-wrap"><table className="admin-data-table"><thead><tr><th>User</th><th>Role</th><th>MCQs added</th><th>MCQs archived</th><th>Papers added</th><th>Papers archived</th><th>Last login (UTC)</th></tr></thead><tbody>
        {data.users.map((user) => <tr key={user.id}><td><strong>{user.name}</strong><small>ID {user.id}</small></td><td>{roleLabels[user.role] ?? user.role}</td><td>{user.mcqsAdded}</td><td>{user.mcqsArchived}</td><td>{user.papersAdded}</td><td>{user.papersArchived}</td><td>{formatUtc(user.lastLoginAtUtc)}</td></tr>)}
        {!data.users.length && <tr><td colSpan={7}>No staff accounts found.</td></tr>}
      </tbody></table></div>
    </section>

    <section className="admin-panel admin-activity-log-list">
      <div className="admin-panel-heading"><div><span className="eyebrow">RECENT EVENTS</span><h3>{data.pagination.total.toLocaleString()} activity entries</h3></div><span className="form-hint">Newest first · timestamps are UTC</span></div>
      <div className="admin-table-wrap"><table className="admin-data-table"><thead><tr><th>Date and time (UTC)</th><th>User</th><th>Action</th><th>Target</th><th>IP address</th></tr></thead><tbody>
        {data.logs.map((log) => <tr key={log.id}><td>{formatUtc(log.occurredAtUtc)}</td><td><strong>{log.userName}</strong><small>ID {log.userId} · {roleLabels[log.userRole] ?? log.userRole}</small></td><td>{actionLabels[log.action] ?? log.action}</td><td>{log.targetType && log.targetId ? <><strong>{log.targetType === "mcq" ? "MCQ" : "Paper"} #{log.targetId}</strong>{log.targetTitle && <small className="activity-target-title">{log.targetTitle}</small>}</> : "—"}</td><td>{log.ipAddress ?? "—"}</td></tr>)}
        {!loading && !data.logs.length && <tr><td colSpan={5}>No activity matches these filters.</td></tr>}
        {loading && <tr><td colSpan={5}>Loading activity…</td></tr>}
      </tbody></table></div>
      <div className="activity-pagination"><span>Page {data.pagination.page} of {data.pagination.totalPages}</span><div className="admin-inline-actions"><button className="button button-light" type="button" disabled={page <= 1 || loading} onClick={() => movePage(Math.max(1, page - 1))}>Previous</button><button className="button button-light" type="button" disabled={page >= data.pagination.totalPages || loading} onClick={() => movePage(Math.min(data.pagination.totalPages, page + 1))}>Next</button></div></div>
    </section>
  </div>;
}
