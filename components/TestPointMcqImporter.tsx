"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ClipboardCopy, Download, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { LocalizedText } from "@/components/LocalizedText";
import { getErrorMessage } from "@/lib/error-message";
import { notify } from "@/lib/toast";

type ExternalMcq = {
  sourceId: string;
  sourceUrl: string;
  prompt: string;
  choices: [string, string, string, string];
  correctChoice: "A" | "B" | "C" | "D";
  explanation: string;
};
type PageResponse = { page: number; totalPages: number; questions: ExternalMcq[]; error?: string };
type Props = { onSendToBulk: (text: string) => void };

const PAGE_SIZE = 20;
const labels = ["A", "B", "C", "D"] as const;

function formatBulkText(questions: ExternalMcq[]) {
  return questions.map((question) => [
    `Q: ${question.prompt}`,
    ...question.choices.map((choice, index) => `${labels[index]}) ${choice}`),
    `Answer: ${question.correctChoice}`,
    ...(question.explanation ? [`Explanation: ${question.explanation.replace(/\n+/g, "\n")}`] : []),
  ].join("\n")).join("\n\n");
}

async function getPage(page: number): Promise<PageResponse> {
  const response = await fetch(`/api/admin/external-mcqs/testpoint-urdu-adab?page=${page}`, { cache: "no-store" });
  const body = await response.json().catch(() => null) as PageResponse | null;
  if (!response.ok || !body) throw new Error(body?.error || `Could not load source page ${page}.`);
  return body;
}

