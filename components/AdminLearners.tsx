"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import ReactPaginate from "react-paginate";
import { ArrowLeft, Pencil, Plus, Search, UserRoundX } from "lucide-react";
import { useConfirmModal } from "@/components/ConfirmModal";
import { getErrorMessage, parseApiResponse } from "@/lib/error-message";
import { notify } from "@/lib/toast";

type Learner = { id: string; name: string; email: string; status: "active" | "inactive"; created_at: string; email_verified_at: string | null };
type LearnerResponse = { learners: Learner[]; total: number; page: number; pageSize: number; pageCount: number };
type LearnerForm = { id?: string; name: string; email: string; password: string; status: "active" | "inactive" };

async function learnerRequest<T>(method: string, body?: unknown, query?: URLSearchParams): Promise<T> {
  const response = await fetch(`/api/admin/learners${query ? `?${query}` : ""}`, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseApiResponse<T>(response, "The learner account request could not be completed.");
}

function blankForm(): LearnerForm { return { name: "", email: "", password: "", status: "active" }; }

export function AdminLearners() {
  const confirm = useConfirmModal();
  const [rows, setRows] = useState<Learner[]>([]);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<LearnerForm | null>(null);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page + 1) });
      if (search.trim()) params.set("search", search.trim());
      const result = await learnerRequest<LearnerResponse>("GET", undefined, params);
      if (version !== requestVersion.current) return;
      setRows(result.learners);
      setTotal(result.total);
      setPageCount(result.pageCount);
      setError("");
      if (result.page - 1 !== page) setPage(result.page - 1);
    } catch (cause) {
      if (version !== requestVersion.current) return;
      const message = getErrorMessage(cause, "Could not load learner accounts.");
      setError(message);
      notify.error(message);
    } finally { if (version === requestVersion.current) setLoading(false); }
  }, [page, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function startCreate() { setError(""); setForm(blankForm()); }
  function startEdit(learner: Learner) {
    setError("");
    setForm({ id: learner.id, name: learner.name, email: learner.email, password: "", status: learner.status });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      await learnerRequest(form.id ? "PATCH" : "POST", { ...form, password: form.password || undefined });
      notify.success(form.id ? "Learner account updated." : "Learner account created.");
      setForm(null);
      await load();
    } catch (cause) {
      const message = getErrorMessage(cause, "The learner account could not be saved.");
      setError(message);
      notify.error(message);
    } finally { setBusy(false); }
  }

  async function deactivate(learner: Learner) {
    let failure: unknown;
    try {
      const accepted = await confirm({
        title: "Deactivate learner account?",
        message: `This signs out ${learner.name} and prevents new sign-ins. Their quiz history and bookmarks will be retained. You can reactivate the account later.`,
        confirmLabel: "Deactivate account",
        variant: "warning",
      }, async () => {
        try { await learnerRequest("DELETE", { id: learner.id }); }
        catch (cause) { failure = cause; throw cause; }
      });
      if (accepted) { notify.success("Learner account deactivated."); await load(); }
    } catch (cause) {
      const source = failure ?? cause;
      const message = getErrorMessage(source, "The learner account could not be deactivated.");
      if (!(source instanceof Error && source.name === "ConfirmationCancelledError")) notify.error(message);
    }
  }

  async function activate(learner: Learner) {
    try {
      await learnerRequest("PATCH", { id: learner.id, name: learner.name, email: learner.email, status: "active" });
      notify.success("Learner account reactivated.");
      await load();
    } catch (cause) { notify.error(getErrorMessage(cause, "The learner account could not be reactivated.")); }
  }

  if (form) return <div className="admin-form-screen learner-form-screen">
    <div className="admin-form-screen-heading"><button type="button" className="button button-light" disabled={busy} onClick={() => setForm(null)}><ArrowLeft size={15} />Back to learners</button><div><span className="eyebrow">LEARNER ACCOUNTS</span><h2>{form.id ? `Edit learner #${form.id}` : "Add learner account"}</h2><p>Update the learner’s name and email, or set a new password.</p></div></div>
    <section className="admin-panel admin-form-page-panel"><form className="admin-form admin-form-page learner-account-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="learner-name">Full name</label><input id="learner-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} minLength={2} maxLength={140} required />
      <label htmlFor="learner-email">Email</label><input id="learner-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} maxLength={190} required />
      <label htmlFor="learner-password">{form.id ? "New password (leave blank to keep current)" : "Password"}</label><input id="learner-password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={8} maxLength={128} autoComplete="new-password" required={!form.id} />
      {form.id && <><label htmlFor="learner-status">Account status</label><select id="learner-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as LearnerForm["status"] })}><option value="active">Active</option><option value="inactive">Inactive</option></select></>}
      <p className="form-hint">Passwords are stored as salted scrypt hashes. Changing a password or account status signs out the learner’s existing sessions.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="admin-form-page-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : form.id ? "Save learner" : "Create learner"}</button><button className="button button-light" type="button" disabled={busy} onClick={() => setForm(null)}>Cancel</button></div>
    </form></section>
  </div>;

  return <section className="admin-panel admin-list-page learner-directory">
    <div className="admin-panel-heading"><div><span className="eyebrow">LEARNER DIRECTORY</span><h3>{total.toLocaleString()} learner accounts</h3></div><button type="button" className="button button-primary" onClick={startCreate}><Plus size={15} />Add learner</button></div>
    <div className="learner-directory-toolbar"><label className="admin-list-search" htmlFor="learner-search"><Search size={16} aria-hidden="true" /><input id="learner-search" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search learners by name or email" /><kbd>⌕</kbd></label><span>Inactive accounts retain quiz history and can be reactivated.</span></div>
    {error && <p className="form-error learner-directory-error" role="alert">{error}</p>}
    <div className="admin-table-wrap admin-management-table-wrap"><table className="table table-hover align-middle admin-data-table admin-management-table learner-management-table"><thead><tr><th>Learner</th><th>Registered</th><th>Email status</th><th>Account status</th><th className="admin-actions-column">Actions</th></tr></thead><tbody>
      {rows.map((learner) => <tr key={learner.id}><td><strong>{learner.name}</strong><small className="admin-table-secondary">{learner.email} · ID #{learner.id}</small></td><td>{new Date(learner.created_at).toLocaleDateString()}</td><td><span className={`admin-status ${learner.email_verified_at ? "admin-status-published" : "admin-status-draft"}`}>{learner.email_verified_at ? "Verified" : "Unverified"}</span></td><td><span className={`admin-status admin-status-${learner.status}`}>{learner.status}</span></td><td><div className="admin-table-actions"><button type="button" className="button button-light" disabled={busy} onClick={() => startEdit(learner)}><Pencil size={14} /><span>Edit</span></button>{learner.status === "active" ? <button type="button" className="button button-light learner-deactivate-button" disabled={busy} onClick={() => void deactivate(learner)}><UserRoundX size={14} /><span>Deactivate</span></button> : <button type="button" className="button button-light" disabled={busy} onClick={() => void activate(learner)}><span>Reactivate</span></button>}</div></td></tr>)}
      {!loading && rows.length === 0 && <tr><td colSpan={5} className="admin-table-empty"><strong>{search.trim() ? "No learners match this search" : "No learner accounts yet"}</strong><span>{search.trim() ? "Try a different name or email." : "New learner accounts will appear here."}</span>{search.trim() && <button type="button" className="button button-light" onClick={() => setSearch("")}>Clear search</button>}</td></tr>}
      {loading && <tr><td colSpan={5} className="admin-table-empty">Loading learner accounts…</td></tr>}
    </tbody></table></div>
    <div className="learner-directory-pagination"><span>{total ? `Showing ${(page * 25) + 1}–${Math.min((page + 1) * 25, total)} of ${total}` : "No learners to show"}</span>{pageCount > 1 && <ReactPaginate
      breakLabel="…" nextLabel="Next →" previousLabel="← Previous"
      onPageChange={({ selected }) => setPage(selected)} pageRangeDisplayed={3} marginPagesDisplayed={1}
      pageCount={pageCount} forcePage={page} renderOnZeroPageCount={null}
      containerClassName="learner-pagination" pageClassName="learner-pagination-page" pageLinkClassName="learner-pagination-link"
      previousClassName="learner-pagination-previous" nextClassName="learner-pagination-next" activeClassName="is-active"
      disabledClassName="is-disabled" breakClassName="learner-pagination-break"
    />}</div>
  </section>;
}
