"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { LocalizedText } from "@/components/LocalizedText";
import { RichText } from "@/components/RichText";
import { TestPointMcqImporter } from "@/components/TestPointMcqImporter";
import { Archive, Bookmark, Eye, Filter, Info, Link2, Pencil, Plus, Search, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import { containsUrduScript, detectQuestionLanguage } from "@/lib/language";
import { useConfirmModal } from "@/components/ConfirmModal";
import { ApiResponseError, ConfirmationCancelledError, getErrorMessage, isConfirmationCancelled, parseApiResponse } from "@/lib/error-message";
import { notify as toastNotify } from "@/lib/toast";
import { richTextToPlainText } from "@/lib/rich-text";
import { SitePagination } from "@/components/SitePagination";

type Status = "draft" | "in_review" | "approved" | "published" | "rejected" | "archived";
type Topic = { id: number; subject_id: number; subject_name: string; name: string; status: Status };
type Paper = { id: number; examId: number; examName: string; title: string; slug: string; year: number; type: "Past paper" | "Model paper" | "Mock test"; description: string; status: Status; questionCount: number; questionIds: number[] };
type Choice = { label: string; text: string; imageUrl?: string | null };
type Question = { id: number; topicId: number; topicName: string; subjectName: string; prompt: string; questionImageUrl?: string | null; explanation: string; sourceNote: string; correctChoice: string; difficulty: "easy" | "medium" | "hard"; language: "en" | "ur"; authorName?: string; status: Status; version: number; reviewNote?: string | null; createdBy?: number | string; paperIds: number[]; choices: Choice[] };
type DraftQuestion = { prompt: string; choices: string[]; correctChoice: string; explanation: string; language: "en" | "ur"; questionImageUrl?: string | null; choiceImageUrls?: Array<string | null> };
type PreviewRow = DraftQuestion & { rowNumber: number; errors: string[] };
type ExistingQuestionMatch = { id: number; prompt: string; status: Status; topicId: number; topicName: string; subjectName: string; attachedPaperIds: number[]; similarity?: number; exact?: boolean };
type BulkExistingMatch = ExistingQuestionMatch;
type Props = { topics: Topic[]; papers: Paper[]; canManagePapers: boolean; canAddQuestionsToPapers: boolean; canQuickCreatePaper: boolean; canPublish: boolean; canDirectPublish: boolean; isSuperAdmin: boolean; canDelete: boolean; canCreateMcqs: boolean; canReviewMcqs: boolean; canEditOwnMcqs: boolean; canEditAnyMcqs: boolean; currentUserId: string; initialPaperId: number | null; initialSearch?: string; initialStatus?: string; startInBank?: boolean; onUpdated: () => Promise<void> };

const emptyDraft: DraftQuestion = { prompt: "", choices: ["", "", "", ""], correctChoice: "", explanation: "", language: "en", questionImageUrl: null, choiceImageUrls: [null, null, null, null] };
const questionLabels = ["A", "B", "C", "D"] as const;
const contextStorageKey = "mcqpath:question-entry-context";
const sessionIdsKey = "mcqpath:question-entry-session-ids";
const sessionCountKey = "mcqpath:question-entry-session-count";
const ExplanationEditor = dynamic(() => import("@/components/ExplanationEditor").then((module) => module.ExplanationEditor), { ssr: false });

function StatusBadge({ status }: { status: Status }) {
  return <span className={`admin-status admin-status-${status}`}>{status.replace("_", " ")}</span>;
}

async function adminRequest<T = Record<string, unknown>>(path: string, method = "GET", body?: unknown, confirm?: ReturnType<typeof useConfirmModal>): Promise<T> {
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
    const paperNames = (data.affectedPapers as Array<{ title?: string }>).map((paper) => paper.title).filter(Boolean).join("\n• ");
    let confirmedResult: unknown;
    const accepted = await confirm({
      title: "Remove MCQ from published papers?",
      message: `${getErrorMessage(data, "This change affects published papers.")}\n\nAffected papers:\n• ${paperNames}`,
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

function validateDraft(row: DraftQuestion) {
  const errors: string[] = [];
  if (row.prompt.trim().length < 8) errors.push("Question needs at least 8 characters.");
  if (row.choices.some((choice) => !choice.trim())) errors.push("Enter all four options.");
  const normalized = row.choices.map((choice) => choice.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) errors.push("Options must be different.");
  if (!(questionLabels as readonly string[]).includes(row.correctChoice)) errors.push("Choose one correct option.");
  return errors;
}

function parseTextBlocks(text: string): PreviewRow[] {
  const blocks = text.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block, blockIndex) => {
    const row: PreviewRow = { ...emptyDraft, choices: ["", "", "", ""], rowNumber: blockIndex + 1, errors: [] };
    let explanationLines: string[] = [];
    let readingExplanation = false;
    for (const rawLine of block.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const option = line.match(/^([A-D])\s*[).:\-]\s*(.*)$/i);
      if (option) {
        row.choices[option[1].toUpperCase().charCodeAt(0) - 65] = option[2].trim();
        readingExplanation = false;
        continue;
      }
      const answer = line.match(/^(?:answer|correct(?:\s+answer)?)\s*[:=\-]\s*([A-D])\b/i);
      if (answer) {
        row.correctChoice = answer[1].toUpperCase();
        readingExplanation = false;
        continue;
      }
      const explanation = line.match(/^(?:explanation|reason)\s*[:=]\s*(.*)$/i);
      if (explanation) {
        explanationLines = explanation[1] ? [explanation[1]] : [];
        readingExplanation = true;
        continue;
      }
      const prompt = line.match(/^(?:q(?:uestion)?)\s*[:=]\s*(.*)$/i);
      if (prompt && !row.prompt) {
        row.prompt = prompt[1].trim();
        readingExplanation = false;
        continue;
      }
      if (readingExplanation) explanationLines.push(line);
      else if (!row.prompt) row.prompt = line.replace(/^q\s*[:.)-]?\s*/i, "").trim();
      else row.errors.push(`Unrecognized line: ${line.slice(0, 60)}`);
    }
    row.explanation = explanationLines.join(" ").trim();
    row.errors.push(...validateDraft(row));
    return row;
  });
}

function parseCsv(text: string): PreviewRow[] {
  const values: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell.trim());
      if (row.some(Boolean)) values.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) values.push(row);
  if (!values.length) return [];
  const header = values[0].map((value) => value.trim().toLowerCase().replace(/[^a-z]/g, ""));
  const headerNames = ["question", "prompt", "q", "a", "optiona", "b", "optionb", "c", "optionc", "d", "optiond", "answer", "correctanswer", "explanation"];
  const hasQuestionHeader = ["question", "prompt", "q"].includes(header[0] ?? "");
  const hasAnswerHeader = header.some((value) => ["answer", "correctanswer"].includes(value));
  const hasHeader = hasQuestionHeader || (hasAnswerHeader && header.some((value) => headerNames.includes(value)));
  const indices = hasHeader ? {
    prompt: header.findIndex((value) => ["question", "prompt", "q"].includes(value)),
    a: header.findIndex((value) => ["a", "optiona"].includes(value)),
    b: header.findIndex((value) => ["b", "optionb"].includes(value)),
    c: header.findIndex((value) => ["c", "optionc"].includes(value)),
    d: header.findIndex((value) => ["d", "optiond"].includes(value)),
    answer: header.findIndex((value) => ["answer", "correctanswer"].includes(value)),
    explanation: header.indexOf("explanation"),
  } : { prompt: 0, a: 1, b: 2, c: 3, d: 4, answer: 5, explanation: 6 };
  const data = values.slice(hasHeader ? 1 : 0);
  return data.map((valuesRow, index) => {
    const get = (column: number) => column >= 0 ? valuesRow[column] ?? "" : "";
    const answer = get(indices.answer).trim().toUpperCase().match(/[A-D]/)?.[0] ?? "";
    const item: PreviewRow = {
      rowNumber: index + 1,
      prompt: get(indices.prompt),
      choices: [get(indices.a), get(indices.b), get(indices.c), get(indices.d)],
      correctChoice: answer,
      explanation: get(indices.explanation),
      language: "en",
      errors: [],
    };
    item.errors.push(...validateDraft(item));
    return item;
  });
}

function canPublishQuestion(status: Status, canPublish: boolean, canDirectPublish: boolean) {
  if (!canPublish || status === "archived" || status === "published") return false;
  if (status === "approved") return true;
  return canDirectPublish && (status === "draft" || status === "in_review" || status === "rejected");
}

function ReviewDecision({ questionId, compact, onDecide }: { questionId: number; compact?: boolean; onDecide: (action: "approve" | "reject", reviewNote: string) => void }) {
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState("");
  function decide(action: "approve" | "reject") {
    const reviewNote = note.trim();
    if (!reviewNote) {
      setLocalError(action === "approve" ? "Add a review comment before approving." : "Add a reason before rejecting.");
      return;
    }
    setLocalError("");
    onDecide(action, reviewNote);
  }
  return <div className="mcq-review-actions">
    <input aria-label={`Review comment for MCQ ${questionId}`} value={note} maxLength={2000} placeholder="Review comment" onChange={(event) => setNote(event.target.value)} />
    <div className="mcq-review-buttons"><button type="button" className={compact ? "text-link" : "button button-primary"} onClick={() => decide("approve")}>Approve</button><button type="button" className={compact ? "text-link" : "button button-light"} onClick={() => decide("reject")}>Reject</button></div>
    {localError && <small className="form-error">{localError}</small>}
  </div>;
}

