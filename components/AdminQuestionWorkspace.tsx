"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import Image from "next/image";
import { LocalizedText } from "@/components/LocalizedText";
import { containsUrduScript, detectQuestionLanguage } from "@/lib/language";
import { useConfirmModal } from "@/components/ConfirmModal";
import { ApiResponseError, ConfirmationCancelledError, getErrorMessage, isConfirmationCancelled, parseApiResponse } from "@/lib/error-message";
import { notify as toastNotify } from "@/lib/toast";

type Status = "draft" | "in_review" | "approved" | "published" | "rejected" | "archived";
type Topic = { id: number; subject_id: number; subject_name: string; name: string; status: Status };
type Paper = { id: number; examId: number; examName: string; title: string; slug: string; year: number; type: "Past paper" | "Model paper" | "Mock test"; description: string; status: Status; questionCount: number; questionIds: number[] };
type Choice = { label: string; text: string; imageUrl?: string | null };
type Question = { id: number; topicId: number; topicName: string; subjectName: string; prompt: string; questionImageUrl?: string | null; explanation: string; sourceNote: string; correctChoice: string; difficulty: "easy" | "medium" | "hard"; language: "en" | "ur"; authorName?: string; status: Status; version: number; reviewNote?: string | null; createdBy?: number | string; paperIds: number[]; choices: Choice[] };
type DraftQuestion = { prompt: string; choices: string[]; correctChoice: string; explanation: string; language: "en" | "ur"; questionImageUrl?: string | null; choiceImageUrls?: Array<string | null> };
type PreviewRow = DraftQuestion & { rowNumber: number; errors: string[] };
type Props = { topics: Topic[]; papers: Paper[]; canManagePapers: boolean; canAddQuestionsToPapers: boolean; canQuickCreatePaper: boolean; canPublish: boolean; canDirectPublish: boolean; canDelete: boolean; canCreateMcqs: boolean; canReviewMcqs: boolean; canEditOwnMcqs: boolean; canEditAnyMcqs: boolean; currentUserId: string; initialPaperId: number | null; initialSearch?: string; initialStatus?: string; startInBank?: boolean; onUpdated: () => Promise<void> };

const emptyDraft: DraftQuestion = { prompt: "", choices: ["", "", "", ""], correctChoice: "", explanation: "", language: "en", questionImageUrl: null, choiceImageUrls: [null, null, null, null] };
const questionLabels = ["A", "B", "C", "D"] as const;
const contextStorageKey = "mcqpath:question-entry-context";
const sessionIdsKey = "mcqpath:question-entry-session-ids";
const sessionCountKey = "mcqpath:question-entry-session-count";

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

