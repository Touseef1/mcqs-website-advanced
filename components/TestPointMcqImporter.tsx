"use client";

import { useMemo, useState } from "react";
import { Check, ClipboardCopy, Download, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { LocalizedText } from "@/components/LocalizedText";
import { SitePagination } from "@/components/SitePagination";
import { getErrorMessage } from "@/lib/error-message";
import { notify } from "@/lib/toast";

type ExternalMcq = { sourceId: string; sourceUrl: string; prompt: string; choices: [string, string, string, string]; correctChoice: "A" | "B" | "C" | "D"; explanation: string };
type AdminPaperOption = { id: number; title: string; status: string };
type PageResponse = { page: number; totalPages: number; questions: ExternalMcq[]; error?: string };
type Props = { papers: AdminPaperOption[]; initialPaperIds?: number[]; onSendToBulk: (text: string, paperIds: number[]) => void };

const labels = ["A", "B", "C", "D"] as const;
const DEFAULT_SOURCE = "https://testpointpk.com/subcategory-mcqs/urdu-adab";

function formatBulkText(questions: ExternalMcq[]) {
  return questions.map((question) => [`Q: ${question.prompt}`, ...question.choices.map((choice, index) => `${labels[index]}) ${choice}`), `Answer: ${question.correctChoice}`, ...(question.explanation ? [`Explanation: ${question.explanation.replace(/\n+/g, "\n")}`] : [])].join("\n")).join("\n\n");
}
function normalize(value: string) { return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim(); }
function duplicateKey(question: ExternalMcq) { return `${normalize(question.prompt)}|${question.choices.map(normalize).sort().join("|")}`; }

async function getPage(sourceUrl: string, page: number): Promise<PageResponse> {
  const query = new URLSearchParams({ url: sourceUrl, page: String(page) });
  const response = await fetch(`/api/admin/external-mcqs/testpoint?${query.toString()}`, { cache: "no-store" });
  const body = await response.json().catch(() => null) as PageResponse | null;
  if (!response.ok || !body) throw new Error(body?.error || `Could not load source page ${page}.`);
  return body;
}

export function TestPointMcqImporter({ papers, initialPaperIds = [], onSendToBulk }: Props) {
  const [sourceUrl, setSourceUrl] = useState(DEFAULT_SOURCE);
  const [questions, setQuestions] = useState<ExternalMcq[]>([]);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedPaperIds, setSelectedPaperIds] = useState<number[]>(initialPaperIds);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"unique" | "duplicates">("unique");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [loadedPages, setLoadedPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [taxonomyBusy, setTaxonomyBusy] = useState(false);
  const [failedPages, setFailedPages] = useState<number[]>([]);
  const [taxonomyMessage, setTaxonomyMessage] = useState("");

  const duplicateIds = useMemo(() => {
    const seen = new Set<string>(); const duplicates = new Set<string>();
    for (const question of questions) { const key = duplicateKey(question); if (seen.has(key)) duplicates.add(question.sourceId); else seen.add(key); }
    return duplicates;
  }, [questions]);
  const duplicateQuestions = useMemo(() => questions.filter((question) => duplicateIds.has(question.sourceId) && !excludedIds.includes(question.sourceId)), [questions, duplicateIds, excludedIds]);
  const uniqueQuestions = useMemo(() => questions.filter((question) => !duplicateIds.has(question.sourceId) && !excludedIds.includes(question.sourceId)), [questions, duplicateIds, excludedIds]);
  const tabItems = tab === "duplicates" ? duplicateQuestions : uniqueQuestions;
  const visibleQuestions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const filtered = term ? tabItems.filter((question) => `${question.prompt} ${question.choices.join(" ")} ${question.explanation}`.toLocaleLowerCase().includes(term)) : tabItems;
    return { pageItems: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, pageCount: Math.max(1, Math.ceil(filtered.length / pageSize)) };
  }, [tabItems, search, page, pageSize]);
  const selectedQuestions = useMemo(() => { const ids = new Set(selected); return uniqueQuestions.filter((question) => ids.has(question.sourceId)); }, [uniqueQuestions, selected]);
  const activePapers = useMemo(() => papers.filter((paper) => paper.status !== "archived"), [papers]);

  async function loadAllPages() {
    setLoading(true); setFailedPages([]); setLoadedPages(0); setQuestions([]); setExcludedIds([]); setSelected([]); setPage(1);
    try {
      const firstPage = await getPage(sourceUrl.trim(), 1);
      const merged = new Map(firstPage.questions.map((question) => [question.sourceId, question]));
      setTotalPages(firstPage.totalPages); setLoadedPages(1);
      const pending = Array.from({ length: Math.max(0, firstPage.totalPages - 1) }, (_, index) => index + 2);
      const failures: number[] = []; let cursor = 0;
      const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
        while (cursor < pending.length) {
          const sourcePage = pending[cursor++];
          try { (await getPage(sourceUrl.trim(), sourcePage)).questions.forEach((question) => merged.set(question.sourceId, question)); }
          catch { failures.push(sourcePage); }
          finally { setLoadedPages((count) => count + 1); }
        }
      });
      await Promise.all(workers);
      const list = [...merged.values()]; setQuestions(list); setFailedPages(failures.sort((a, b) => a - b));
      if (failures.length) notify.error(`${list.length} MCQs loaded. ${failures.length} source pages failed; reload to retry.`);
      else notify.success(`Loaded ${list.length} MCQs from ${firstPage.totalPages} pages.`);
    } catch (error) { notify.error(getErrorMessage(error, "Could not load MCQs from TestPoint.")); }
    finally { setLoading(false); }
  }

  async function importTaxonomy() {
    setTaxonomyBusy(true); setTaxonomyMessage("");
    try {
      const response = await fetch("/api/admin/external-mcqs/testpoint", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: sourceUrl.trim() }) });
      const result = await response.json().catch(() => null) as { createdSubjects?: number; createdTopics?: number; skippedExisting?: number; error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Could not import TestPoint categories.");
      const message = `Created ${result?.createdSubjects ?? 0} subjects and ${result?.createdTopics ?? 0} categories as drafts. ${result?.skippedExisting ?? 0} existing records skipped.`;
      setTaxonomyMessage(message); notify.success(message);
    } catch (error) { notify.error(getErrorMessage(error, "Could not import TestPoint categories.")); }
    finally { setTaxonomyBusy(false); }
  }

  function toggleOne(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function toggleVisible() {
    const ids = visibleQuestions.pageItems.filter((question) => !duplicateIds.has(question.sourceId)).map((question) => question.sourceId);
    const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id));
    setSelected((current) => allSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]);
  }
  function removeFromImport(id: string) { setExcludedIds((current) => [...new Set([...current, id])]); setSelected((current) => current.filter((item) => item !== id)); }
  function togglePaper(id: number) { setSelectedPaperIds((current) => current.includes(id) ? current.filter((paperId) => paperId !== id) : [...current, id]); }

  async function copySelected() {
    if (!selectedQuestions.length) return;
    try { await navigator.clipboard.writeText(formatBulkText(selectedQuestions)); notify.success(`Copied ${selectedQuestions.length} MCQs with answers and explanations.`); }
    catch (error) { notify.error(getErrorMessage(error, "Clipboard access was blocked. Use the bulk editor button instead.")); }
  }

  return <section className="testpoint-importer" aria-label="TestPoint MCQ importer">
    <header className="testpoint-importer-header"><div><span className="eyebrow">SUPER ADMIN · SOURCE IMPORTER</span><h3>Import from TestPoint</h3><p>Enter a public subject or subcategory URL. MCQs stay drafts until reviewed and published.</p></div></header>
    <div className="testpoint-importer-source-row"><label htmlFor="testpoint-source-url">TestPoint category URL<input id="testpoint-source-url" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://testpointpk.com/subcategory-mcqs/…" /></label><button type="button" className="button button-primary" onClick={() => void loadAllPages()} disabled={loading || !sourceUrl.trim()}>{loading ? <LoaderCircle size={15} className="testpoint-spinner" aria-hidden="true" /> : questions.length ? <RefreshCw size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{loading ? `Loading ${loadedPages}/${totalPages || "…"}` : "Load all MCQs"}</button><button type="button" className="button button-light" onClick={() => void importTaxonomy()} disabled={taxonomyBusy || !sourceUrl.trim()}>{taxonomyBusy ? <LoaderCircle size={15} className="testpoint-spinner" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}Import subjects & categories</button></div>
    <small className="testpoint-importer-help">For taxonomy, use TestPoint’s all-categories page or a subject URL such as <code>/important-mcqs/maths-mcqs</code>. Imported records are drafts.</small>
    {taxonomyMessage && <p className="testpoint-importer-success" role="status">{taxonomyMessage}</p>}
    <fieldset className="testpoint-importer-papers"><legend>Attach every imported MCQ to papers (optional)</legend><button type="button" className="text-link" onClick={() => setSelectedPaperIds(selectedPaperIds.length === activePapers.length ? [] : activePapers.map((paper) => paper.id))}>{selectedPaperIds.length === activePapers.length ? "Clear paper selection" : "Select all active papers"}</button><div>{activePapers.map((paper) => <label key={paper.id}><input type="checkbox" checked={selectedPaperIds.includes(paper.id)} onChange={() => togglePaper(paper.id)} />{paper.title}</label>)}</div><small>{selectedPaperIds.length} papers selected. The server checks every selected paper before saving.</small></fieldset>
    {loading && <progress className="testpoint-importer-progress" max={totalPages || 1} value={loadedPages} aria-label="Loading MCQ source pages" />}
    {failedPages.length > 0 && <p className="testpoint-importer-warning">Could not load source pages: {failedPages.join(", ")}. Reload to retry.</p>}
    {questions.length > 0 && <>
      <div className="testpoint-importer-toolbar"><label className="testpoint-importer-search"><Search size={15} aria-hidden="true" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search questions and explanations" /></label><span>{uniqueQuestions.length} unique · {duplicateQuestions.length} duplicates · {selected.length} selected</span><div className="testpoint-importer-actions"><button type="button" className="text-link" onClick={() => setSelected(uniqueQuestions.map((question) => question.sourceId))}>Select unique MCQs</button><button type="button" className="button button-light" disabled={!selectedQuestions.length} onClick={() => void copySelected()}><ClipboardCopy size={14} aria-hidden="true" />Copy selected</button><button type="button" className="button button-primary" disabled={!selectedQuestions.length} onClick={() => onSendToBulk(formatBulkText(selectedQuestions), selectedPaperIds)}><Check size={14} aria-hidden="true" />Send unique selection to bulk editor</button></div></div>
      <div className="testpoint-importer-tabs" role="tablist" aria-label="Imported MCQ lists"><button type="button" role="tab" aria-selected={tab === "unique"} onClick={() => { setTab("unique"); setPage(1); }}>Unique MCQs ({uniqueQuestions.length})</button><button type="button" role="tab" aria-selected={tab === "duplicates"} onClick={() => { setTab("duplicates"); setPage(1); }}>Duplicate MCQs ({duplicateQuestions.length})</button></div>
      <div className="testpoint-importer-list-wrap"><table className="testpoint-importer-list"><thead><tr><th><input type="checkbox" aria-label="Select MCQs on this page" checked={visibleQuestions.pageItems.length > 0 && visibleQuestions.pageItems.filter((question) => !duplicateIds.has(question.sourceId)).every((question) => selected.includes(question.sourceId))} onChange={toggleVisible} /></th><th>MCQ · OPTIONS · EXPLANATION</th><th>ANSWER</th>{tab === "duplicates" && <th>ACTION</th>}</tr></thead><tbody>{visibleQuestions.pageItems.map((question, index) => <tr key={question.sourceId} className={duplicateIds.has(question.sourceId) ? "is-duplicate" : ""}><td><input type="checkbox" aria-label={`Select source MCQ ${question.sourceId}`} checked={selected.includes(question.sourceId)} disabled={duplicateIds.has(question.sourceId)} onChange={() => toggleOne(question.sourceId)} /></td><td><article className="testpoint-importer-question"><div className="testpoint-importer-prompt"><strong>{(page - 1) * pageSize + index + 1}.</strong><LocalizedText>{question.prompt}</LocalizedText>{duplicateIds.has(question.sourceId) && <span className="testpoint-duplicate-badge">Duplicate</span>}</div><ol type="A">{question.choices.map((choice, choiceIndex) => <li key={labels[choiceIndex]} className={question.correctChoice === labels[choiceIndex] ? "is-correct" : ""}><span>{labels[choiceIndex]})</span><LocalizedText>{choice}</LocalizedText></li>)}</ol><details><summary>Explanation</summary><p dir="auto"><LocalizedText>{question.explanation || "No explanation was provided on the source page."}</LocalizedText></p></details><a href={question.sourceUrl} target="_blank" rel="noreferrer" className="testpoint-importer-source-link">View source MCQ</a></article></td><td><span className="testpoint-importer-answer">{question.correctChoice}</span></td>{tab === "duplicates" && <td><button type="button" className="text-link text-danger" onClick={() => removeFromImport(question.sourceId)}>Remove from import</button></td>}</tr>)}</tbody></table>{!visibleQuestions.pageItems.length && <p className="admin-empty-state">No imported MCQs match this list and search.</p>}</div>
      <SitePagination page={page} pageCount={visibleQuestions.pageCount} pageSize={pageSize} total={visibleQuestions.total} disabled={loading} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} itemLabel="MCQs" ariaLabel="Imported MCQ pages" className="testpoint-importer-pagination" />
    </>}
    {!questions.length && !loading && <p className="testpoint-importer-empty">Load the public source URL to review its MCQs. Nothing is saved until you submit rows through the bulk editor.</p>}
    {totalPages > 0 && <small className="testpoint-importer-attribution">Source: {sourceUrl} · {totalPages} pages detected</small>}
  </section>;
}
