"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Copy, Search, Trash2 } from "lucide-react";
import { LocalizedText } from "@/components/LocalizedText";
import { SitePagination } from "@/components/SitePagination";
import { useConfirmModal } from "@/components/ConfirmModal";
import { ApiResponseError, getErrorMessage } from "@/lib/error-message";
import { notify } from "@/lib/toast";

type Paper = { id: number; title: string; status: string };
type Question = {
  id: number; topicId: number; topicName: string; subjectName: string; prompt: string; explanation: string;
  sourceNote: string; correctChoice: string; difficulty: string; language: string; status: string;
  questionImageUrl: string | null; attemptCount: number;
  choices: Array<{ label: string; text: string; imageUrl: string | null }>;
  papers: Paper[];
};
type DuplicateGroup = { canonical: Question; duplicates: Question[] };
type Data = { groups: DuplicateGroup[]; papers: Paper[] };
type DuplicateEntry = { canonical: Question; duplicate: Question };

async function readJson<T>(response: Response): Promise<T> {
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiResponseError(response.status, result, "The duplicate MCQ request failed.");
  if (!result || typeof result !== "object") throw new Error("The server returned an unreadable response.");
  return result as T;
}

export function AdminDuplicateQuestions() {
  const confirm = useConfirmModal();
  const [data, setData] = useState<Data>({ groups: [], papers: [] });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [paperSelections, setPaperSelections] = useState<Record<number, number[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await readJson<Data>(await fetch("/api/admin/questions/duplicates", { cache: "no-store" }));
      setData(result);
      setPaperSelections(Object.fromEntries(result.groups.flatMap((group) => group.duplicates.map((question) => [question.id, question.papers.filter((paper) => paper.status !== "archived").map((paper) => paper.id)]))));
    } catch (cause) {
      notify.error(getErrorMessage(cause, "Could not load duplicate MCQs."));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const request = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(request);
  }, [load]);

  const entries = useMemo<DuplicateEntry[]>(() => data.groups.flatMap((group) => group.duplicates.map((duplicate) => ({ canonical: group.canonical, duplicate }))), [data.groups]);
  const filtered = useMemo(() => entries.filter(({ canonical, duplicate }) =>
    `${canonical.id} ${canonical.prompt} ${canonical.subjectName} ${canonical.topicName} ${duplicate.id} ${duplicate.prompt} ${duplicate.subjectName} ${duplicate.topicName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [entries, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const shown = filtered.slice((page - 1) * pageSize, page * pageSize);

  async function submit(action: "move-paper-links" | "delete-duplicate", entry: DuplicateEntry) {
    const paperIds = paperSelections[entry.duplicate.id] ?? [];
    setBusyId(entry.duplicate.id);
    try {
      const response = await fetch("/api/admin/questions/duplicates", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, duplicateId: entry.duplicate.id, canonicalId: entry.canonical.id, paperIds }),
      });
      await readJson(response);
      notify.success(action === "delete-duplicate" ? `MCQ #${entry.duplicate.id} was permanently deleted.` : `Paper links were updated for MCQ #${entry.duplicate.id}.`);
      await load();
    } catch (cause) {
      notify.error(getErrorMessage(cause, action === "delete-duplicate" ? "Could not delete this duplicate MCQ." : "Could not update paper links."));
    } finally { setBusyId(null); }
  }

  async function deleteDuplicate(entry: DuplicateEntry) {
    if (entry.duplicate.attemptCount > 0) return;
    await confirm({
      title: `Permanently delete MCQ #${entry.duplicate.id}?`,
      message: `This removes the duplicate from the question bank and moves the selected paper links to canonical MCQ #${entry.canonical.id}. This cannot be undone. Learner bookmarks will be moved to the canonical MCQ.`,
      confirmLabel: "Delete permanently", variant: "danger",
    }, async () => submit("delete-duplicate", entry));
  }

  return <section className="admin-panel admin-duplicate-manager">
    <header className="admin-panel-heading"><div><span className="eyebrow">CONTENT CLEANUP</span><h2>Duplicate MCQs</h2><p>Review exact duplicates across all topics, move paper links to the canonical MCQ, and safely remove redundant copies.</p></div><span className="duplicate-mcq-count"><Copy size={16} aria-hidden="true" />{entries.length} duplicate copies</span></header>
    <div className="duplicate-mcq-toolbar"><label className="duplicate-mcq-search"><Search size={16} aria-hidden="true" /><input aria-label="Search duplicate MCQs" placeholder="Search question, topic or MCQ ID…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label><span>{data.groups.length} exact duplicate groups</span></div>
    {loading ? <div className="loading-panel">Finding exact duplicate MCQs…</div> : !shown.length ? <div className="admin-empty-state"><strong>{search ? "No duplicates match this search" : "No exact duplicate MCQs found"}</strong><span>{search ? "Try another question, topic, or MCQ ID." : "Exact matches are detected from the question, all four options, and the correct answer."}</span></div> : <div className="admin-table-wrap"><table className="table table-hover align-middle admin-data-table duplicate-mcq-table"><thead><tr><th>Canonical MCQ</th><th>Duplicate MCQ</th><th>Paper links to keep</th><th>History</th><th>Actions</th></tr></thead><tbody>
      {shown.map(({ canonical, duplicate }) => <tr key={duplicate.id}>
        <td><strong>#{canonical.id} · {canonical.status}</strong><small className="admin-table-secondary">{canonical.subjectName} › {canonical.topicName} · {canonical.papers.length} paper links</small><span className="duplicate-mcq-prompt"><LocalizedText>{canonical.prompt}</LocalizedText></span><div className="duplicate-mcq-options">{canonical.choices.map((choice) => <span key={choice.label}><b>{choice.label})</b><LocalizedText>{choice.text}</LocalizedText>{choice.label === canonical.correctChoice && <em>Correct</em>}</span>)}</div></td>
        <td><strong>#{duplicate.id} · {duplicate.status}</strong><small className="admin-table-secondary">{duplicate.subjectName} › {duplicate.topicName} · {duplicate.papers.length} paper links</small><span className="duplicate-mcq-prompt"><LocalizedText>{duplicate.prompt}</LocalizedText></span><div className="duplicate-mcq-options">{duplicate.choices.map((choice) => <span key={choice.label}><b>{choice.label})</b><LocalizedText>{choice.text}</LocalizedText>{choice.label === duplicate.correctChoice && <em>Correct</em>}</span>)}</div></td>
        <td><label className="duplicate-mcq-paper-label" htmlFor={`duplicate-papers-${duplicate.id}`}>Choose papers for canonical MCQ #{canonical.id}</label><select id={`duplicate-papers-${duplicate.id}`} className="duplicate-mcq-paper-picker" multiple size={4} value={(paperSelections[duplicate.id] ?? []).map(String)} onChange={(event) => setPaperSelections((current) => ({ ...current, [duplicate.id]: [...event.currentTarget.selectedOptions].map((option) => Number(option.value)) }))}>{data.papers.map((paper) => <option key={paper.id} value={paper.id}>{paper.title}{paper.status === "published" ? " · published" : ""}</option>)}</select><button type="button" className="button button-light duplicate-mcq-move-button" disabled={busyId === duplicate.id} onClick={() => void submit("move-paper-links", { canonical, duplicate })}><ArrowRightLeft size={14} aria-hidden="true" />Move paper links</button></td>
        <td><strong>{duplicate.attemptCount.toLocaleString()} attempts</strong>{duplicate.attemptCount > 0 && <small className="duplicate-mcq-protected-note">Keep history intact; archive this MCQ from the MCQ bank instead.</small>}</td>
        <td><button type="button" className="button button-danger duplicate-mcq-delete-button" disabled={busyId === duplicate.id || duplicate.attemptCount > 0} title={duplicate.attemptCount > 0 ? "Cannot permanently delete an MCQ with learner history" : "Permanently delete duplicate MCQ"} onClick={() => void deleteDuplicate({ canonical, duplicate })}><Trash2 size={14} aria-hidden="true" />Delete permanently</button></td>
      </tr>)}
    </tbody></table></div>}
    {!loading && filtered.length > 0 && <SitePagination page={page} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} ariaLabel="Duplicate MCQ pages" className="duplicate-mcq-pagination" />}
  </section>;
}