export function AdminQuestionWorkspace({ topics, papers, canManagePapers, canAddQuestionsToPapers, canQuickCreatePaper, canPublish, canDirectPublish, canDelete, canCreateMcqs, canReviewMcqs, canEditOwnMcqs, canEditAnyMcqs, currentUserId, initialPaperId, initialSearch = "", initialStatus = "all", startInBank = false, onUpdated }: Props) {
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
  const [similar, setSimilar] = useState<Array<{ id: number; prompt: string; similarity: number; exact?: boolean }>>([]);
  const [sessionQuestions, setSessionQuestions] = useState<Question[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [bankQuestions, setBankQuestions] = useState<Question[]>([]);
  const [bankSearch, setBankSearch] = useState(initialSearch);
  const [bankStatus, setBankStatus] = useState(initialStatus);
  const [bankTopic, setBankTopic] = useState("");
  const [bankAuthor, setBankAuthor] = useState("");
  const [bankSource, setBankSource] = useState("");
  const [bankLanguage, setBankLanguage] = useState("");
  const [bankDensity, setBankDensity] = useState<"comfortable" | "compact">("comfortable");
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null);
  const [savedViews, setSavedViews] = useState<Array<{ name: string; status: string; topic: string; author: string; source: string; language: string }>>([]);
  const [savedViewName, setSavedViewName] = useState("");
  const [bankPage, setBankPage] = useState(1);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankLoading, setBankLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkTopicId, setBulkTopicId] = useState("");
  const [bulkPaperId, setBulkPaperId] = useState("");
  const [bulkReviewNote, setBulkReviewNote] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [bulkRows, setBulkRows] = useState<PreviewRow[]>([]);
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
  const bankPages = Math.max(1, Math.ceil(bankTotal / 25));
  const reviewQueueView = canReviewMcqs && ["in_review", "approved", "rejected"].includes(bankStatus);

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
    const params = new URLSearchParams({ search: bankSearch, page: String(bankPage), pageSize: "25" });
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
  }, [bankSearch, bankPage, bankTopic, bankStatus, bankAuthor, bankSource, bankLanguage]);

  useEffect(() => {
    if (mode !== "bank") return;
    const timeout = window.setTimeout(() => { void loadBank(); }, 180);
    return () => window.clearTimeout(timeout);
  }, [mode, loadBank]);

  useEffect(() => {
    if (draft.prompt.trim().length < 12 || !topicId) {
      const timeout = window.setTimeout(() => setSimilar([]), 0);
      return () => window.clearTimeout(timeout);
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const result = await adminRequest<{ similar: Array<{ id: number; prompt: string; similarity: number; exact?: boolean }> }>("/api/admin/questions/similar", "POST", { topicId: Number(topicId), questionId: editingId, prompt: draft.prompt });
        if (!controller.signal.aborted) setSimilar(result.similar ?? []);
      } catch (cause) { if (!controller.signal.aborted) { setSimilar([]); toastNotify.error(getErrorMessage(cause, "Could not check for similar MCQs.")); } }
    }, 500);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [draft.prompt, topicId, editingId]);

  function rememberSession(ids: number[], count: number) {
    try {
      sessionStorage.setItem(sessionIdsKey, JSON.stringify(ids.slice(-100)));
      sessionStorage.setItem(sessionCountKey, String(count));
    } catch { /* Session counter is a convenience only. */ }
  }

  function selectedPaper() { return paperOptions.find((paper) => String(paper.id) === paperId); }

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
    if (validation.length) { setError(validation[0]); return; }
    setBusy(true);
    try {
      const paperIds = canUsePapers ? (editingId ? editingPaperIds : paperId ? [Number(paperId)] : []) : undefined;
      const language = detectQuestionLanguage([draft.prompt, ...draft.choices, draft.explanation]);
      const body = { id: editingId ?? undefined, expectedVersion: editingId ? editingVersion : undefined, topicId: Number(topicId), paperIds, prompt: draft.prompt.trim(), questionImageUrl: draft.questionImageUrl ?? null, choiceImageUrls: draft.choiceImageUrls ?? [null, null, null, null], choices: draft.choices.map((choice) => choice.trim()), correctChoice: draft.correctChoice, explanation: draft.explanation.trim(), sourceNote: sourceNote.trim(), difficulty, language };
      const result = await adminRequest<{ id?: number; version?: number; status?: Status }>("/api/admin/questions", editingId ? "PATCH" : "POST", body, confirm);
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
        explanation: draft.explanation.trim(),
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
    window.setTimeout(() => questionRef.current?.focus(), 50);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditBaseline(null);
    setEditingPaperIds([]);
    setDraft(emptyDraft);
    setShowQuestionImage(false);
    setOpenChoiceImages([false, false, false, false]);
    setSimilar([]);
    setError("");
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
      setBulkRows(parseCsv(text));
      setError("");
    } catch (cause) { const message = getErrorMessage(cause, "Could not read the CSV file."); setError(message); toastNotify.error(message); }
  }

  function previewText() {
    setBulkRows(parseTextBlocks(pasteText));
    setCsvFileName("");
    setError("");
  }

  async function importRows() {
    const validRows = bulkRows.filter((row) => row.errors.length === 0);
    if (!validRows.length) { setError("There are no valid MCQs to import."); return; }
    if (!topicId || sourceNote.trim().length < 4) { setError("Choose a category and enter a source note in the context bar first."); return; }
    if (validRows.length > 100) { setError("Import up to 100 MCQs at a time."); return; }
    setBusy(true); setError("");
    try {
      const result = await adminRequest<{ ids: number[]; count: number }>("/api/admin/questions/bulk", "POST", {
        action: "import", topicId: Number(topicId), paperId: paperId ? Number(paperId) : null, difficulty, sourceNote: sourceNote.trim(), status: "draft",
        questions: validRows.map(({ prompt, choices, correctChoice, explanation }) => ({ prompt, choices, correctChoice, explanation })),
      });
      const topic = topics.find((item) => item.id === Number(topicId));
      const imported = validRows.map((row, index): Question => ({
        id: result.ids[index], topicId: Number(topicId), topicName: topic?.name ?? "Topic", subjectName: topic?.subject_name ?? "Subject",
        prompt: row.prompt.trim(), explanation: row.explanation.trim(), sourceNote: sourceNote.trim(), correctChoice: row.correctChoice,
        difficulty, language: detectQuestionLanguage([row.prompt, ...row.choices, row.explanation]), status: "draft", paperIds: paperId ? [Number(paperId)] : [],
        version: 1,
        choices: row.choices.map((text, choiceIndex) => ({ label: questionLabels[choiceIndex], text: text.trim() })),
      }));
      const updatedSession = [...imported.reverse(), ...sessionQuestions];
      const nextCount = sessionCount + result.count;
      setSessionQuestions(updatedSession); setSessionCount(nextCount); rememberSession(updatedSession.map((item) => item.id), nextCount);
      setBulkRows([]); setPasteText(""); setCsvFileName("");
      toastNotify.success(`Imported ${result.count} MCQs.`);
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
    if (action === "add-to-paper") values.paperId = Number(bulkPaperId);
    if (action === "remove-from-paper") values.paperId = Number(bulkPaperId);
    if (action === "approve") {
      const reviewNote = bulkReviewNote.trim();
      if (!reviewNote) { setError("Add a review comment before approving."); return; }
      values.reviewNote = reviewNote;
    }
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
    {canCreateMcqs && (mode === "quick" || mode === "bulk") && !editingId && <div className="mcq-entry-page-heading"><div><h1>{mode === "quick" ? "Add MCQ" : "Paste multiple MCQs"}</h1><p>{mode === "quick" ? "Set the context once, then keep adding. Ctrl + Enter saves and continues." : "Paste question blocks or upload a CSV, then review every row before importing."}</p></div><div className="mcq-entry-heading-actions">{mode === "quick" && <span className="mcq-session-counter">{sessionCount} added this session</span>}{mode === "quick" ? <button type="button" className="button button-light" onClick={() => setMode("bulk")}>Paste multiple MCQs</button> : <button type="button" className="button button-light" onClick={() => setMode("quick")}>Back to Add MCQ</button>}</div></div>}
    {canCreateMcqs && (mode === "quick" || mode === "bulk") && !editingId && contextBar}
    {mode === "bank" && <div className="admin-segment mcq-workspace-tabs" role="tablist" aria-label="MCQ tools">
      <button type="button" role="tab" aria-selected="true" className="active">MCQ bank</button>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}

    {(mode === "quick" || editingId !== null) && canCreateMcqs && <div className={editingId ? "mcq-edit-modal-backdrop" : undefined} role={editingId ? "presentation" : undefined} onMouseDown={editingId ? (event) => { if (event.target === event.currentTarget && !busy && !imageBusy) cancelEdit(); } : undefined}>
      <section className={editingId ? "mcq-edit-modal" : "mcq-quick-editor"} role={editingId ? "dialog" : undefined} aria-modal={editingId ? "true" : undefined} aria-labelledby={editingId ? "mcq-edit-modal-title" : undefined}>
        {editingId && <header className="mcq-edit-modal-header"><div><span className="eyebrow">EDIT MCQ</span><h2 id="mcq-edit-modal-title">MCQ #{editingId}</h2><p>Update the question, category, paper, and answer details.</p></div><button type="button" className="button button-light" disabled={busy || imageBusy} onClick={cancelEdit}>Close</button></header>}
        {editingId && contextBar}
        <section className="admin-panel mcq-entry-panel">
        <div className="mcq-entry-layout"><form className="admin-form mcq-entry-form" onSubmit={(event) => { event.preventDefault(); void saveQuestion(false); }} onKeyDown={onQuestionKeyDown}>
          <label htmlFor="fast-mcq-question">Question text</label>
          <textarea ref={questionRef} id="fast-mcq-question" lang={containsUrduScript(draft.prompt) ? "ur" : "en"} dir="auto" className={containsUrduScript(draft.prompt) ? "urdu-aware-input" : undefined} value={draft.prompt} onChange={(event) => setDraft((current) => { const prompt = event.target.value; return { ...current, prompt, language: detectQuestionLanguage([prompt, ...current.choices, current.explanation]) }; })} rows={3} minLength={8} maxLength={1500} required placeholder="Enter the question" />
          <div className="mcq-attach-row">{!showQuestionImage && !draft.questionImageUrl && <button type="button" className="text-link" onClick={() => setShowQuestionImage(true)}>Add question image</button>}{(showQuestionImage || draft.questionImageUrl) && <div className="mcq-attach-field"><label htmlFor="fast-mcq-question-image">Question image <span className="mcq-optional">optional · PNG, JPEG, or WebP · max 5 MB</span></label><input id="fast-mcq-question-image" className="mcq-file-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={imageBusy} onChange={(event) => void uploadImage(event.target.files?.[0], "question")} />{draft.questionImageUrl && <div className="mcq-image-preview"><Image src={draft.questionImageUrl} alt="Question attachment preview" width={160} height={160} unoptimized /><button type="button" className="text-link" onClick={() => { setDraft({ ...draft, questionImageUrl: null }); setShowQuestionImage(false); }}>Remove image</button></div>}</div>}</div>
          {similar.length > 0 && <aside className="mcq-similar-warning" role="status"><strong>{similar.some((item) => item.exact) ? "Duplicate question found after text normalization" : "Possible similar MCQ in this topic"}</strong>{similar.map((item) => <small key={item.id}>#{item.id} · {item.exact ? "normalized text match" : `${item.similarity}% similar`} · <LocalizedText>{item.prompt}</LocalizedText></small>)}<small>This is only a warning; you can still save the question.</small></aside>}
          <div className="mcq-options-heading"><span>Answer options</span><small>Choose the radio on the correct option.</small></div>
          <div className="mcq-option-grid">{draft.choices.map((choice, index) => <div className={`mcq-option-card ${draft.correctChoice === questionLabels[index] ? "is-correct" : ""}`} key={questionLabels[index]}><div className="mcq-option-head"><span className="mcq-option-letter">{questionLabels[index]}</span><label className="mcq-correct-radio" htmlFor={`fast-mcq-correct-${index}`}><input id={`fast-mcq-correct-${index}`} type="radio" name="fast-mcq-correct" value={questionLabels[index]} checked={draft.correctChoice === questionLabels[index]} onChange={() => setDraft({ ...draft, correctChoice: questionLabels[index] })} />{draft.correctChoice === questionLabels[index] ? "Correct answer" : "Mark correct"}</label><button type="button" className="text-link" onClick={() => setOpenChoiceImages((current) => current.map((open, choiceIndex) => choiceIndex === index ? !open : open))}>{draft.choiceImageUrls?.[index] ? "Image added" : "Add image"}</button></div><input id={`fast-mcq-option-${index}`} aria-label={`Option ${questionLabels[index]}`} value={choice} lang={containsUrduScript(choice) || (!choice.trim() && containsUrduScript(draft.prompt)) ? "ur" : "en"} dir="auto" className={containsUrduScript(choice) || (!choice.trim() && containsUrduScript(draft.prompt)) ? "urdu-aware-input" : undefined} onChange={(event) => setDraft((current) => { const choices = current.choices.map((item, choiceIndex) => choiceIndex === index ? event.target.value : item); return { ...current, choices, language: detectQuestionLanguage([current.prompt, ...choices, current.explanation]) }; })} maxLength={800} required placeholder={`Option ${questionLabels[index]}`} />{(openChoiceImages[index] || draft.choiceImageUrls?.[index]) && <div className="mcq-attach-field"><label htmlFor={`fast-mcq-option-image-${index}`}>Option {questionLabels[index]} image <span className="mcq-optional">optional</span></label><input id={`fast-mcq-option-image-${index}`} className="mcq-file-input" type="file" accept="image/png,image/jpeg,image/webp" disabled={imageBusy} onChange={(event) => void uploadImage(event.target.files?.[0], index)} />{draft.choiceImageUrls?.[index] && <div className="mcq-image-preview"><Image src={draft.choiceImageUrls[index] ?? ""} alt={`Option ${questionLabels[index]} attachment preview`} width={120} height={120} unoptimized /><button type="button" className="text-link" onClick={() => setDraft({ ...draft, choiceImageUrls: (draft.choiceImageUrls ?? [null, null, null, null]).map((url, choiceIndex) => choiceIndex === index ? null : url) })}>Remove image</button></div>}</div>}</div>)}</div>
          <label htmlFor="fast-mcq-explanation">Explanation <span className="mcq-optional">optional</span></label>
          <textarea id="fast-mcq-explanation" lang={containsUrduScript(draft.explanation) ? "ur" : "en"} dir="auto" className={containsUrduScript(draft.explanation) ? "urdu-aware-input" : undefined} value={draft.explanation} onChange={(event) => setDraft((current) => { const explanation = event.target.value; return { ...current, explanation, language: detectQuestionLanguage([current.prompt, ...current.choices, explanation]) }; })} rows={2} maxLength={3000} placeholder="Explain the answer if useful" />
          {editBaseline && editingStatus === "published" && <section className="mcq-edit-diff" aria-label="Before and after edit comparison"><div><span className="eyebrow">EDIT REVIEW</span><strong>Before / after</strong><small>This published MCQ will return to review when saved.</small></div><div className="mcq-diff-columns"><article><b>Before</b><p><LocalizedText>{editBaseline.prompt}</LocalizedText></p><ol>{editBaseline.choices.map((choice) => <li key={choice.label}>{choice.label}) <LocalizedText>{choice.text}</LocalizedText></li>)}</ol><small>Answer: {editBaseline.correctChoice}</small></article><article><b>After</b><p><LocalizedText>{draft.prompt || "Question text not entered"}</LocalizedText></p><ol>{draft.choices.map((choice, index) => <li key={questionLabels[index]}>{questionLabels[index]}) <LocalizedText>{choice || "Empty option"}</LocalizedText></li>)}</ol><small>Answer: {draft.correctChoice || "Not selected"}</small></article></div></section>}
          <div className="mcq-save-bar"><button className="button button-primary" type="submit" disabled={busy || imageBusy}>{busy ? "Saving…" : editingId ? "Save changes" : <>Save and add next <span>· Ctrl+Enter</span></>}</button><button className="button button-light" type="button" disabled={busy || imageBusy} onClick={() => void saveQuestion(true)}>Save and close</button>{editingId && <button className="button button-light" type="button" disabled={busy || imageBusy} onClick={cancelEdit}>Cancel edit</button>}<span className="mcq-save-hint">Saved as a draft. Send it to review from the MCQ bank.</span></div>
          {canCreateMcqs && <p className="form-hint">{canDirectPublish ? "Saving keeps the MCQ as a draft. You can publish it directly when its subject and topic are published, or send it through review." : "Saving keeps the MCQ as a draft. It stays off the public site until you submit it, a reviewer approves it, and someone with publish permission publishes it. The subject and topic must already be published."}</p>}
        </form><div className="mcq-entry-preview-column"><aside className="mcq-live-preview" aria-label="Learner view preview"><div className="mcq-live-preview-head"><strong>Learner view</strong><span>{draft.language === "ur" ? "اردو · RTL" : "English · LTR"}</span></div><article><p><LocalizedText>{draft.prompt || "Your question preview will appear here."}</LocalizedText></p>{draft.questionImageUrl && <Image src={draft.questionImageUrl} alt="Question preview" width={640} height={360} unoptimized />}{draft.choices.map((choice, index) => <div key={questionLabels[index]} className={draft.correctChoice === questionLabels[index] ? "is-preview-answer" : ""}><b>{questionLabels[index]}</b><LocalizedText>{choice || `Option ${questionLabels[index]}`}</LocalizedText>{draft.choiceImageUrls?.[index] && <Image src={draft.choiceImageUrls[index] ?? ""} alt={`Option ${questionLabels[index]} preview`} width={480} height={260} unoptimized />}</div>)}<small>The answer key stays hidden until the learner submits.</small></article></aside>
          {!editingId && <SessionList questions={sessionQuestions} topics={topics} papers={paperOptions} selectedPaperId={paperId ? Number(paperId) : null} canManagePapers={canManagePapers} canPublish={canPublish} canDirectPublish={canDirectPublish} canDelete={canDelete} canReviewMcqs={canReviewMcqs} canCreateMcqs={canCreateMcqs} canEditOwnMcqs={canEditOwnMcqs} canEditAnyMcqs={canEditAnyMcqs} currentUserId={currentUserId} onEdit={editQuestion} onAction={sessionAction} />}
        </div></div>
      </section>
      </section>
    </div>}

    {mode === "bulk" && canCreateMcqs && <section className="admin-panel mcq-bulk-panel">
      <div className="admin-panel-heading"><div><span className="eyebrow">BULK ENTRY</span><h3>Paste multiple MCQs or upload a CSV</h3><p>Paste blank-line-separated question blocks, or use CSV columns: question, A, B, C, D, answer, explanation.</p></div></div>
      <p className="form-hint">Question language is detected automatically for each MCQ.</p>
      <label className="mcq-csv-upload" htmlFor="mcq-csv-file">Upload CSV <input id="mcq-csv-file" type="file" accept=".csv,text/csv" onChange={(event) => void handleCsvFile(event)} /></label>
      {csvFileName && <p className="admin-helper">Loaded {csvFileName}. You can also edit the parsed source below.</p>}
      <textarea className={`mcq-bulk-textarea ${containsUrduScript(pasteText) ? "urdu-aware-input" : ""}`} lang={containsUrduScript(pasteText) ? "ur" : "en"} dir="auto" value={pasteText} onChange={(event) => setPasteText(event.target.value)} rows={12} placeholder={`Q: Which word is a noun?\nA) Quickly\nB) Honest\nC) Teacher\nD) Run\nAnswer: C\nExplanation: A teacher is a person.\n\nQ: ...`} />
      <div className="admin-inline-actions"><button type="button" className="button button-light" onClick={previewText}>Preview pasted MCQs</button>{bulkRows.length > 0 && <button type="button" className="button button-primary" disabled={busy || !bulkRows.some((row) => !row.errors.length)} onClick={() => void importRows()}>{busy ? "Importing…" : `Import ${bulkRows.filter((row) => !row.errors.length).length} valid MCQs`}</button>}</div>
      {bulkRows.length > 0 && <div className="mcq-preview-wrap"><div className="admin-panel-heading"><div><h4>Preview · {bulkRows.filter((row) => !row.errors.length).length} valid / {bulkRows.length} rows</h4><p>Rows with errors will not be sent. Valid rows import together in one transaction.</p></div></div><div className="mcq-preview-table-wrap"><table className="mcq-preview-table"><thead><tr><th>Row</th><th>Question</th><th>Options</th><th>Answer</th><th>Validation</th></tr></thead><tbody>{bulkRows.map((row) => <tr key={row.rowNumber} className={row.errors.length ? "has-errors" : ""}><td>{row.rowNumber}</td><td><LocalizedText>{row.prompt}</LocalizedText></td><td>{row.choices.map((choice, index) => <span key={index}>{questionLabels[index]}) <LocalizedText>{choice}</LocalizedText>{index < row.choices.length - 1 ? " · " : ""}</span>)}</td><td>{row.correctChoice}</td><td>{row.errors.length ? row.errors.join(" ") : "Ready"}</td></tr>)}</tbody></table></div></div>}
    </section>}

    {mode === "bank" && <section className={`admin-panel mcq-bank-panel ${reviewQueueView ? "is-review-queue-mode" : ""}`}>
      {!reviewQueueView && <div className="admin-panel-heading"><div><span className="eyebrow">MCQ BANK</span><h3>{bankTotal.toLocaleString()} MCQs</h3></div></div>}
      <div className="mcq-bank-filters mcq-bank-filter-chips">
        <input className="admin-filter" aria-label="Search MCQs" value={bankSearch} onChange={(event) => { setBankSearch(event.target.value); setBankPage(1); }} placeholder="Search question, source, subject, or topic…" />
        <label>Status<select aria-label="Filter by question status" value={bankStatus} onChange={(event) => { setBankStatus(event.target.value); setBankPage(1); }}><option value="all">All statuses</option><option value="draft">Draft</option><option value="in_review">In review</option><option value="approved">Approved</option><option value="published">Published</option><option value="rejected">Rejected</option><option value="archived">Archived</option></select></label>
        <label>Topic<select aria-label="Filter by category" value={bankTopic} onChange={(event) => { setBankTopic(event.target.value); setBankPage(1); }}><option value="">All topics</option>{topicOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Author<input aria-label="Filter by author" value={bankAuthor} onChange={(event) => { setBankAuthor(event.target.value); setBankPage(1); }} placeholder="Staff name" /></label>
        <label>Source<input aria-label="Filter by source" value={bankSource} onChange={(event) => { setBankSource(event.target.value); setBankPage(1); }} placeholder="Exam / source" /></label>
        <label>Language<select aria-label="Filter by language" value={bankLanguage} onChange={(event) => { setBankLanguage(event.target.value); setBankPage(1); }}><option value="">All languages</option><option value="en">English</option><option value="ur">Urdu</option></select></label>
      </div>
      {!reviewQueueView && <div className="mcq-bank-view-tools"><div className="mcq-saved-views"><label htmlFor="mcq-saved-view">Saved views</label><select id="mcq-saved-view" value="" onChange={(event) => { const view = savedViews.find((item) => item.name === event.target.value); if (view) applySavedView(view); }}><option value="">Choose a view</option>{savedViews.map((view) => <option value={view.name} key={view.name}>{view.name}</option>)}</select><input aria-label="Saved view name" value={savedViewName} onChange={(event) => setSavedViewName(event.target.value)} maxLength={40} placeholder="Name this view" /><button className="button button-light" type="button" disabled={!savedViewName.trim()} onClick={saveCurrentView}>Save view</button></div><div className="mcq-density-control" role="group" aria-label="Table density"><span>Density</span><button type="button" aria-pressed={bankDensity === "comfortable"} className={bankDensity === "comfortable" ? "active" : ""} onClick={() => setBankDensity("comfortable")}>Comfortable</button><button type="button" aria-pressed={bankDensity === "compact"} className={bankDensity === "compact" ? "active" : ""} onClick={() => setBankDensity("compact")}>Compact</button></div></div>}
      {!reviewQueueView && selectedIds.length > 0 && <div className="mcq-bulk-toolbar"><strong>{selectedIds.length} selected</strong>{(canEditAnyMcqs || canEditOwnMcqs) && <div className="mcq-bulk-control"><select aria-label="Bulk change category" value={bulkTopicId} onChange={(event) => setBulkTopicId(event.target.value)}><option value="">Choose category</option>{topicOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button type="button" className="button button-light" disabled={busy || !bulkTopicId} onClick={() => void runBulkAction("change-category")}>Change category</button></div>}{canManagePapers && <div className="mcq-bulk-control"><select aria-label="Bulk paper action" value={bulkPaperId} onChange={(event) => setBulkPaperId(event.target.value)}><option value="">Choose paper</option>{paperPickerOptions.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.meta}</option>)}</select><button type="button" className="button button-light" disabled={busy || !bulkPaperId} onClick={() => void runBulkAction("add-to-paper")}>Add to paper</button></div>}{canCreateMcqs && <button type="button" className="button button-light" disabled={busy} onClick={() => void runBulkAction("submit-review")}>Submit for review</button>}{canReviewMcqs && <div className="mcq-bulk-control"><input aria-label="Bulk review comment" value={bulkReviewNote} onChange={(event) => setBulkReviewNote(event.target.value)} placeholder="Review comment" maxLength={2000} /><button type="button" className="button button-primary" disabled={busy || !bulkReviewNote.trim()} onClick={() => void runBulkAction("approve")}>Approve</button></div>}{canPublish && <button type="button" className="button button-primary" disabled={busy} onClick={() => void runBulkAction("publish")}>Publish</button>}{canDelete && <button type="button" className="button button-light" disabled={busy} onClick={() => void runBulkAction("archive")}>Archive</button>}<button type="button" className="text-link" onClick={() => setSelectedIds([])}>Clear</button></div>}
      {bankLoading ? <p className="loading-panel">Searching MCQs…</p> : reviewQueueView ? <ReviewQueuePane questions={bankQuestions} total={bankTotal} note={reviewNote} setNote={setReviewNote} busy={busy} error={error} status={bankStatus} onDecide={reviewCurrentQuestion} onStatusChange={(status) => { setBankStatus(status); setBankPage(1); }} /> : <div className="mcq-bank-table-wrap"><table className={`mcq-bank-table mcq-bank-table-${bankDensity}`}><thead><tr><th><input type="checkbox" aria-label="Select all MCQs on this page" checked={bankQuestions.length > 0 && bankQuestions.every((item) => selectedIds.includes(item.id))} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, ...bankQuestions.map((item) => item.id)])] : current.filter((id) => !bankQuestions.some((item) => item.id === id)))} /></th><th>Question</th><th>Category</th><th>Difficulty</th><th>Status</th><th>Actions</th></tr></thead><tbody>{bankQuestions.map((question) => <tr key={question.id}><td><input type="checkbox" aria-label={`Select MCQ ${question.id}`} checked={selectedIds.includes(question.id)} onChange={(event) => toggleSelected(question.id, event.target.checked)} /></td><td><strong>#{question.id} · <LocalizedText>{question.prompt}</LocalizedText></strong><small>{question.sourceNote} · {question.authorName ?? "Unknown staff"} · {question.language === "ur" ? "Urdu" : "English"}</small>{question.questionImageUrl && <Image className="mcq-bank-thumb" src={question.questionImageUrl} alt="Question image" width={72} height={48} unoptimized />}{question.status === "rejected" && <small className="form-error">Review: {question.reviewNote || "Please revise this MCQ."}</small>}</td><td>{question.subjectName} › {question.topicName}</td><td>{question.difficulty}</td><td><span className={`admin-status admin-status-${question.status}`}>{question.status}</span></td><td><div className="admin-inline-actions"><button type="button" className="button button-light" onClick={() => setPreviewQuestion(question)}>Preview</button>{(canEditAnyMcqs || (canEditOwnMcqs && String(question.createdBy) === currentUserId && (question.status === "draft" || question.status === "rejected"))) && <button type="button" className="button button-light" onClick={() => editQuestion(question)}>Edit</button>}{canReviewMcqs && question.status === "in_review" && <ReviewDecision questionId={question.id} onDecide={(action, reviewNote) => void sessionAction(action, question, { reviewNote })} />}{canPublishQuestion(question.status, canPublish, canDirectPublish) && <button type="button" className="button button-primary" onClick={() => void sessionAction("publish", question)}>Publish</button>}{canDelete && question.status !== "archived" && <button type="button" className="button button-light" onClick={() => void sessionAction("archive", question)}>Archive</button>}</div></td></tr>)}{!bankQuestions.length && <tr><td colSpan={6}><div className="admin-empty-state"><strong>No MCQs match these filters</strong><span>Change a filter or clear the search to see more questions.</span><button type="button" className="button button-light" onClick={() => { setBankSearch(""); setBankTopic(""); setBankAuthor(""); setBankSource(""); setBankLanguage(""); setBankStatus("all"); }}>Clear filters</button></div></td></tr>}</tbody></table></div>}
      {!reviewQueueView && <div className="mcq-bank-pagination"><button type="button" className="button button-light" disabled={bankPage <= 1 || bankLoading} onClick={() => setBankPage((page) => Math.max(1, page - 1))}>Previous</button><span>Page {bankPage} of {bankPages}</span><button type="button" className="button button-light" disabled={bankPage >= bankPages || bankLoading} onClick={() => setBankPage((page) => Math.min(bankPages, page + 1))}>Next</button></div>}
    </section>}

    {previewQuestion && <div className="mcq-preview-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewQuestion(null); }}><aside className="mcq-preview-drawer" role="dialog" aria-modal="true" aria-labelledby="mcq-preview-title"><div className="admin-panel-heading"><div><span className="eyebrow">LEARNER PREVIEW</span><h3 id="mcq-preview-title">MCQ #{previewQuestion.id}</h3></div><button type="button" className="button button-light" onClick={() => setPreviewQuestion(null)}>Close</button></div><p><LocalizedText>{previewQuestion.prompt}</LocalizedText></p>{previewQuestion.questionImageUrl && <Image src={previewQuestion.questionImageUrl} alt="Question image" width={640} height={360} unoptimized />}{previewQuestion.choices.map((choice) => <article className="mcq-preview-choice" key={choice.label}><b>{choice.label}</b><LocalizedText>{choice.text}</LocalizedText>{choice.imageUrl && <Image src={choice.imageUrl} alt={`Option ${choice.label} image`} width={480} height={280} unoptimized />}</article>)}<small>{previewQuestion.subjectName} › {previewQuestion.topicName} · {previewQuestion.sourceNote} · {previewQuestion.status}</small>{previewQuestion.explanation && <details><summary>Explanation</summary><p><LocalizedText>{previewQuestion.explanation}</LocalizedText></p></details>}</aside></div>}

    {newPaperOpen && <div className="mcq-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewPaperOpen(false); }}><section className="mcq-new-paper-modal" role="dialog" aria-modal="true" aria-labelledby="mcq-new-paper-title"><div className="admin-panel-heading"><div><span className="eyebrow">QUICK CREATE</span><h3 id="mcq-new-paper-title">New past paper</h3><p>It will be saved as a draft. Add verified MCQs and source details before publishing.</p></div><button type="button" className="text-link" onClick={() => setNewPaperOpen(false)}>Close</button></div><form className="admin-form" onSubmit={(event) => void createPaper(event)}><label htmlFor="quick-paper-exam">Exam / commission</label><input id="quick-paper-exam" value={newPaper.examName} onChange={(event) => setNewPaper({ ...newPaper, examName: event.target.value })} maxLength={160} minLength={2} required placeholder="FPSC, PPSC, NTS…" /><label htmlFor="quick-paper-title">Paper title</label><input id="quick-paper-title" value={newPaper.title} onChange={(event) => setNewPaper({ ...newPaper, title: event.target.value })} maxLength={220} minLength={3} required placeholder="FPSC Assistant Written Test" /><label htmlFor="quick-paper-year">Year</label><input id="quick-paper-year" type="number" value={newPaper.year} onChange={(event) => setNewPaper({ ...newPaper, year: event.target.value })} min="1900" max="2200" required /><p className="form-hint">Source note will be set to “{newPaper.examName || "Exam"} {newPaper.year} Past Paper”.</p>{newPaperError && <p className="form-error" role="alert">{newPaperError}</p>}<div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={newPaperBusy}>{newPaperBusy ? "Creating…" : "Create & select paper"}</button><button className="button button-light" type="button" onClick={() => setNewPaperOpen(false)}>Cancel</button></div></form></section></div>}
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
        <div className="review-detail-body"><section className="review-answer-preview"><p className="review-question-prompt"><LocalizedText>{question.prompt}</LocalizedText></p>{question.questionImageUrl && <Image src={question.questionImageUrl} alt="Question image" width={720} height={440} unoptimized />}<strong className="review-section-label">OPTIONS</strong><div className="review-detail-options">{question.choices.map((choice) => <div className={`review-choice ${choice.label === question.correctChoice ? "is-correct" : ""}`} key={choice.label}><b>{choice.label}</b><LocalizedText>{choice.text || "Image option"}</LocalizedText>{choice.label === question.correctChoice && <small>Correct answer</small>}{choice.imageUrl && <Image src={choice.imageUrl} alt={`Option ${choice.label} image`} width={360} height={220} unoptimized />}</div>)}</div>{question.explanation && <details className="review-explanation" open><summary>EXPLANATION</summary><p><LocalizedText>{question.explanation}</LocalizedText></p></details>}</section>
          <aside className="review-details-sidebar"><strong className="review-section-label">DETAILS</strong><dl><dt>Category</dt><dd>{question.subjectName} › {question.topicName}</dd><dt>Paper</dt><dd>{question.paperIds.length ? `${question.paperIds.length} linked paper${question.paperIds.length === 1 ? "" : "s"}` : "—"}</dd><dt>Author</dt><dd>{question.authorName ?? "Unknown staff"}</dd><dt>Language</dt><dd>{question.language === "ur" ? "Urdu" : "English"}</dd><dt>Difficulty</dt><dd>{question.difficulty[0].toUpperCase() + question.difficulty.slice(1)}</dd><dt>Source</dt><dd>{question.sourceNote || "—"}</dd></dl></aside>
        </div>
        {pending ? <footer className="review-decision-card"><label htmlFor="review-queue-comment">Reviewer comment <span>(required to reject or request changes)</span></label><textarea id="review-queue-comment" value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} placeholder="Explain what is correct or what needs revision…" />{error && <p className="form-error" role="alert">{error}</p>}<div className="review-decision-actions"><button className="button button-danger review-reject-button" type="button" disabled={busy || !note.trim()} onClick={() => void onDecide(question, "rejected")}>{busy ? "Saving…" : "Reject · R"}</button><button className="button button-light" type="button" disabled={busy || !note.trim()} onClick={() => void onDecide(question, "rejected")}>Request changes</button><button className="button button-primary" type="button" disabled={busy} onClick={() => void onDecide(question, "approved")}>{busy ? "Saving…" : "Approve and next · A"}</button></div></footer> : question.reviewNote && <footer className="review-decision-card"><strong>Reviewer comment</strong><p>{question.reviewNote}</p></footer>}
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
      return <tr key={question.id} className={question.status === "archived" ? "is-archived" : ""}><td>#{question.id}</td><td><strong><LocalizedText>{question.prompt}</LocalizedText></strong><small>{question.sourceNote}</small></td><td><select aria-label={`Change category for MCQ ${question.id}`} value={String(question.topicId)} disabled={question.status === "archived" || !(canEditAnyMcqs || (canEditOwnMcqs && String(question.createdBy) === currentUserId && (question.status === "draft" || question.status === "rejected")))} onChange={(event) => void onAction("change-category", question, { topicId: Number(event.target.value) })}>{topics.filter((topic) => topic.status !== "archived").map((topic) => <option key={topic.id} value={topic.id}>{topic.subject_name} › {topic.name}</option>)}</select></td><td>{attached.length ? <>{attached.length} paper{attached.length === 1 ? "" : "s"}{canManagePapers && <select aria-label={`Select paper to remove MCQ ${question.id} from`} value={String(removePaperIds[question.id] ?? (selectedPaperId && question.paperIds.includes(selectedPaperId) ? selectedPaperId : attached[0].id))} onChange={(event) => setRemovePaperIds({ ...removePaperIds, [question.id]: Number(event.target.value) })}>{attached.map((paper) => <option key={paper.id} value={paper.id}>{paper.title}</option>)}</select>}</> : "—"}</td><td><span className={`admin-status admin-status-${question.status}`}>{question.status}</span></td><td><div className="mcq-row-actions">{(canEditAnyMcqs || (canEditOwnMcqs && String(question.createdBy) === currentUserId && (question.status === "draft" || question.status === "rejected"))) && <button type="button" className="text-link" onClick={() => onEdit(question)}>Edit</button>}{canManagePapers && removable && <button type="button" className="text-link" onClick={() => void onAction("remove-from-paper", question, { paperId: removable.id })}>Remove from paper</button>}{canReviewMcqs && question.status === "in_review" && <ReviewDecision compact questionId={question.id} onDecide={(action, reviewNote) => void onAction(action, question, { reviewNote })} />}{canPublishQuestion(question.status, canPublish, canDirectPublish) && <button type="button" className="text-link" onClick={() => void onAction("publish", question)}>Publish</button>}{canCreateMcqs && question.status === "rejected" && <button type="button" className="text-link" onClick={() => void onAction("revise", question)}>Revise rejected MCQ</button>}{canCreateMcqs && question.status === "draft" && <button type="button" className="text-link" onClick={() => void onAction("submit-review", question)}>Submit for review</button>}{canDelete && question.status !== "archived" && <button type="button" className="text-link text-danger" onClick={() => void onAction("archive", question)}>Undo (archive)</button>}</div></td></tr>;
    })}</tbody></table></div>}
  </section>;
}