function SearchPicker({ id, label, value, options, placeholder, onChange, action }: { id: string; label: string; value: string; options: Array<{ value: string; label: string; meta?: string }>; placeholder: string; onChange: (value: string) => void; action?: { label: string; onClick: () => void } }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const shown = options.filter((option) => `${option.label} ${option.meta ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 60);
  return <div className="mcq-picker" onBlur={() => window.setTimeout(() => setOpen(false), 120)}>
    <label htmlFor={id}>{label}</label>
    <input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list" value={open ? query : selected?.label ?? ""} placeholder={placeholder} onFocus={() => { setQuery(""); setOpen(true); }} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "Enter" && shown[0]) { event.preventDefault(); onChange(shown[0].value); setQuery(""); setOpen(false); } }} />
    {open && <div id={`${id}-options`} role="listbox" className="mcq-picker-options">
      {action && <button type="button" role="option" aria-selected="false" className="mcq-picker-action" onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(false); action.onClick(); }}>{action.label}</button>}
      {value && <button type="button" role="option" aria-selected="false" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setQuery(""); setOpen(false); }}>No selection</button>}
      {shown.map((option) => <button type="button" role="option" aria-selected={option.value === value} key={option.value} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option.value); setQuery(""); setOpen(false); }}><span>{option.label}</span>{option.meta && <small>{option.meta}</small>}</button>)}
      {!shown.length && <small className="mcq-picker-empty">No matching results.</small>}
    </div>}
  </div>;
}

function BulkPreviewTable({ rows, matches, selectedPaperIds, onRemove, onPreview }: {
  rows: PreviewRow[];
  matches: Record<number, BulkExistingMatch>;
  selectedPaperIds: number[];
  onRemove: (row: number) => void;
  onPreview: (id: number) => void;
}) {
  return <div className="mcq-preview-wrap">
    <div className="admin-panel-heading"><div>
      <h4>Preview · {rows.filter((row) => !row.errors.length).length} valid / {rows.length} rows{Object.keys(matches).length ? ` · ${Object.keys(matches).length} matches across topics` : ""}</h4>
      <p>{selectedPaperIds.length ? "Exact matches are skipped and linked to the selected paper. Similar questions are flagged for review. Paper imports remain limited to 100 rows." : "Exact matches from any topic are skipped. Similar questions are flagged; remove unwanted variants before importing. Category-only imports have no 100-question cap."}</p>
    </div></div>
    <div className="mcq-preview-table-wrap"><table className="mcq-preview-table">
      <thead><tr><th>Row</th><th>Question</th><th>Options</th><th>Answer</th><th>Validation / Existing MCQ</th><th>Action</th></tr></thead>
      <tbody>{rows.map((row) => {
        const match = matches[row.rowNumber];
        const alreadyLinked = Boolean(match && selectedPaperIds.length && selectedPaperIds.every((id) => match.attachedPaperIds.includes(id)));
        return <tr key={row.rowNumber} className={row.errors.length ? "has-errors" : match ? "has-existing-match" : ""}>
          <td>{row.rowNumber}</td>
          <td><LocalizedText>{row.prompt}</LocalizedText></td>
          <td>{row.choices.map((choice, index) => <span key={index}>{questionLabels[index]}) <LocalizedText>{choice}</LocalizedText>{index < row.choices.length - 1 ? " · " : ""}</span>)}</td>
          <td>{row.correctChoice}</td>
          <td>{row.errors.length ? row.errors.join(" ") : match ? <><div className="mcq-existing-match-heading"><strong>{match.exact ? "Exact duplicate" : `Possible match · ${match.similarity ?? 0}% similar`} · MCQ #{match.id}</strong><button type="button" className="mcq-icon-action" aria-label={`View existing MCQ ${match.id}`} title="View existing MCQ details" onClick={() => onPreview(match.id)}><Info size={16} aria-hidden="true" /></button></div><small>{match.subjectName} › {match.topicName} · {match.status.replace("_", " ")}{match.exact ? alreadyLinked ? " · already in selected paper" : selectedPaperIds.length ? " · will link without creating a copy" : " · duplicate will be skipped" : " · review before importing this variant"}</small></> : "Ready to create"}</td>
          <td><button type="button" className="mcq-icon-action mcq-icon-action-danger" aria-label={`Remove row ${row.rowNumber}`} title={`Remove row ${row.rowNumber}`} onClick={() => onRemove(row.rowNumber)}><Trash2 size={16} aria-hidden="true" /></button></td>
        </tr>;
      })}</tbody>
    </table></div>
  </div>;
}

export function AdminQuestionWorkspace({ topics, papers, canManagePapers, canAddQuestionsToPapers, canQuickCreatePaper, canPublish, canDirectPublish, isSuperAdmin, canDelete, canCreateMcqs, canReviewMcqs, canEditOwnMcqs, canEditAnyMcqs, currentUserId, initialPaperId, initialSearch = "", initialStatus = "all", startInBank = false, onUpdated }: Props) {
  const [mode, setMode] = useState<"quick" | "bulk" | "bank">(startInBank || !canCreateMcqs ? "bank" : "quick");
  const [paperOptions, setPaperOptions] = useState(papers);
  const [contextRestored, setContextRestored] = useState(false);
  const [topicId, setTopicId] = useState("");
  const [paperId, setPaperId] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [sourceNote, setSourceNote] = useState("");
  const [draft, setDraft] = useState<DraftQuestion>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBaseline, setEditBaseline] = useState<Question | null>(null);
  const [editingStatus, setEditingStatus] = useState<Status>("draft");
  const [editingVersion, setEditingVersion] = useState(1);
  const [editingPaperIds, setEditingPaperIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const [similar, setSimilar] = useState<ExistingQuestionMatch[]>([]);
  const [sessionQuestions, setSessionQuestions] = useState<Question[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [bankQuestions, setBankQuestions] = useState<Question[]>([]);
  const [bankSearch, setBankSearch] = useState(initialSearch);
  const [bankStatus, setBankStatus] = useState(initialStatus);
  const [bankTopic, setBankTopic] = useState("");
  const [bankAuthor, setBankAuthor] = useState("");
  const [bankSource, setBankSource] = useState("");
  const [bankLanguage, setBankLanguage] = useState("");
  const [reviewFiltersOpen, setReviewFiltersOpen] = useState(false);
  const [bankFiltersOpen, setBankFiltersOpen] = useState(false);
  const [savedViewsOpen, setSavedViewsOpen] = useState(false);
  const [bankDensity, setBankDensity] = useState<"comfortable" | "compact">("compact");
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null);
  const [previewQuestionTitle, setPreviewQuestionTitle] = useState("LEARNER PREVIEW");
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const [savedViews, setSavedViews] = useState<Array<{ name: string; status: string; topic: string; author: string; source: string; language: string }>>([]);
  const [savedViewName, setSavedViewName] = useState("");
  const [bankPage, setBankPage] = useState(1);
  const [bankPageSize, setBankPageSize] = useState(25);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankLoading, setBankLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkTopicId, setBulkTopicId] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [externalImporterOpen, setExternalImporterOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<PreviewRow[]>([]);
  const [existingBulkMatches, setExistingBulkMatches] = useState<Record<number, BulkExistingMatch>>({});
  const [matchingBulkRows, setMatchingBulkRows] = useState(false);
  const [bulkPaperIds, setBulkPaperIds] = useState<number[] | null>(null);
  const [csvFileName, setCsvFileName] = useState("");
  const [newPaperOpen, setNewPaperOpen] = useState(false);
  const [newPaperBusy, setNewPaperBusy] = useState(false);
  const [newPaperError, setNewPaperError] = useState("");
  const [newPaper, setNewPaper] = useState({ examName: "", title: "", year: String(new Date().getFullYear()) });
  const [showQuestionImage, setShowQuestionImage] = useState(false);
  const [openChoiceImages, setOpenChoiceImages] = useState<boolean[]>([false, false, false, false]);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const confirm = useConfirmModal();
  const canUsePapers = canAddQuestionsToPapers;

  async function previewExistingQuestion(id: number) {
    setPreviewLoadingId(id);
    try {
      const result = await adminRequest<{ question?: Question }>("/api/admin/questions/similar", "POST", { action: "details", questionId: id });
      if (!result.question) throw new Error("The existing MCQ could not be found or is not available to your role.");
      setPreviewQuestionTitle("EXISTING MCQ DETAILS");
      setPreviewQuestion(result.question);
    } catch (cause) {
      const message = getErrorMessage(cause, "Could not load the existing MCQ details.");
      setError(message);
      toastNotify.error(message);
    } finally {
      setPreviewLoadingId(null);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setBankSearch(initialSearch);
      setBankStatus(initialStatus);
      if (startInBank) setMode("bank");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initialSearch, initialStatus, startInBank]);


  const topicOptions = useMemo(() => topics.filter((topic) => topic.status !== "archived").map((topic) => ({ value: String(topic.id), label: `${topic.subject_name} › ${topic.name}`, meta: topic.status })), [topics]);
  const paperPickerOptions = useMemo(() => paperOptions.filter((paper) => paper.status !== "archived").map((paper) => ({ value: String(paper.id), label: paper.title, meta: `${paper.examName} · ${paper.year} · ${paper.status}` })), [paperOptions]);
  const bankPages = Math.max(1, Math.ceil(bankTotal / bankPageSize));
  const reviewQueueView = canReviewMcqs && ["in_review", "approved", "rejected"].includes(bankStatus);
  const reviewFilterCount = [bankAuthor.trim(), bankSource.trim(), bankLanguage].filter(Boolean).length;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored: unknown = JSON.parse(localStorage.getItem(`mcqpath:bank-views:${currentUserId}`) ?? "[]");
        if (Array.isArray(stored)) setSavedViews(stored.filter((item) => item && typeof item.name === "string").slice(0, 12));
      } catch { setSavedViews([]); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentUserId]);

  function saveCurrentView() {
    const name = savedViewName.trim().slice(0, 40);
    if (!name) return;
    const next = [{ name, status: bankStatus, topic: bankTopic, author: bankAuthor, source: bankSource, language: bankLanguage }, ...savedViews.filter((view) => view.name !== name)].slice(0, 12);
    setSavedViews(next); setSavedViewName("");
    try { localStorage.setItem(`mcqpath:bank-views:${currentUserId}`, JSON.stringify(next)); } catch { toastNotify.error("Saved views could not be stored in this browser."); }
  }

  function applySavedView(view: typeof savedViews[number]) {
    setBankStatus(view.status); setBankTopic(view.topic); setBankAuthor(view.author); setBankSource(view.source); setBankLanguage(view.language); setBankPage(1);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => setPaperOptions((current) => {
      const serverIds = new Set(papers.map((paper) => paper.id));
      const pending = current.filter((paper) => !serverIds.has(paper.id));
      return pending.length ? [...pending, ...papers] : papers;
    }), 0);
    return () => window.clearTimeout(timeout);
  }, [papers]);

  const contextBootstrapped = useRef(false);
  const paperSelectionLocked = useRef(false);
  useEffect(() => {
    if (contextBootstrapped.current) return;
    const waitingForPaper = Boolean(initialPaperId) && !paperPickerOptions.some((option) => option.value === String(initialPaperId));
    const listsReady = topicOptions.length > 0 || paperPickerOptions.length > 0;
    if (waitingForPaper || !listsReady) return;
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      if (!active || contextBootstrapped.current) return;
      contextBootstrapped.current = true;
      try {
        const context = JSON.parse(localStorage.getItem(`${contextStorageKey}:${window.location.pathname}`) ?? "null") as { topicId?: string; paperId?: string; difficulty?: string; sourceNote?: string } | null;
        const explicitPaper = initialPaperId ? paperOptions.find((paper) => paper.id === initialPaperId) : undefined;
        if (context) {
          if (context.topicId && topicOptions.some((option) => option.value === context.topicId)) setTopicId(context.topicId);
          if (context.difficulty === "easy" || context.difficulty === "medium" || context.difficulty === "hard") setDifficulty(context.difficulty);
          if (!explicitPaper && typeof context.sourceNote === "string") setSourceNote(context.sourceNote);
        }
        if (explicitPaper) {
          paperSelectionLocked.current = true;
          setPaperId(String(explicitPaper.id));
          setSourceNote(`${explicitPaper.examName} ${explicitPaper.year} Past Paper`);
          if (!startInBank) setMode("quick");
        } else if (!paperSelectionLocked.current && context?.paperId && paperPickerOptions.some((option) => option.value === context.paperId)) {
          setPaperId(context.paperId);
        }
        const ids = JSON.parse(sessionStorage.getItem(sessionIdsKey) ?? "[]") as number[];
        const count = Number(sessionStorage.getItem(sessionCountKey) ?? 0);
        if (Number.isFinite(count) && count >= 0) setSessionCount(Math.floor(count));
        if (Array.isArray(ids) && ids.some((id) => Number.isSafeInteger(id) && id > 0)) {
          const validIds = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(-100);
          adminRequest<{ questions: Question[] }>(`/api/admin/questions?ids=${validIds.join(",")}`).then((result) => { if (active) setSessionQuestions(result.questions ?? []); }).catch((cause) => { if (active) toastNotify.error(getErrorMessage(cause, "Could not load recently added questions.")); });
        }
      } catch { /* Ignore malformed local session state. */ }
      setContextRestored(true);
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [topicOptions, paperPickerOptions, initialPaperId, paperOptions, startInBank]);

  useEffect(() => {
    if (!contextRestored) return;
    try {
      localStorage.setItem(`${contextStorageKey}:${window.location.pathname}`, JSON.stringify({ topicId, paperId, difficulty, sourceNote }));
    } catch { /* Storage may be disabled; entry still works. */ }
  }, [contextRestored, topicId, paperId, difficulty, sourceNote]);

  const loadBank = useCallback(async () => {
    setBankLoading(true);
    const params = new URLSearchParams({ search: bankSearch, page: String(bankPage), pageSize: String(bankPageSize) });
    if (bankTopic) params.set("topicId", bankTopic);
    if (bankAuthor) params.set("author", bankAuthor);
    if (bankSource) params.set("source", bankSource);
    if (bankLanguage) params.set("language", bankLanguage);
    if (bankStatus !== "all") params.set("status", bankStatus);
    try {
      const result = await adminRequest<{ questions: Question[]; total: number }>(`/api/admin/questions?${params}`);
      setBankQuestions(result.questions ?? []);
      setBankTotal(result.total ?? 0);
    } catch (cause) {
      const message = getErrorMessage(cause, "Could not load the MCQ bank.");
      setError(message); toastNotify.error(message);
    } finally { setBankLoading(false); }
  }, [bankSearch, bankPage, bankPageSize, bankTopic, bankStatus, bankAuthor, bankSource, bankLanguage]);

  useEffect(() => {
    if (mode !== "bank") return;
    const timeout = window.setTimeout(() => { void loadBank(); }, 180);
    return () => window.clearTimeout(timeout);
  }, [mode, loadBank]);

  const similarityChoicesKey = draft.choices.join("\n");
  useEffect(() => {
    if (draft.prompt.trim().length < 12) {
      const timeout = window.setTimeout(() => setSimilar([]), 0);
      return () => window.clearTimeout(timeout);
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const result = await adminRequest<{ similar: ExistingQuestionMatch[] }>("/api/admin/questions/similar", "POST", {
          topicId: Number(topicId) || undefined, questionId: editingId, prompt: draft.prompt,
          choices: similarityChoicesKey.split("\n"), correctChoice: draft.correctChoice, paperId: Number(paperId) || undefined,
        });
        if (!controller.signal.aborted) setSimilar(result.similar ?? []);
      } catch (cause) { if (!controller.signal.aborted) { setSimilar([]); toastNotify.error(getErrorMessage(cause, "Could not check for similar MCQs.")); } }
    }, 500);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [draft.prompt, similarityChoicesKey, draft.correctChoice, topicId, paperId, editingId]);

  function rememberSession(ids: number[], count: number) {
    try {
      sessionStorage.setItem(sessionIdsKey, JSON.stringify(ids.slice(-100)));
      sessionStorage.setItem(sessionCountKey, String(count));
    } catch { /* Session counter is a convenience only. */ }
  }

  function selectedPaper() { return paperOptions.find((paper) => String(paper.id) === paperId); }

  async function attachExistingQuestion(match: ExistingQuestionMatch) {
    if (!paperId) {
      setError(`MCQ #${match.id} already exists in ${match.subjectName} › ${match.topicName}. Select a paper in the context bar to attach it.`);
      return;
    }
    setBusy(true); setError("");
    try {
      await adminRequest("/api/admin/questions/bulk", "POST", { action: "add-to-paper", ids: [match.id], paperId: Number(paperId) }, confirm);
      setPaperOptions((items) => items.map((item) => item.id === Number(paperId) && !item.questionIds.includes(match.id)
        ? { ...item, questionIds: [...item.questionIds, match.id], questionCount: item.questionCount + 1 }
        : item));
      toastNotify.success(`Existing MCQ #${match.id} linked to ${selectedPaper()?.title ?? "the selected paper"}; no duplicate was created.`);
      await onUpdated();
    } catch (cause) { const message = getErrorMessage(cause, "Could not attach the existing MCQ to this paper."); setError(message); toastNotify.error(message); }
    finally { setBusy(false); }
  }

  async function uploadImage(file: File | undefined, target: "question" | number) {
    if (!file) return;
    setImageBusy(true); setError("");
    try {
      const form = new FormData(); form.set("image", file);
      const response = await fetch("/api/admin/question-images", { method: "POST", body: form, cache: "no-store" });
      const data = await parseApiResponse<{ url: string }>(response, "The image could not be uploaded.");
      if (target === "question") setDraft((current) => ({ ...current, questionImageUrl: data.url }));
      else setDraft((current) => ({ ...current, choiceImageUrls: (current.choiceImageUrls ?? [null, null, null, null]).map((url, index) => index === target ? data.url : url) }));
    } catch (cause) { const message = getErrorMessage(cause, "The image could not be uploaded."); setError(message); toastNotify.error(message); }
    finally { setImageBusy(false); }
  }

  async function saveQuestion(closeAfterSave: boolean) {
    setError("");
    const validation = validateDraft(draft);
    if (!topicId) validation.unshift("Choose a category and topic in the context bar.");
    if (sourceNote.trim().length < 4) validation.unshift("Add a source note in the context bar.");
    if (richTextToPlainText(draft.explanation).length > 3000) validation.unshift("Explanation must be 3,000 characters or fewer.");
    if (validation.length) { setError(validation[0]); return; }
    setBusy(true);
    try {
      const paperIds = canUsePapers ? (editingId ? editingPaperIds : paperId ? [Number(paperId)] : []) : undefined;
      const explanation = draft.explanation.trim();
      const language = detectQuestionLanguage([draft.prompt, ...draft.choices, richTextToPlainText(explanation)]);
      const body = { id: editingId ?? undefined, expectedVersion: editingId ? editingVersion : undefined, topicId: Number(topicId), paperIds, prompt: draft.prompt.trim(), questionImageUrl: draft.questionImageUrl ?? null, choiceImageUrls: draft.choiceImageUrls ?? [null, null, null, null], choices: draft.choices.map((choice) => choice.trim()), correctChoice: draft.correctChoice, explanation, sourceNote: sourceNote.trim(), difficulty, language };
      const result = await adminRequest<{ id?: number; version?: number; status?: Status; existing?: boolean; duplicate?: ExistingQuestionMatch }>("/api/admin/questions", editingId ? "PATCH" : "POST", body, confirm);
      if (result.existing && result.id) {
        setDraft(emptyDraft); setSimilar([]); setShowQuestionImage(false); setOpenChoiceImages([false, false, false, false]);
        const selected = selectedPaper();
        if (selected) setPaperOptions((items) => items.map((item) => item.id === selected.id && !item.questionIds.includes(result.id!)
          ? { ...item, questionIds: [...item.questionIds, result.id!], questionCount: item.questionCount + 1 }
          : item));
        toastNotify.success(`Existing MCQ #${result.id} linked to ${selected?.title ?? "the selected paper"}; no duplicate was created.`);
        await onUpdated();
        if (closeAfterSave) setMode("bank");
        else window.setTimeout(() => questionRef.current?.focus(), 0);
        return;
      }
      const id = editingId ?? Number(result.id);
      const topic = topics.find((item) => item.id === Number(topicId));
      const existing = sessionQuestions.find((question) => question.id === id);
      const item: Question = {
        id,
        topicId: Number(topicId),
        topicName: topic?.name ?? "Topic",
        subjectName: topic?.subject_name ?? "Subject",
        prompt: draft.prompt.trim(),
        questionImageUrl: draft.questionImageUrl ?? null,
        explanation,
        sourceNote: sourceNote.trim(),
        correctChoice: draft.correctChoice,
        difficulty,
        language,
        status: editingId ? (result.status ?? editingStatus) : "draft",
        version: result.version ?? (editingId ? editingVersion + 1 : 1),
        paperIds: paperIds ?? existing?.paperIds ?? [],
        choices: draft.choices.map((text, index) => ({ label: questionLabels[index], text: text.trim(), imageUrl: draft.choiceImageUrls?.[index] ?? null })),
      };
      const updatedSession = existing
        ? sessionQuestions.map((question) => question.id === id ? item : question)
        : [item, ...sessionQuestions];
      setSessionQuestions(updatedSession);
      let nextCount = sessionCount;
      if (!editingId) { nextCount++; setSessionCount(nextCount); }
      rememberSession(updatedSession.map((question) => question.id), nextCount);
      if (paperIds?.length) {
        setPaperOptions((items) => items.map((item) => paperIds.includes(item.id) && !item.questionIds.includes(id)
          ? { ...item, questionIds: [...item.questionIds, id], questionCount: item.questionCount + 1 }
          : item));
      }
      setDraft(emptyDraft);
      setEditingId(null);
      setEditBaseline(null);
      setEditingPaperIds([]);
      setSimilar([]);
      setShowQuestionImage(false);
      setOpenChoiceImages([false, false, false, false]);
      toastNotify.success(editingId ? `Updated #${id}.` : `Saved #${id} as a draft. Learners cannot see it until it is approved and published.`);
      await onUpdated();
      if (closeAfterSave) setMode("bank");
      else window.setTimeout(() => questionRef.current?.focus(), 0);
    } catch (cause) {
      if (isConfirmationCancelled(cause)) return;
      const message = getErrorMessage(cause, "The MCQ could not be saved."); setError(message); toastNotify.error(message);
    } finally { setBusy(false); }
  }

  function onQuestionKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void saveQuestion(false);
    }
  }

  function editQuestion(question: Question) {
    const choices = questionLabels.map((label) => question.choices.find((choice) => choice.label === label)?.text ?? "");
    const explanation = question.explanation ?? "";
    setDraft({ prompt: question.prompt, questionImageUrl: question.questionImageUrl ?? null, choices, choiceImageUrls: questionLabels.map((label) => question.choices.find((choice) => choice.label === label)?.imageUrl ?? null), correctChoice: question.correctChoice, explanation, language: detectQuestionLanguage([question.prompt, ...choices, explanation]) });
    setEditBaseline(question);
    setTopicId(String(question.topicId));
    setSourceNote(question.sourceNote);
    setDifficulty(question.difficulty);
    setEditingId(question.id);
    setEditingStatus(question.status);
    setEditingVersion(question.version);
    setEditingPaperIds(question.paperIds);
    setShowQuestionImage(Boolean(question.questionImageUrl));
    setOpenChoiceImages(questionLabels.map((label) => Boolean(question.choices.find((choice) => choice.label === label)?.imageUrl)));
    if (canUsePapers && question.paperIds[0]) setPaperId(String(question.paperIds[0]));
    setMode("quick");
    window.setTimeout(() => questionRef.current?.focus(), 50);
  }

  function replaceQuestion(id: number, patch: Partial<Question>) {
    const apply = (item: Question) => item.id === id ? { ...item, ...patch } : item;
    setSessionQuestions((items) => items.map(apply));
    setBankQuestions((items) => items.map(apply));
  }

  async function sessionAction(action: string, question: Question, values: Record<string, unknown> = {}) {
    setError("");
    try {
      const statusChange: Partial<Record<string, Status>> = { approve: "approved", publish: "published", archive: "archived", "submit-review": "in_review", reject: "rejected", revise: "draft" };
      if (action === "approve" || action === "submit-review" || action === "reject" || action === "revise" || action === "publish") {
        await adminRequest("/api/admin/questions", "PATCH", { id: question.id, status: statusChange[action], ...values }, confirm);
      } else await adminRequest("/api/admin/questions/bulk", "POST", { action, ids: [question.id], ...values }, confirm);
      if (action === "change-category" && typeof values.topicId === "number") {
        const topic = topics.find((item) => item.id === values.topicId);
        replaceQuestion(question.id, { topicId: Number(values.topicId), topicName: topic?.name ?? question.topicName, subjectName: topic?.subject_name ?? question.subjectName });
      } else if (action === "remove-from-paper" && typeof values.paperId === "number") {
        replaceQuestion(question.id, { paperIds: question.paperIds.filter((id) => id !== values.paperId) });
      } else if (statusChange[action]) {
        replaceQuestion(question.id, { status: statusChange[action], reviewNote: typeof values.reviewNote === "string" ? values.reviewNote : question.reviewNote });
      }
      const messages: Record<string, string> = {
        "change-category": "Category changed.",
        "remove-from-paper": "Removed from paper.",
        archive: `Archived #${question.id}.`,
        "submit-review": `#${question.id} is in review. It is still hidden from learners.`,
        approve: `#${question.id} is approved. Publish it when the subject and topic are live.`,
        reject: `#${question.id} was rejected.`,
        revise: `#${question.id} is a draft again.`,
        publish: `#${question.id} is published and visible to learners.`,
      };
      toastNotify.success(messages[action] ?? "MCQ updated.");
      await onUpdated();
    } catch (cause) { if (isConfirmationCancelled(cause)) return; const message = getErrorMessage(cause, "The action could not be completed."); setError(message); toastNotify.error(message); }
  }

  async function createPaper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNewPaperBusy(true); setNewPaperError("");
    try {
      const result = await adminRequest<{ paper: Paper }>("/api/admin/papers/quick-create", "POST", { examName: newPaper.examName, title: newPaper.title, year: Number(newPaper.year) });
      paperSelectionLocked.current = true;
      setPaperOptions((items) => [result.paper, ...items.filter((item) => item.id !== result.paper.id)]);
      setPaperId(String(result.paper.id));
      setSourceNote(`${result.paper.examName} ${result.paper.year} Past Paper`);
      setNewPaperOpen(false);
      setNewPaper({ examName: "", title: "", year: String(new Date().getFullYear()) });
      toastNotify.success("Draft paper created and selected.");
      await onUpdated();
    } catch (cause) { const message = getErrorMessage(cause, "The paper could not be created."); setNewPaperError(message); toastNotify.error(message); }
    finally { setNewPaperBusy(false); }
  }

  async function handleCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setCsvFileName(file.name);
      const text = await file.text();
      setPasteText(text);
      const rows = parseCsv(text);
      setBulkRows(rows);
      setError("");
      await checkExistingBulkRows(rows);
    } catch (cause) { const message = getErrorMessage(cause, "Could not read the CSV file."); setError(message); toastNotify.error(message); }
  }

  async function checkExistingBulkRows(rows: PreviewRow[]) {
    const selectedPaperIds = bulkPaperIds ?? (paperId ? [Number(paperId)] : []);
    setExistingBulkMatches({});
    if (!rows.length) return;
    if (!topicId) {
      setError("Choose a category before checking pasted MCQs for duplicates.");
      return;
    }
    if (rows.length > 500) {
      setError("Check up to 500 MCQs per preview. Category-only imports can still be split across multiple previews without a 100-question limit.");
      return;
    }
    setMatchingBulkRows(true);
    try {
      const response = await adminRequest<{ matches: Array<{ row: number } & BulkExistingMatch> }>("/api/admin/questions/bulk", "POST", {
        action: "match-existing", topicId: Number(topicId), paperIds: selectedPaperIds,
        questions: rows.map(({ prompt, choices, correctChoice, explanation, rowNumber }) => ({ prompt, choices, correctChoice, explanation, rowNumber })),
      });
      setExistingBulkMatches(Object.fromEntries(response.matches.map((match) => [match.row, match])));
      if (response.matches.length) toastNotify.info(selectedPaperIds.length
        ? `${response.matches.length} existing MCQ${response.matches.length === 1 ? "" : "s"} found across topics. They will be linked to the selected paper instead of duplicated.`
        : `${response.matches.length} exact duplicate${response.matches.length === 1 ? "" : "s"} found across topics. They will be skipped during import.`);
    } catch (cause) {
      const message = getErrorMessage(cause, "Could not check the category for existing MCQs.");
      setError(message);
      toastNotify.error(message);
    } finally { setMatchingBulkRows(false); }
  }

  async function previewText() {
    const rows = parseTextBlocks(pasteText);
    setBulkRows(rows);
    setCsvFileName("");
    setError("");
    await checkExistingBulkRows(rows);
  }

  function removeBulkRow(rowNumber: number) {
    setBulkRows((rows) => rows.filter((row) => row.rowNumber !== rowNumber));
    setExistingBulkMatches((matches) => {
      const next = { ...matches };
      delete next[rowNumber];
      return next;
    });
  }

  async function importRows() {
    if (!bulkRows.length) { setError("Add MCQs to the preview first."); return; }
    if (!topicId || sourceNote.trim().length < 4) { setError("Choose a category and enter a source note in the context bar first."); return; }
    const selectedPaperIds = bulkPaperIds ?? (paperId ? [Number(paperId)] : []);
    if (selectedPaperIds.length && bulkRows.length > 100) { setError("Paper imports are limited to 100 MCQs at a time. Remove the paper selection to import more into the category."); return; }
    setBusy(true); setError("");
    try {
      const result = await adminRequest<{ ids: number[]; count: number; existingCount: number; attachedExistingCount: number; skipped: number; results: Array<{ row: number; id?: number; ok: boolean; existing?: boolean; error?: string }> }>("/api/admin/questions/bulk", "POST", {
        action: "import", topicId: Number(topicId), paperIds: selectedPaperIds, difficulty, sourceNote: sourceNote.trim(), status: "draft",
        questions: bulkRows.map(({ prompt, choices, correctChoice, explanation, rowNumber }) => ({ prompt, choices, correctChoice, explanation, rowNumber })),
      });
      const topic = topics.find((item) => item.id === Number(topicId));
      const imported = result.results.flatMap((item): Question[] => {
        if (!item.ok || !item.id || item.existing) return [];
        const row = bulkRows.find((candidate) => candidate.rowNumber === item.row);
        if (!row) return [];
        return [{
        id: item.id, topicId: Number(topicId), topicName: topic?.name ?? "Topic", subjectName: topic?.subject_name ?? "Subject",
        prompt: row.prompt.trim(), explanation: row.explanation.trim(), sourceNote: sourceNote.trim(), correctChoice: row.correctChoice,
        difficulty, language: detectQuestionLanguage([row.prompt, ...row.choices, row.explanation]), status: "draft", paperIds: bulkPaperIds ?? (paperId ? [Number(paperId)] : []),
        version: 1,
        choices: row.choices.map((text, choiceIndex) => ({ label: questionLabels[choiceIndex], text: text.trim() })),
        }];
      });
      const updatedSession = [...imported.reverse(), ...sessionQuestions];
      const nextCount = sessionCount + result.count;
      setSessionQuestions(updatedSession); setSessionCount(nextCount); rememberSession(updatedSession.map((item) => item.id), nextCount);
      const failed = result.results.filter((item) => !item.ok);
      const remainingRows = failed.flatMap((item) => {
        const row = bulkRows.find((candidate) => candidate.rowNumber === item.row);
        return row ? [{ ...row, errors: [item.error || "This MCQ could not be imported."] }] : [];
      });
      setBulkRows(remainingRows);
      setExistingBulkMatches({});
      setPasteText(remainingRows.map((row) => `Q: ${row.prompt}\nA) ${row.choices[0]}\nB) ${row.choices[1]}\nC) ${row.choices[2]}\nD) ${row.choices[3]}\nAnswer: ${row.correctChoice}${row.explanation ? `\nExplanation: ${row.explanation}` : ""}`).join("\n\n"));
      setCsvFileName("");
      if (!remainingRows.length) setBulkPaperIds(null);
      if (remainingRows.length) toastNotify.warning(`Imported ${result.count} new MCQs and attached ${result.attachedExistingCount} existing. ${remainingRows.length} row${remainingRows.length === 1 ? "" : "s"} skipped; review the highlighted errors and retry.`);
      else if (selectedPaperIds.length) toastNotify.success(`Imported ${result.count} new MCQs and linked ${result.attachedExistingCount} existing MCQs to the selected paper${selectedPaperIds.length === 1 ? "" : "s"}.`);
      else toastNotify.success(`Imported ${result.count} new MCQs; skipped ${result.existingCount ?? 0} exact duplicates already found across topics.`);
      await onUpdated();
    } catch (cause) { const message = getErrorMessage(cause, "Bulk import failed; no MCQs were saved."); setError(message); toastNotify.error(message); }
    finally { setBusy(false); }
  }

  function toggleSelected(id: number, checked: boolean) {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  }

  async function runBulkAction(action: string) {
    if (!selectedIds.length) return;
    const values: Record<string, unknown> = {};
    if (action === "change-category") values.topicId = Number(bulkTopicId);
    setBusy(true); setError("");
    try {
      await adminRequest("/api/admin/questions/bulk", "POST", { action, ids: selectedIds, ...values }, confirm);
      toastNotify.success(`${selectedIds.length} MCQ${selectedIds.length === 1 ? "" : "s"} updated.`);
      setSelectedIds([]);
      await Promise.all([loadBank(), onUpdated()]);
    } catch (cause) { if (isConfirmationCancelled(cause)) return; const message = getErrorMessage(cause, "The bulk action failed."); setError(message); toastNotify.error(message); }
    finally { setBusy(false); }
  }

  async function reviewCurrentQuestion(question: Question, decision: "approved" | "rejected") {
    const note = reviewNote.trim();
    if (!note) { setError(decision === "approved" ? "Add a review comment before approving." : "Add a reason before rejecting."); return; }
    setBusy(true); setError("");
    try {
      await adminRequest("/api/admin/questions", "PATCH", { id: question.id, status: decision, reviewNote: note }, confirm);
      toastNotify.success(decision === "approved" ? `MCQ #${question.id} approved. Loading the next item.` : `MCQ #${question.id} rejected. Loading the next item.`);
      setReviewNote("");
      await Promise.all([loadBank(), onUpdated()]);
    } catch (cause) { if (!isConfirmationCancelled(cause)) { const message = getErrorMessage(cause, "The review decision could not be saved."); setError(message); toastNotify.error(message); } }
    finally { setBusy(false); }
  }

  const paper = selectedPaper();
  const clearContext = () => { paperSelectionLocked.current = true; setPaperId(""); setTopicId(""); setSourceNote(""); setDifficulty("medium"); };
  const contextBar = <section className="mcq-context-bar mcq-context-bar-compact" aria-label="MCQ entry context">
    <div className="mcq-context-toolbar"><strong className="mcq-context-label">ENTRY CONTEXT</strong><span>Choose a category and paper together; the selection stays after each save.</span><button type="button" className="text-link" onClick={clearContext}>Clear</button></div>
    <div className="mcq-context-grid">
      {canUsePapers && <SearchPicker id="mcq-context-paper" label="Exam / paper" value={paperId} options={paperPickerOptions} placeholder="Search exams and papers" onChange={(value) => { paperSelectionLocked.current = true; setPaperId(value); const selected = paperOptions.find((item) => String(item.id) === value); if (selected) setSourceNote(`${selected.examName} ${selected.year} Past Paper`); }} action={canQuickCreatePaper ? { label: "+ New paper", onClick: () => { setNewPaperError(""); setNewPaperOpen(true); } } : undefined} />}
      <SearchPicker id="mcq-context-topic" label="Category · topic" value={topicId} options={topicOptions} placeholder="Search subject › topic" onChange={setTopicId} />
      <div className="mcq-context-field"><label htmlFor="mcq-context-difficulty">Default difficulty</label><select id="mcq-context-difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div>
      <div className="mcq-context-field"><label htmlFor="mcq-context-source">Source note</label><input id="mcq-context-source" value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} maxLength={500} placeholder={paper ? `${paper.examName} ${paper.year} Past Paper` : "Exam, year, and source"} /></div>
    </div>
    {paper && <p className="mcq-context-paper-note">New MCQs will be linked to <strong>{paper.title}</strong> in paper order.</p>}
  </section>;

  return <div className="admin-content-stack mcq-workspace">
    {canCreateMcqs && (mode === "quick" || mode === "bulk") && <div className="mcq-entry-page-heading"><div><h1>{mode === "quick" ? (editingId ? `Edit MCQ #${editingId}` : "Add MCQ") : "Paste multiple MCQs"}</h1><p>{mode === "quick" ? "Set the context once, then keep adding. Ctrl + Enter saves and continues." : "Paste question blocks or upload a CSV, then review every row before importing."}</p></div><div className="mcq-entry-heading-actions">{mode === "quick" && <span className="mcq-session-counter">{sessionCount} added this session</span>}<button type="button" className="button button-light" onClick={() => setMode("bank")}>MCQ bank</button>{mode === "quick" ? <button type="button" className="button button-light" onClick={() => setMode("bulk")}>Paste multiple MCQs</button> : <button type="button" className="button button-light" onClick={() => setMode("quick")}>Back to Add MCQ</button>}</div></div>}
    {canCreateMcqs && (mode === "quick" || mode === "bulk") && contextBar}
    {error && <p className="form-error" role="alert">{error}</p>}

    {mode === "quick" && canCreateMcqs && <>
      <section className="mcq-entry-panel">
        <div className="mcq-entry-layout"><form className="admin-form mcq-entry-form" onSubmit={(event) => { event.preventDefault(); void saveQuestion(false); }} onKeyDown={onQuestionKeyDown}>
          <label htmlFor="fast-mcq-question">Question text</label>
          <textarea ref={questionRef} id="fast-mcq-question" lang={containsUrduScript(draft.prompt) ? "ur" : "en"} dir="auto" className={containsUrduScript(draft.prompt) ? "urdu-aware-input" : undefined} value={draft.prompt} onChange={(event) => setDraft((current) => { const prompt = event.target.value; return { ...current, prompt, language: detectQuestionLanguage([prompt, ...current.choices, current.explanation]) }; })} rows={3} minLength={8} maxLength={1500} required placeholder="Enter the question" />
          <div className="mcq-attach-row">{!showQuestionImage && !draft.questionImageUrl && <button type="button" className="text-link" onClick={() => setShowQuestionImage(true)}>Add question image</button>}{(showQuestionImage || draft.questionImageUrl) && <div className="mcq-attach-field"><label htmlFor="fast-mcq-question-image">Question image <span className="mcq-optional">optional · PNG, JPEG, or WebP · max 5 MB</span></label><input id="fast-mcq-question-image" className="mcq-file-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={imageBusy} onChange={(event) => void uploadImage(event.target.files?.[0], "question")} />{draft.questionImageUrl && <div className="mcq-image-preview"><Image src={draft.questionImageUrl} alt="Question attachment preview" width={160} height={160} unoptimized /><button type="button" className="text-link" onClick={() => { setDraft({ ...draft, questionImageUrl: null }); setShowQuestionImage(false); }}>Remove image</button></div>}</div>}</div>
          {similar.length > 0 && <aside className="mcq-similar-warning" role="status"><strong>{similar.some((item) => item.exact) ? "Exact duplicate found across topics" : "Possible similar MCQs across topics"}</strong>{similar.map((item) => <div className="mcq-duplicate-match" key={item.id}><small>MCQ #{item.id} · {item.exact ? "Exact match" : `${item.similarity ?? 0}% similar`} · {item.subjectName} › {item.topicName} · {item.status.replace("_", " ")}</small><p><LocalizedText>{item.prompt}</LocalizedText></p><div className="mcq-match-actions"><button type="button" className="mcq-icon-action" aria-label={`View existing MCQ ${item.id}`} title="View existing MCQ details" disabled={previewLoadingId === item.id} onClick={() => void previewExistingQuestion(item.id)}><Info size={16} aria-hidden="true" /></button>{canAddQuestionsToPapers && <button type="button" className="mcq-icon-action mcq-icon-action-link" aria-label={paperId ? `Link MCQ ${item.id} to selected paper` : `Select a paper to link MCQ ${item.id}`} title={paperId ? "Link existing MCQ to selected paper" : "Select a paper in the context bar first"} disabled={busy} onClick={() => void attachExistingQuestion(item)}><Link2 size={16} aria-hidden="true" /></button>}</div></div>)}{similar.some((item) => item.exact) && <button type="button" className="text-link text-danger" disabled={busy} onClick={() => { setDraft(emptyDraft); setSimilar([]); }}>Skip duplicate and clear this entry</button>}<small>{similar.some((item) => item.exact) ? "Saving an exact duplicate is blocked. Link the existing question to a paper or skip this entry." : "Review these matches before saving. Remove unwanted new variants from the bulk preview before importing."}</small></aside>}
          <div className="mcq-options-heading"><span>Answer options</span><small>Choose the radio on the correct option.</small></div>
          <div className="mcq-option-grid">{draft.choices.map((choice, index) => <div className={`mcq-option-card ${draft.correctChoice === questionLabels[index] ? "is-correct" : ""}`} key={questionLabels[index]}><div className="mcq-option-head"><span className="mcq-option-letter">{questionLabels[index]}</span><label className="mcq-correct-radio" htmlFor={`fast-mcq-correct-${index}`}><input id={`fast-mcq-correct-${index}`} type="radio" name="fast-mcq-correct" value={questionLabels[index]} checked={draft.correctChoice === questionLabels[index]} onChange={() => setDraft({ ...draft, correctChoice: questionLabels[index] })} />{draft.correctChoice === questionLabels[index] ? "Correct answer" : "Mark correct"}</label><button type="button" className="text-link" onClick={() => setOpenChoiceImages((current) => current.map((open, choiceIndex) => choiceIndex === index ? !open : open))}>{draft.choiceImageUrls?.[index] ? "Image added" : "Add image"}</button></div><input id={`fast-mcq-option-${index}`} aria-label={`Option ${questionLabels[index]}`} value={choice} lang={containsUrduScript(choice) || (!choice.trim() && containsUrduScript(draft.prompt)) ? "ur" : "en"} dir="auto" className={containsUrduScript(choice) || (!choice.trim() && containsUrduScript(draft.prompt)) ? "urdu-aware-input" : undefined} onChange={(event) => setDraft((current) => { const choices = current.choices.map((item, choiceIndex) => choiceIndex === index ? event.target.value : item); return { ...current, choices, language: detectQuestionLanguage([current.prompt, ...choices, current.explanation]) }; })} maxLength={800} required placeholder={`Option ${questionLabels[index]}`} />{(openChoiceImages[index] || draft.choiceImageUrls?.[index]) && <div className="mcq-attach-field"><label htmlFor={`fast-mcq-option-image-${index}`}>Option {questionLabels[index]} image <span className="mcq-optional">optional</span></label><input id={`fast-mcq-option-image-${index}`} className="mcq-file-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={imageBusy} onChange={(event) => void uploadImage(event.target.files?.[0], index)} />{draft.choiceImageUrls?.[index] && <div className="mcq-image-preview"><Image src={draft.choiceImageUrls[index] ?? ""} alt={`Option ${questionLabels[index]} attachment preview`} width={120} height={120} unoptimized /><button type="button" className="text-link" onClick={() => setDraft({ ...draft, choiceImageUrls: (draft.choiceImageUrls ?? [null, null, null, null]).map((url, choiceIndex) => choiceIndex === index ? null : url) })}>Remove image</button></div>}</div>}</div>)}</div>
          <label id="fast-mcq-explanation-label">Explanation <span className="mcq-optional">optional · formatting supported</span></label>
          <ExplanationEditor value={draft.explanation} disabled={busy || imageBusy} onChange={(explanation) => setDraft((current) => ({ ...current, explanation, language: detectQuestionLanguage([current.prompt, ...current.choices, richTextToPlainText(explanation)]) }))} />
          <small className={`mcq-explanation-count${richTextToPlainText(draft.explanation).length > 3000 ? " is-over-limit" : ""}`}>{richTextToPlainText(draft.explanation).length.toLocaleString()} / 3,000 characters</small>
          {editBaseline && editingStatus === "published" && <section className="mcq-edit-diff" aria-label="Before and after edit comparison"><div><span className="eyebrow">EDIT REVIEW</span><strong>Before / after</strong><small>This published MCQ will return to review when saved.</small></div><div className="mcq-diff-columns"><article><b>Before</b><p><LocalizedText>{editBaseline.prompt}</LocalizedText></p><ol>{editBaseline.choices.map((choice) => <li key={choice.label}>{choice.label}) <LocalizedText>{choice.text}</LocalizedText></li>)}</ol><small>Answer: {editBaseline.correctChoice}</small></article><article><b>After</b><p><LocalizedText>{draft.prompt || "Question text not entered"}</LocalizedText></p><ol>{draft.choices.map((choice, index) => <li key={questionLabels[index]}>{questionLabels[index]}) <LocalizedText>{choice || "Empty option"}</LocalizedText></li>)}</ol><small>Answer: {draft.correctChoice || "Not selected"}</small></article></div></section>}
          <div className="mcq-save-bar"><button className="button button-primary" type="submit" disabled={busy || imageBusy || (!editingId && similar.some((item) => item.exact) && !paperId)}>{busy ? "Saving…" : !editingId && similar.some((item) => item.exact) ? "Link existing MCQ" : editingId ? "Save changes" : <>Save and add next <span>· Ctrl+Enter</span></>}</button><button className="button button-light" type="button" disabled={busy || imageBusy || (!editingId && similar.some((item) => item.exact) && !paperId)} onClick={() => void saveQuestion(true)}>{!editingId && similar.some((item) => item.exact) ? "Link and close" : "Save and close"}</button>{editingId && <button className="button button-light" type="button" disabled={busy || imageBusy} onClick={() => { setEditingId(null); setEditingPaperIds([]); setDraft(emptyDraft); setShowQuestionImage(false); setOpenChoiceImages([false, false, false, false]); }}>Cancel edit</button>}<span className="mcq-save-hint">Exact duplicates are reused instead of copied to another topic or paper.</span></div>
          {canCreateMcqs && <p className="form-hint">{canDirectPublish ? "Saving keeps the MCQ as a draft. You can publish it directly when its subject and topic are published, or send it through review." : "Saving keeps the MCQ as a draft. It stays off the public site until you submit it, a reviewer approves it, and someone with publish permission publishes it. The subject and topic must already be published."}</p>}
        </form><div className="mcq-entry-preview-column"><aside className="mcq-live-preview" aria-label="Learner view preview"><div className="mcq-live-preview-head"><strong>Learner view</strong><span>{draft.language === "ur" ? "اردو · RTL" : "English · LTR"}</span></div><article><p><LocalizedText>{draft.prompt || "Your question preview will appear here."}</LocalizedText></p>{draft.questionImageUrl && <Image src={draft.questionImageUrl} alt="Question preview" width={640} height={360} unoptimized />}{draft.choices.map((choice, index) => <div key={questionLabels[index]} className={draft.correctChoice === questionLabels[index] ? "is-preview-answer" : ""}><b>{questionLabels[index]}</b><LocalizedText>{choice || `Option ${questionLabels[index]}`}</LocalizedText>{draft.choiceImageUrls?.[index] && <Image src={draft.choiceImageUrls[index] ?? ""} alt={`Option ${questionLabels[index]} preview`} width={480} height={260} unoptimized />}</div>)}<small>The answer key stays hidden until the learner submits.</small></article></aside>
          <SessionList questions={sessionQuestions} topics={topics} papers={paperOptions} selectedPaperId={paperId ? Number(paperId) : null} canManagePapers={canManagePapers} canPublish={canPublish} canDirectPublish={canDirectPublish} canDelete={canDelete} canReviewMcqs={canReviewMcqs} canCreateMcqs={canCreateMcqs} canEditOwnMcqs={canEditOwnMcqs} canEditAnyMcqs={canEditAnyMcqs} currentUserId={currentUserId} onEdit={editQuestion} onAction={sessionAction} />
        </div></div>
      </section>
    </>}

    {mode === "bulk" && canCreateMcqs && <section className="admin-panel mcq-bulk-panel">
      <div className="admin-panel-heading"><div><span className="eyebrow">BULK ENTRY</span><h3>Paste multiple MCQs or upload a CSV</h3><p>Paste blank-line-separated question blocks, or use CSV columns: question, A, B, C, D, answer, explanation.</p></div></div>
      <p className="form-hint">Question language is detected automatically for each MCQ.</p>
      {isSuperAdmin && <><button type="button" className="button button-light testpoint-importer-toggle" aria-expanded={externalImporterOpen} onClick={() => setExternalImporterOpen((open) => !open)}>{externalImporterOpen ? "Close TestPoint importer" : "Import from TestPoint"}</button>
      {externalImporterOpen && <TestPointMcqImporter papers={paperOptions.map(({ id, title, status }) => ({ id, title, status }))} initialPaperIds={paperId ? [Number(paperId)] : []} onSendToBulk={(text, selectedPaperIds) => { setBulkPaperIds(selectedPaperIds); setPasteText(text); setBulkRows([]); setCsvFileName(""); setExternalImporterOpen(false); toastNotify.success("Selected MCQs and explanations were added to the bulk editor. Review them before importing."); }} />}</>}
      <label className="mcq-csv-upload" htmlFor="mcq-csv-file">Upload CSV <input id="mcq-csv-file" type="file" accept=".csv,text/csv" onChange={(event) => void handleCsvFile(event)} /></label>
      {csvFileName && <p className="admin-helper">Loaded {csvFileName}. You can also edit the parsed source below.</p>}
      <textarea className={`mcq-bulk-textarea ${containsUrduScript(pasteText) ? "urdu-aware-input" : ""}`} lang={containsUrduScript(pasteText) ? "ur" : "en"} dir="auto" value={pasteText} onChange={(event) => setPasteText(event.target.value)} rows={12} placeholder={`Q: Which word is a noun?\nA) Quickly\nB) Honest\nC) Teacher\nD) Run\nAnswer: C\nExplanation: A teacher is a person.\n\nQ: ...`} />
      <div className="admin-inline-actions"><button type="button" className="button button-light" disabled={matchingBulkRows} onClick={() => void previewText()}>Preview pasted MCQs</button>{bulkRows.length > 0 && <button type="button" className="button button-primary" disabled={busy || matchingBulkRows || !bulkRows.some((row) => !row.errors.length)} onClick={() => void importRows()}>{matchingBulkRows ? "Checking all topics…" : busy ? "Importing…" : `${bulkPaperIds?.length || paperId ? "Import / attach" : "Import"} ${bulkRows.filter((row) => !row.errors.length).length} MCQs`}</button>}</div>
      {bulkRows.length > 0 && <BulkPreviewTable rows={bulkRows} matches={existingBulkMatches} selectedPaperIds={bulkPaperIds ?? (paperId ? [Number(paperId)] : [])} onRemove={removeBulkRow} onPreview={(id) => void previewExistingQuestion(id)} />}
    </section>}

    {mode === "bank" && <section className={`admin-panel mcq-bank-panel ${reviewQueueView ? "is-review-queue-mode" : ""}`}>
      {!reviewQueueView && <header className="mcq-bank-page-heading"><div><h1>MCQ bank</h1><p>{bankTotal.toLocaleString()} questions · manage, review and publish your question bank.</p></div>{canCreateMcqs && <button type="button" className="button button-primary mcq-bank-add-button" onClick={() => setMode("quick")}><Plus size={17} aria-hidden="true" />Add MCQ</button>}</header>}
      {reviewQueueView ? <div className="review-filter-panel" aria-label="Review filters">
        <div className="review-filter-main">
          <input className="admin-filter" aria-label="Search review questions" value={bankSearch} onChange={(event) => { setBankSearch(event.target.value); setBankPage(1); }} placeholder="Search question, source, subject or topic…" />
          <select aria-label="Filter review status" value={bankStatus} onChange={(event) => { setBankStatus(event.target.value); setBankPage(1); }}><option value="in_review">Status: In review</option><option value="approved">Status: Approved</option><option value="rejected">Status: Rejected</option></select>
          <select aria-label="Filter by category" value={bankTopic} onChange={(event) => { setBankTopic(event.target.value); setBankPage(1); }}><option value="">All topics</option>{topicOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <button type="button" className="review-filter-toggle" aria-expanded={reviewFiltersOpen} aria-controls="review-advanced-filters" onClick={() => setReviewFiltersOpen((open) => !open)}><Filter size={15} aria-hidden="true" /><span>Filters</span><b>{reviewFilterCount}</b></button>
        </div>
        {reviewFiltersOpen && <div className="review-filter-advanced" id="review-advanced-filters">
          <input aria-label="Filter by author" value={bankAuthor} onChange={(event) => { setBankAuthor(event.target.value); setBankPage(1); }} placeholder="Author (staff name)" />
          <input aria-label="Filter by source" value={bankSource} onChange={(event) => { setBankSource(event.target.value); setBankPage(1); }} placeholder="Exam / source" />
          <select aria-label="Filter by language" value={bankLanguage} onChange={(event) => { setBankLanguage(event.target.value); setBankPage(1); }}><option value="">All languages</option><option value="en">English</option><option value="ur">Urdu</option></select>
        </div>}
      </div> : <div className="mcq-bank-filter-panel">
        <div className="mcq-bank-filter-main">
          <label className="mcq-bank-search"><Search size={17} aria-hidden="true" /><input aria-label="Search MCQs" value={bankSearch} onChange={(event) => { setBankSearch(event.target.value); setBankPage(1); }} placeholder="Search question, source, subject or topic…" /></label>
          <select aria-label="Filter by question status" value={bankStatus} onChange={(event) => { setBankStatus(event.target.value); setBankPage(1); }}><option value="all">All statuses</option><option value="draft">Draft</option><option value="in_review">In review</option><option value="approved">Approved</option><option value="published">Published</option><option value="rejected">Rejected</option><option value="archived">Archived</option></select>
          <select aria-label="Filter by category" value={bankTopic} onChange={(event) => { setBankTopic(event.target.value); setBankPage(1); }}><option value="">All topics</option>{topicOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          <button type="button" className="mcq-bank-filter-toggle" aria-expanded={bankFiltersOpen} aria-controls="mcq-bank-advanced-filters" onClick={() => setBankFiltersOpen((open) => !open)}><SlidersHorizontal size={16} aria-hidden="true" /><span>Filters</span></button>
          <button type="button" className={`mcq-bank-icon-button ${savedViewsOpen ? "is-active" : ""}`} aria-label="Saved views" title="Saved views" aria-expanded={savedViewsOpen} aria-controls="mcq-bank-saved-views" onClick={() => setSavedViewsOpen((open) => !open)}><Bookmark size={17} aria-hidden="true" /></button>
        </div>
        {bankFiltersOpen && <div className="mcq-bank-filter-advanced" id="mcq-bank-advanced-filters">
          <input aria-label="Filter by author" value={bankAuthor} onChange={(event) => { setBankAuthor(event.target.value); setBankPage(1); }} placeholder="Author (staff name)" />
          <input aria-label="Filter by source" value={bankSource} onChange={(event) => { setBankSource(event.target.value); setBankPage(1); }} placeholder="Exam / source" />
          <select aria-label="Filter by language" value={bankLanguage} onChange={(event) => { setBankLanguage(event.target.value); setBankPage(1); }}><option value="">All languages</option><option value="en">English</option><option value="ur">Urdu</option></select>
        </div>}
        {savedViewsOpen && <div className="mcq-bank-view-tools" id="mcq-bank-saved-views"><div className="mcq-saved-views"><label htmlFor="mcq-saved-view">Saved views</label><select id="mcq-saved-view" value="" onChange={(event) => { const view = savedViews.find((item) => item.name === event.target.value); if (view) applySavedView(view); }}><option value="">Choose a view</option>{savedViews.map((view) => <option value={view.name} key={view.name}>{view.name}</option>)}</select><input aria-label="Saved view name" value={savedViewName} onChange={(event) => setSavedViewName(event.target.value)} maxLength={40} placeholder="Name this view" /><button className="button button-light" type="button" disabled={!savedViewName.trim()} onClick={saveCurrentView}>Save view</button></div><div className="mcq-density-control" role="group" aria-label="Table density"><span>Density</span><button type="button" aria-pressed={bankDensity === "comfortable"} className={bankDensity === "comfortable" ? "active" : ""} onClick={() => setBankDensity("comfortable")}>Comfortable</button><button type="button" aria-pressed={bankDensity === "compact"} className={bankDensity === "compact" ? "active" : ""} onClick={() => setBankDensity("compact")}>Compact</button></div></div>}
      </div>}
      {!reviewQueueView && selectedIds.length > 0 && <div className="mcq-bulk-toolbar"><strong>{selectedIds.length} selected</strong>{(canEditAnyMcqs || canEditOwnMcqs) && <div className="mcq-bulk-control"><select aria-label="Bulk change category" value={bulkTopicId} onChange={(event) => setBulkTopicId(event.target.value)}><option value="">Choose category</option>{topicOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button type="button" className="button button-light" disabled={busy || !bulkTopicId} onClick={() => void runBulkAction("change-category")}>Change category</button></div>}{canCreateMcqs && <button type="button" className="button button-light" disabled={busy} onClick={() => void runBulkAction("submit-review")}>Submit for review</button>}{canPublish && <button type="button" className="button button-primary" disabled={busy} onClick={() => void runBulkAction("publish")}><Upload size={14} aria-hidden="true" />Publish</button>}{canDelete && <button type="button" className="button button-light" disabled={busy} onClick={() => void runBulkAction("archive")}>Archive</button>}<button type="button" className="text-link" onClick={() => setSelectedIds([])}>Clear</button></div>}
      {bankLoading ? <p className="loading-panel">Searching MCQs…</p> : reviewQueueView ? <ReviewQueuePane questions={bankQuestions} total={bankTotal} note={reviewNote} setNote={setReviewNote} busy={busy} error={error} status={bankStatus} onDecide={reviewCurrentQuestion} onStatusChange={(status) => { setBankStatus(status); setBankPage(1); }} /> : <div className="mcq-bank-table-wrap"><table className={`mcq-bank-table mcq-bank-table-${bankDensity}`}><thead><tr><th><input type="checkbox" aria-label="Select all MCQs on this page" checked={bankQuestions.length > 0 && bankQuestions.every((item) => selectedIds.includes(item.id))} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, ...bankQuestions.map((item) => item.id)])] : current.filter((id) => !bankQuestions.some((item) => item.id === id)))} /></th><th>Question</th><th>Category</th><th>Difficulty</th><th>Status</th><th>Actions</th></tr></thead><tbody>{bankQuestions.map((question) => <tr key={question.id}><td><input type="checkbox" aria-label={`Select MCQ ${question.id}`} checked={selectedIds.includes(question.id)} onChange={(event) => toggleSelected(question.id, event.target.checked)} /></td><td><div className="mcq-bank-question-cell"><span className="mcq-bank-question-id">#{question.id}</span><div className="mcq-bank-question-copy"><strong><LocalizedText>{question.prompt}</LocalizedText></strong><small>{question.sourceNote} · {question.authorName ?? "Unknown staff"} · {question.language === "ur" ? "Urdu" : "English"}</small></div></div>{question.questionImageUrl && <Image className="mcq-bank-thumb" src={question.questionImageUrl} alt="Question image" width={72} height={48} unoptimized />}{question.status === "rejected" && <small className="form-error">Review: {question.reviewNote || "Please revise this MCQ."}</small>}</td><td>{question.subjectName} › {question.topicName}</td><td>{question.difficulty}</td><td><span className={`admin-status admin-status-${question.status}`}>{question.status.replace("_", " ")}</span></td><td><div className="admin-inline-actions"><button type="button" className="mcq-bank-row-action" aria-label={`Preview MCQ ${question.id}`} title="Preview" onClick={() => setPreviewQuestion(question)}><Eye size={16} aria-hidden="true" /></button>{(canEditAnyMcqs || (canEditOwnMcqs && String(question.createdBy) === currentUserId && (question.status === "draft" || question.status === "rejected"))) && <button type="button" className="mcq-bank-row-action" aria-label={`Edit MCQ ${question.id}`} title="Edit" onClick={() => editQuestion(question)}><Pencil size={15} aria-hidden="true" /></button>}{canPublishQuestion(question.status, canPublish, canDirectPublish) && <button type="button" className="mcq-bank-row-action" aria-label={`Publish MCQ ${question.id}`} title="Publish" onClick={() => void sessionAction("publish", question)}><Upload size={16} aria-hidden="true" /></button>}{canDelete && question.status !== "archived" && <button type="button" className="mcq-bank-row-action" aria-label={`Archive MCQ ${question.id}`} title="Archive" onClick={() => void sessionAction("archive", question)}><Archive size={16} aria-hidden="true" /></button>}</div></td></tr>)}{!bankQuestions.length && <tr><td colSpan={6}><div className="admin-empty-state"><strong>No MCQs match these filters</strong><span>Change a filter or clear the search to see more questions.</span><button type="button" className="button button-light" onClick={() => { setBankSearch(""); setBankTopic(""); setBankAuthor(""); setBankSource(""); setBankLanguage(""); setBankStatus("all"); }}>Clear filters</button></div></td></tr>}</tbody></table></div>}
      <SitePagination page={bankPage} pageCount={bankPages} pageSize={bankPageSize} total={bankTotal} disabled={bankLoading} onPageChange={setBankPage} onPageSizeChange={(size) => { setBankPageSize(size); setBankPage(1); }} ariaLabel={reviewQueueView ? "Review queue pages" : "MCQ bank pages"} className="mcq-bank-pagination" />
    </section>}

    {previewQuestion && <div className="mcq-preview-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewQuestion(null); }}><aside className="mcq-preview-drawer" role="dialog" aria-modal="true" aria-labelledby="mcq-preview-title"><div className="admin-panel-heading"><div><span className="eyebrow">{previewQuestionTitle}</span><h3 id="mcq-preview-title">MCQ #{previewQuestion.id}</h3></div><button type="button" className="mcq-icon-action" aria-label="Close MCQ preview" title="Close" onClick={() => setPreviewQuestion(null)}><X size={18} aria-hidden="true" /></button></div><p><LocalizedText>{previewQuestion.prompt}</LocalizedText></p>{previewQuestion.questionImageUrl && <Image src={previewQuestion.questionImageUrl} alt="Question image" width={640} height={360} unoptimized />}{previewQuestion.choices.map((choice) => <article className={`mcq-preview-choice${choice.label === previewQuestion.correctChoice ? " is-correct" : ""}`} key={choice.label}><b>{choice.label}</b><LocalizedText>{choice.text}</LocalizedText>{choice.label === previewQuestion.correctChoice && <strong className="mcq-preview-correct-label">Correct answer</strong>}{choice.imageUrl && <Image src={choice.imageUrl} alt={`Option ${choice.label} image`} width={480} height={280} unoptimized />}</article>)}<small>{previewQuestion.subjectName} › {previewQuestion.topicName} · {previewQuestion.sourceNote} · {previewQuestion.status}</small>{previewQuestion.explanation && <details open={previewQuestionTitle === "EXISTING MCQ DETAILS"}><summary>Explanation</summary><RichText value={previewQuestion.explanation} /></details>}</aside></div>}{newPaperOpen && <div className="mcq-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewPaperOpen(false); }}><section className="mcq-new-paper-modal" role="dialog" aria-modal="true" aria-labelledby="mcq-new-paper-title"><div className="admin-panel-heading"><div><span className="eyebrow">QUICK CREATE</span><h3 id="mcq-new-paper-title">New past paper</h3><p>It will be saved as a draft. Add verified MCQs and source details before publishing.</p></div><button type="button" className="text-link" onClick={() => setNewPaperOpen(false)}>Close</button></div><form className="admin-form" onSubmit={(event) => void createPaper(event)}><label htmlFor="quick-paper-exam">Exam / commission</label><input id="quick-paper-exam" value={newPaper.examName} onChange={(event) => setNewPaper({ ...newPaper, examName: event.target.value })} maxLength={160} minLength={2} required placeholder="FPSC, PPSC, NTS…" /><label htmlFor="quick-paper-title">Paper title</label><input id="quick-paper-title" value={newPaper.title} onChange={(event) => setNewPaper({ ...newPaper, title: event.target.value })} maxLength={220} minLength={3} required placeholder="FPSC Assistant Written Test" /><label htmlFor="quick-paper-year">Year</label><input id="quick-paper-year" type="number" value={newPaper.year} onChange={(event) => setNewPaper({ ...newPaper, year: event.target.value })} min="1900" max="2200" required /><p className="form-hint">Source note will be set to “{newPaper.examName || "Exam"} {newPaper.year} Past Paper”.</p>{newPaperError && <p className="form-error" role="alert">{newPaperError}</p>}<div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={newPaperBusy}>{newPaperBusy ? "Creating…" : "Create & select paper"}</button><button className="button button-light" type="button" onClick={() => setNewPaperOpen(false)}>Cancel</button></div></form></section></div>}
  </div>;
}

function ReviewQueuePane({ questions, total, note, setNote, busy, error, status, onDecide, onStatusChange }: { questions: Question[]; total: number; note: string; setNote: (note: string) => void; busy: boolean; error: string; status: string; onDecide: (question: Question, decision: "approved" | "rejected") => Promise<void>; onStatusChange: (status: string) => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const question = questions.find((item) => item.id === selectedId) ?? questions[0];
  const pending = status === "in_review";
  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if (!pending || event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || !question || busy) return;
      const key = event.key.toLowerCase();
      if (key === "a" && note.trim()) { event.preventDefault(); void onDecide(question, "approved"); }
      if (key === "r" && note.trim()) { event.preventDefault(); void onDecide(question, "rejected"); }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [busy, note, onDecide, pending, question]);
  return <section className="review-workspace" aria-label="Review queue">
    <header className="review-page-heading"><div><h2>Review queue</h2><p>{pending ? `${total} question${total === 1 ? "" : "s"} waiting, oldest first. Approve, or send back with a comment.` : `${status === "approved" ? "Approved" : "Rejected"} questions · select a row to inspect its review record.`}</p></div><div className="review-status-tabs" role="tablist" aria-label="Review status"><button type="button" className={pending ? "active" : ""} role="tab" aria-selected={pending} onClick={() => onStatusChange("in_review")}>Pending{pending && <b>{total}</b>}</button><button type="button" className={status === "approved" ? "active" : ""} role="tab" aria-selected={status === "approved"} onClick={() => onStatusChange("approved")}>Approved</button><button type="button" className={status === "rejected" ? "active" : ""} role="tab" aria-selected={status === "rejected"} onClick={() => onStatusChange("rejected")}>Rejected</button></div></header>
    {questions.length ? <div className="review-master-detail">
      <nav className="review-queue-list" aria-label="Pending questions"><div className="review-list-heading"><strong>Oldest first</strong><span>{questions.findIndex((item) => item.id === question?.id) + 1} of {questions.length}</span></div>{questions.map((item, index) => <button type="button" key={item.id} className={`review-queue-item ${item.id === question?.id ? "is-selected" : ""}`} aria-current={item.id === question?.id ? "true" : undefined} onClick={() => { setSelectedId(item.id); }}><span className="review-queue-item-top"><strong>MCQ #{item.id}</strong>{index === 0 && <small className="review-oldest-pill">Oldest</small>}</span><span className="review-queue-prompt"><LocalizedText>{item.prompt}</LocalizedText></span><span className="review-queue-item-tags"><small>{item.subjectName} › {item.topicName}</small>{item.sourceNote && <small>{item.sourceNote}</small>}</span></button>)}</nav>
      {question && <article className="review-detail-card"><header className="review-detail-header"><div><strong>MCQ #{question.id}</strong><StatusBadge status={question.status} /></div><span>Submitted by {question.authorName ?? "Unknown staff"}</span></header>
        <div className="review-detail-body"><section className="review-answer-preview"><p className="review-question-prompt"><LocalizedText>{question.prompt}</LocalizedText></p>{question.questionImageUrl && <Image src={question.questionImageUrl} alt="Question image" width={720} height={440} unoptimized />}<strong className="review-section-label">OPTIONS</strong><div className="review-detail-options">{question.choices.map((choice) => <div className={`review-choice ${choice.label === question.correctChoice ? "is-correct" : ""}`} key={choice.label}><b>{choice.label}</b><LocalizedText>{choice.text || "Image option"}</LocalizedText>{choice.label === question.correctChoice && <small>✓ Correct</small>}{choice.imageUrl && <Image src={choice.imageUrl} alt={`Option ${choice.label} image`} width={360} height={220} unoptimized />}</div>)}</div>{question.explanation && <details className="review-explanation" open><summary>EXPLANATION</summary><RichText value={question.explanation} /></details>}</section>
          <aside className="review-details-sidebar"><strong className="review-section-label">DETAILS</strong><dl><dt>Category</dt><dd>{question.subjectName} › {question.topicName}</dd><dt>Paper</dt><dd>{question.paperIds.length ? `${question.paperIds.length} linked paper${question.paperIds.length === 1 ? "" : "s"}` : "—"}</dd><dt>Author</dt><dd>{question.authorName ?? "Unknown staff"}</dd><dt>Language</dt><dd>{question.language === "ur" ? "Urdu" : "English"}</dd><dt>Difficulty</dt><dd>{question.difficulty[0].toUpperCase() + question.difficulty.slice(1)}</dd><dt>Source</dt><dd>{question.sourceNote || "—"}</dd></dl></aside>
        </div>
        {pending ? <footer className="review-decision-card"><label htmlFor="review-queue-comment">Reviewer comment <span>(required to reject or request changes)</span></label><textarea id="review-queue-comment" value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} placeholder="Explain what is correct or what needs revision…" />{error && <p className="form-error" role="alert">{error}</p>}<div className="review-decision-actions"><button className="button button-danger review-reject-button" type="button" disabled={busy || !note.trim()} onClick={() => void onDecide(question, "rejected")}>{busy ? "Saving…" : <>Reject <kbd>R</kbd></>}</button><button className="button button-light" type="button" disabled={busy || !note.trim()} onClick={() => void onDecide(question, "rejected")}>Request changes</button><button className="button button-primary" type="button" disabled={busy} onClick={() => void onDecide(question, "approved")}>{busy ? "Saving…" : <>Approve &amp; next <kbd>A</kbd></>}</button></div></footer> : question.reviewNote && <footer className="review-decision-card"><strong>Reviewer comment</strong><p>{question.reviewNote}</p></footer>}
      </article>}
    </div> : <div className="admin-empty-state review-empty-state"><strong>{pending ? "Review queue is clear" : `No ${status} questions found`}</strong><span>{pending ? "There are no questions waiting for a decision." : "Try another review status or adjust the filters."}</span></div>}
  </section>;
}


function SessionList({ questions, topics, papers, selectedPaperId, canManagePapers, canPublish, canDirectPublish, canDelete, canReviewMcqs, canCreateMcqs, canEditOwnMcqs, canEditAnyMcqs, currentUserId, onEdit, onAction }: { questions: Question[]; topics: Topic[]; papers: Paper[]; selectedPaperId: number | null; canManagePapers: boolean; canPublish: boolean; canDirectPublish: boolean; canDelete: boolean; canReviewMcqs: boolean; canCreateMcqs: boolean; canEditOwnMcqs: boolean; canEditAnyMcqs: boolean; currentUserId: string; onEdit: (question: Question) => void; onAction: (action: string, question: Question, values?: Record<string, unknown>) => Promise<void> }) {
  const [removePaperIds, setRemovePaperIds] = useState<Record<number, number>>({});
  return <section className="admin-panel mcq-session-panel"><div className="admin-panel-heading"><div><span className="eyebrow">THIS SESSION</span><h3>Recently added · {questions.length}</h3><p>{questions.length ? "Make quick corrections without leaving this page." : "Saved questions appear here so you can fix a typo without leaving this page."}</p></div></div>
    {!questions.length ? <p className="admin-empty">Saved questions will appear here.</p> : <div className="mcq-session-table-wrap"><table className="mcq-session-table"><thead><tr><th>ID</th><th>Question</th><th>Category</th><th>Paper links</th><th>Status</th><th>Actions</th></tr></thead><tbody>{questions.map((question) => {
      const attached = question.paperIds.map((id) => papers.find((paper) => paper.id === id)).filter((paper): paper is Paper => Boolean(paper));
      const removable = attached.find((paper) => paper.id === (removePaperIds[question.id] ?? selectedPaperId)) ?? attached[0];
      return <tr key={question.id} className={question.status === "archived" ? "is-archived" : ""}><td>#{question.id}</td><td><strong><LocalizedText>{question.prompt}</LocalizedText></strong><small>{question.sourceNote}</small></td><td><select aria-label={`Change category for MCQ ${question.id}`} value={String(question.topicId)} disabled={question.status === "archived" || !(canEditAnyMcqs || (canEditOwnMcqs && String(question.createdBy) === currentUserId && (question.status === "draft" || question.status === "rejected")))} onChange={(event) => void onAction("change-category", question, { topicId: Number(event.target.value) })}>{topics.filter((topic) => topic.status !== "archived").map((topic) => <option key={topic.id} value={topic.id}>{topic.subject_name} › {topic.name}</option>)}</select></td><td>{attached.length ? <>{attached.length} paper{attached.length === 1 ? "" : "s"}{canManagePapers && <select aria-label={`Select paper to remove MCQ ${question.id} from`} value={String(removePaperIds[question.id] ?? (selectedPaperId && question.paperIds.includes(selectedPaperId) ? selectedPaperId : attached[0].id))} onChange={(event) => setRemovePaperIds({ ...removePaperIds, [question.id]: Number(event.target.value) })}>{attached.map((paper) => <option key={paper.id} value={paper.id}>{paper.title}</option>)}</select>}</> : "—"}</td><td><span className={`admin-status admin-status-${question.status}`}>{question.status.replace("_", " ")}</span></td><td><div className="mcq-row-actions">{(canEditAnyMcqs || (canEditOwnMcqs && String(question.createdBy) === currentUserId && (question.status === "draft" || question.status === "rejected"))) && <button type="button" className="text-link" onClick={() => onEdit(question)}>Edit</button>}{canManagePapers && removable && <button type="button" className="text-link" onClick={() => void onAction("remove-from-paper", question, { paperId: removable.id })}>Remove from paper</button>}{canReviewMcqs && question.status === "in_review" && <ReviewDecision compact questionId={question.id} onDecide={(action, reviewNote) => void onAction(action, question, { reviewNote })} />}{canPublishQuestion(question.status, canPublish, canDirectPublish) && <button type="button" className="text-link" onClick={() => void onAction("publish", question)}>Publish</button>}{canCreateMcqs && question.status === "rejected" && <button type="button" className="text-link" onClick={() => void onAction("revise", question)}>Revise rejected MCQ</button>}{canCreateMcqs && question.status === "draft" && <button type="button" className="text-link" onClick={() => void onAction("submit-review", question)}>Submit for review</button>}{canDelete && question.status !== "archived" && <button type="button" className="text-link text-danger" onClick={() => void onAction("archive", question)}>Undo (archive)</button>}</div></td></tr>;
    })}</tbody></table></div>}
  </section>;
}