export function TestPointMcqImporter({ onSendToBulk }: Props) {
  const [questions, setQuestions] = useState<ExternalMcq[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loadedPages, setLoadedPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failedPages, setFailedPages] = useState<number[]>([]);

  const visibleQuestions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const filtered = term ? questions.filter((question) => `${question.prompt} ${question.choices.join(" ")} ${question.explanation}`.toLocaleLowerCase().includes(term)) : questions;
    return { filtered, pageItems: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), pageCount: Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)) };
  }, [questions, search, page]);
  const selectedQuestions = useMemo(() => {
    const selectedIds = new Set(selected);
    return questions.filter((question) => selectedIds.has(question.sourceId));
  }, [questions, selected]);

  async function loadAllPages() {
    setLoading(true);
    setFailedPages([]);
    setLoadedPages(0);
    try {
      const firstPage = await getPage(1);
      const merged = new Map(firstPage.questions.map((question) => [question.sourceId, question]));
      setTotalPages(firstPage.totalPages);
      setLoadedPages(1);

      const pending = Array.from({ length: Math.max(0, firstPage.totalPages - 1) }, (_, index) => index + 2);
      const failures: number[] = [];
      let cursor = 0;
      const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
        while (cursor < pending.length) {
          const sourcePage = pending[cursor++];
          try {
            const result = await getPage(sourcePage);
            result.questions.forEach((question) => merged.set(question.sourceId, question));
          } catch {
            failures.push(sourcePage);
          } finally {
            setLoadedPages((count) => count + 1);
          }
        }
      });
      await Promise.all(workers);
      const list = [...merged.values()];
      setQuestions(list);
      setFailedPages(failures.sort((a, b) => a - b));
      setSelected((current) => current.filter((id) => list.some((question) => question.sourceId === id)));
      setPage(1);
      if (failures.length) notify.error(`${list.length} MCQs loaded. ${failures.length} source pages failed; retry to complete the list.`);
      else notify.success(`Loaded ${list.length} MCQs from ${firstPage.totalPages} pages.`);
    } catch (error) {
      notify.error(getErrorMessage(error, "Could not load MCQs from TestPoint."));
    } finally {
      setLoading(false);
    }
  }

  function toggleOne(sourceId: string) {
    setSelected((current) => current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]);
  }

  function toggleVisible() {
    const ids = visibleQuestions.pageItems.map((question) => question.sourceId);
    const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id));
    setSelected((current) => allSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]);
  }

  function selectAll() {
    setSelected(questions.map((question) => question.sourceId));
  }

  async function copySelected() {
    if (!selectedQuestions.length) return;
    try {
      await navigator.clipboard.writeText(formatBulkText(selectedQuestions));
      notify.success(`Copied ${selectedQuestions.length} MCQs with their answers and explanations.`);
    } catch (error) {
      notify.error(getErrorMessage(error, "Clipboard access was blocked. Use the bulk editor button instead."));
    }
  }

  return (
    <section className="testpoint-importer" aria-label="TestPoint Urdu Adab MCQ importer">
      <header className="testpoint-importer-header">
        <div>
          <span className="eyebrow">SEPARATE SOURCE IMPORTER</span>
          <h3>TestPoint · Urdu Adab</h3>
          <p>Load every source page, select questions, and send them to the existing bulk preview before saving.</p>
        </div>
        <button type="button" className="button button-light" onClick={() => void loadAllPages()} disabled={loading}>
          {loading ? <LoaderCircle size={15} className="testpoint-spinner" aria-hidden="true" /> : questions.length ? <RefreshCw size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
          {loading ? `Loading ${loadedPages}/${totalPages || "…"}` : questions.length ? "Reload all pages" : "Load all MCQs"}
        </button>
      </header>

      {loading && <progress className="testpoint-importer-progress" max={totalPages || 1} value={loadedPages} aria-label="Loading MCQ source pages" />}
      {failedPages.length > 0 && <p className="testpoint-importer-warning">Could not load source pages: {failedPages.join(", ")}. Use “Reload all pages” to retry.</p>}

      {questions.length > 0 && <>
        <div className="testpoint-importer-toolbar">
          <label className="testpoint-importer-search"><Search size={15} aria-hidden="true" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search Urdu Adab questions and explanations" /></label>
          <span>{questions.length} loaded · {selected.length} selected</span>
          <div className="testpoint-importer-actions">
            <button type="button" className="text-link" onClick={selectAll}>Select all {questions.length}</button>
            <button type="button" className="button button-light" disabled={!selectedQuestions.length} onClick={() => void copySelected()}><ClipboardCopy size={14} aria-hidden="true" />Copy selected</button>
            <button type="button" className="button button-primary" disabled={!selectedQuestions.length} onClick={() => onSendToBulk(formatBulkText(selectedQuestions))}><Check size={14} aria-hidden="true" />Send selected to bulk editor</button>
          </div>
        </div>

        <div className="testpoint-importer-list-wrap">
          <table className="testpoint-importer-list">
            <thead><tr><th><input type="checkbox" aria-label="Select all MCQs on this page" checked={visibleQuestions.pageItems.length > 0 && visibleQuestions.pageItems.every((question) => selected.includes(question.sourceId))} onChange={toggleVisible} /></th><th>MCQ · OPTIONS · EXPLANATION</th><th>ANSWER</th></tr></thead>
            <tbody>{visibleQuestions.pageItems.map((question, index) => <tr key={question.sourceId}>
              <td><input type="checkbox" aria-label={`Select source MCQ ${question.sourceId}`} checked={selected.includes(question.sourceId)} onChange={() => toggleOne(question.sourceId)} /></td>
              <td><article className="testpoint-importer-question"><div className="testpoint-importer-prompt"><strong>{(page - 1) * PAGE_SIZE + index + 1}.</strong><LocalizedText>{question.prompt}</LocalizedText></div><ol type="A">{question.choices.map((choice, choiceIndex) => <li key={labels[choiceIndex]} className={question.correctChoice === labels[choiceIndex] ? "is-correct" : ""}><span>{labels[choiceIndex]})</span><LocalizedText>{choice}</LocalizedText></li>)}</ol><details><summary>Explanation</summary><p dir="auto"><LocalizedText>{question.explanation || "No explanation was provided on the source page."}</LocalizedText></p></details><a href={question.sourceUrl} target="_blank" rel="noreferrer" className="testpoint-importer-source-link">View source MCQ</a></article></td>
              <td><span className="testpoint-importer-answer">{question.correctChoice}</span></td>
            </tr>)}</tbody>
          </table>
          {!visibleQuestions.pageItems.length && <p className="admin-empty-state">No imported MCQs match this search.</p>}
        </div>
        <nav className="testpoint-importer-pagination" aria-label="Imported MCQs pages"><button type="button" className="button button-light" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={15} aria-hidden="true" />Previous</button><span>Page {page} of {visibleQuestions.pageCount}</span><button type="button" className="button button-light" disabled={page >= visibleQuestions.pageCount} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight size={15} aria-hidden="true" /></button></nav>
      </>}

      {!questions.length && !loading && <p className="testpoint-importer-empty">Load the source to view its MCQs. Nothing is saved to your MCQ bank until you review and submit it in the bulk editor.</p>}
      {totalPages > 0 && <small className="testpoint-importer-attribution">Source: testpointpk.com/subcategory-mcqs/urdu-adab · {totalPages} pages detected</small>}
    </section>
  );
}
