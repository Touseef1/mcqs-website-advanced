"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";

type Status = "draft" | "published" | "archived";
type Topic = { id: number; subject_id: number; subject_name: string; name: string; status: Status };
type Paper = { id: number; examId: number; examName: string; title: string; slug: string; year: number; type: "Past paper"; description: string; status: Status; questionCount: number; questionIds: number[] };
type Choice = { label: string; text: string };
type Question = { id: number; topicId: number; topicName: string; subjectName: string; prompt: string; explanation: string; sourceNote: string; correctChoice: string; difficulty: "easy" | "medium" | "hard"; status: Status; paperIds: number[]; choices: Choice[] };
type DraftQuestion = { prompt: string; choices: string[]; correctChoice: string; explanation: string };
type PreviewRow = DraftQuestion & { rowNumber: number; errors: string[] };
type Props = { topics: Topic[]; papers: Paper[]; canManagePapers: boolean; canPublish: boolean; canDelete: boolean; initialPaperId: number | null; onUpdated: () => Promise<void> };

const emptyDraft: DraftQuestion = { prompt: "", choices: ["", "", "", ""], correctChoice: "", explanation: "" };
const questionLabels = ["A", "B", "C", "D"] as const;
const contextStorageKey = "mcqpath:question-entry-context";
const sessionIdsKey = "mcqpath:question-entry-session-ids";
const sessionCountKey = "mcqpath:question-entry-session-count";

async function adminRequest<T = Record<string, unknown>>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
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
      errors: [],
    };
    item.errors.push(...validateDraft(item));
    return item;
  });
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

export function AdminQuestionWorkspace({ topics, papers, canManagePapers, canPublish, canDelete, initialPaperId, onUpdated }: Props) {
  const [mode, setMode] = useState<"quick" | "bulk" | "bank">("quick");
  const [paperOptions, setPaperOptions] = useState(papers);
  const [contextRestored, setContextRestored] = useState(false);
  const [topicId, setTopicId] = useState("");
  const [paperId, setPaperId] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [sourceNote, setSourceNote] = useState("");
  const [draft, setDraft] = useState<DraftQuestion>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingStatus, setEditingStatus] = useState<Status>("draft");
  const [editingPaperIds, setEditingPaperIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [similar, setSimilar] = useState<Array<{ id: number; prompt: string; similarity: number }>>([]);
  const [sessionQuestions, setSessionQuestions] = useState<Question[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [bankQuestions, setBankQuestions] = useState<Question[]>([]);
  const [bankSearch, setBankSearch] = useState("");
  const [bankTopic, setBankTopic] = useState("");
  const [bankPage, setBankPage] = useState(1);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankLoading, setBankLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkTopicId, setBulkTopicId] = useState("");
  const [bulkPaperId, setBulkPaperId] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [bulkRows, setBulkRows] = useState<PreviewRow[]>([]);
  const [csvFileName, setCsvFileName] = useState("");
  const [newPaperOpen, setNewPaperOpen] = useState(false);
  const [newPaperBusy, setNewPaperBusy] = useState(false);
  const [newPaperError, setNewPaperError] = useState("");
  const [newPaper, setNewPaper] = useState({ examName: "", title: "", year: String(new Date().getFullYear()) });
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const canUsePapers = canManagePapers;

  const topicOptions = useMemo(() => topics.filter((topic) => topic.status !== "archived").map((topic) => ({ value: String(topic.id), label: `${topic.subject_name} › ${topic.name}`, meta: topic.status })), [topics]);
  const paperPickerOptions = useMemo(() => paperOptions.filter((paper) => paper.status !== "archived").map((paper) => ({ value: String(paper.id), label: paper.title, meta: `${paper.examName} · ${paper.year} · ${paper.status}` })), [paperOptions]);
  const bankPages = Math.max(1, Math.ceil(bankTotal / 25));

  useEffect(() => {
    const timeout = window.setTimeout(() => setPaperOptions(papers), 0);
    return () => window.clearTimeout(timeout);
  }, [papers]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      if (!active) return;
    try {
      const context = JSON.parse(localStorage.getItem(`${contextStorageKey}:${window.location.pathname}`) ?? "null") as { topicId?: string; paperId?: string; difficulty?: string; sourceNote?: string } | null;
      if (context) {
        if (context.topicId && topicOptions.some((option) => option.value === context.topicId)) setTopicId(context.topicId);
        if (context.paperId && paperPickerOptions.some((option) => option.value === context.paperId)) setPaperId(context.paperId);
        if (context.difficulty === "easy" || context.difficulty === "medium" || context.difficulty === "hard") setDifficulty(context.difficulty);
        if (typeof context.sourceNote === "string") setSourceNote(context.sourceNote);
      }
      const ids = JSON.parse(sessionStorage.getItem(sessionIdsKey) ?? "[]") as number[];
      const count = Number(sessionStorage.getItem(sessionCountKey) ?? 0);
      if (Number.isFinite(count) && count >= 0) setSessionCount(Math.floor(count));
      if (Array.isArray(ids) && ids.some((id) => Number.isSafeInteger(id) && id > 0)) {
        const validIds = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(-100);
        adminRequest<{ questions: Question[] }>(`/api/admin/questions?ids=${validIds.join(",")}`).then((result) => setSessionQuestions(result.questions ?? [])).catch(() => undefined);
      }
    } catch { /* Ignore malformed local session state. */ }
      setContextRestored(true);
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [topicOptions, paperPickerOptions]);

  useEffect(() => {
    if (!initialPaperId || !paperPickerOptions.some((option) => option.value === String(initialPaperId))) return;
    const paper = paperOptions.find((item) => item.id === initialPaperId);
    const timeout = window.setTimeout(() => {
      setPaperId(String(initialPaperId));
      if (paper) setSourceNote(`${paper.examName} ${paper.year} Past Paper`);
      setMode("quick");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initialPaperId, paperOptions, paperPickerOptions]);

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
    try {
      const result = await adminRequest<{ questions: Question[]; total: number }>(`/api/admin/questions?${params}`);
      setBankQuestions(result.questions ?? []);
      setBankTotal(result.total ?? 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the MCQ bank.");
    } finally { setBankLoading(false); }
  }, [bankSearch, bankPage, bankTopic]);

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
        const result = await adminRequest<{ similar: Array<{ id: number; prompt: string; similarity: number }> }>("/api/admin/questions/similar", "POST", { topicId: Number(topicId), questionId: editingId, prompt: draft.prompt });
        if (!controller.signal.aborted) setSimilar(result.similar ?? []);
      } catch { if (!controller.signal.aborted) setSimilar([]); }
    }, 500);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [draft.prompt, topicId, editingId]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 4500);
  }

  function rememberSession(ids: number[], count: number) {
    try {
      sessionStorage.setItem(sessionIdsKey, JSON.stringify(ids.slice(-100)));
      sessionStorage.setItem(sessionCountKey, String(count));
    } catch { /* Session counter is a convenience only. */ }
  }

  function selectedPaper() { return paperOptions.find((paper) => String(paper.id) === paperId); }

  async function saveQuestion(closeAfterSave: boolean) {
    setError("");
    const validation = validateDraft(draft);
    if (!topicId) validation.unshift("Choose a category and topic in the context bar.");
    if (sourceNote.trim().length < 4) validation.unshift("Add a source note in the context bar.");
    if (validation.length) { setError(validation[0]); return; }
    setBusy(true);
    try {
      const paperIds = canUsePapers ? (editingId ? editingPaperIds : paperId ? [Number(paperId)] : []) : undefined;
      const body = { id: editingId ?? undefined, topicId: Number(topicId), paperIds, prompt: draft.prompt.trim(), choices: draft.choices.map((choice) => choice.trim()), correctChoice: draft.correctChoice, explanation: draft.explanation.trim(), sourceNote: sourceNote.trim(), difficulty, status: editingId ? editingStatus : "draft" };
      const result = await adminRequest<{ id?: number }>("/api/admin/questions", editingId ? "PATCH" : "POST", body);
      const id = editingId ?? Number(result.id);
      const topic = topics.find((item) => item.id === Number(topicId));
      const existing = sessionQuestions.find((question) => question.id === id);
      const item: Question = {
        id,
        topicId: Number(topicId),
        topicName: topic?.name ?? "Topic",
        subjectName: topic?.subject_name ?? "Subject",
        prompt: draft.prompt.trim(),
        explanation: draft.explanation.trim(),
        sourceNote: sourceNote.trim(),
        correctChoice: draft.correctChoice,
        difficulty,
        status: editingId ? editingStatus : "draft",
        paperIds: paperIds ?? existing?.paperIds ?? [],
        choices: draft.choices.map((text, index) => ({ label: questionLabels[index], text: text.trim() })),
      };
      const updatedSession = existing
        ? sessionQuestions.map((question) => question.id === id ? item : question)
        : [item, ...sessionQuestions];
      setSessionQuestions(updatedSession);
      let nextCount = sessionCount;
      if (!editingId) { nextCount++; setSessionCount(nextCount); }
      rememberSession(updatedSession.map((question) => question.id), nextCount);
      setDraft(emptyDraft);
      setEditingId(null);
      setEditingPaperIds([]);
      setSimilar([]);
      notify(`${editingId ? "Updated" : "Saved"} #${id}`);
      await onUpdated();
      if (closeAfterSave) setMode("bank");
      else window.setTimeout(() => questionRef.current?.focus(), 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The MCQ could not be saved.");
    } finally { setBusy(false); }
  }

  function onQuestionKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void saveQuestion(false);
    }
  }

  function editQuestion(question: Question) {
    setDraft({ prompt: question.prompt, choices: questionLabels.map((label) => question.choices.find((choice) => choice.label === label)?.text ?? ""), correctChoice: question.correctChoice, explanation: question.explanation ?? "" });
    setTopicId(String(question.topicId));
    setSourceNote(question.sourceNote);
    setDifficulty(question.difficulty);
    setEditingId(question.id);
    setEditingStatus(question.status);
    setEditingPaperIds(question.paperIds);
    if (canUsePapers && question.paperIds[0]) setPaperId(String(question.paperIds[0]));
    setMode("quick");
    window.setTimeout(() => questionRef.current?.focus(), 50);
  }

  async function sessionAction(action: string, question: Question, values: Record<string, unknown> = {}) {
    setError("");
    try {
      await adminRequest("/api/admin/questions/bulk", "POST", { action, ids: [question.id], ...values });
      if (action === "change-category" && typeof values.topicId === "number") {
        const topic = topics.find((item) => item.id === values.topicId);
        setSessionQuestions((items) => items.map((item) => item.id === question.id ? { ...item, topicId: Number(values.topicId), topicName: topic?.name ?? item.topicName, subjectName: topic?.subject_name ?? item.subjectName } : item));
      } else if (action === "remove-from-paper" && typeof values.paperId === "number") {
        setSessionQuestions((items) => items.map((item) => item.id === question.id ? { ...item, paperIds: item.paperIds.filter((id) => id !== values.paperId) } : item));
      } else if (action === "archive") {
        setSessionQuestions((items) => items.map((item) => item.id === question.id ? { ...item, status: "archived" } : item));
      } else if (action === "publish") {
        setSessionQuestions((items) => items.map((item) => item.id === question.id ? { ...item, status: "published" } : item));
      }
      notify(action === "change-category" ? "Category changed." : action === "remove-from-paper" ? "Removed from paper." : action === "archive" ? `Undo (archive) completed for #${question.id}.` : "MCQ updated.");
      await onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The action could not be completed."); }
  }

  async function createPaper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNewPaperBusy(true); setNewPaperError("");
    try {
      const result = await adminRequest<{ paper: Paper }>("/api/admin/papers/quick-create", "POST", { examName: newPaper.examName, title: newPaper.title, year: Number(newPaper.year) });
      setPaperOptions((items) => [result.paper, ...items]);
      setPaperId(String(result.paper.id));
      setSourceNote(`${result.paper.examName} ${result.paper.year} Past Paper`);
      setNewPaperOpen(false);
      setNewPaper({ examName: "", title: "", year: String(new Date().getFullYear()) });
      notify("Draft paper created and selected.");
      await onUpdated();
    } catch (cause) { setNewPaperError(cause instanceof Error ? cause.message : "The paper could not be created."); }
    finally { setNewPaperBusy(false); }
  }

  async function handleCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const text = await file.text();
    setPasteText(text);
    setBulkRows(parseCsv(text));
    setError("");
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
        difficulty, status: "draft", paperIds: paperId ? [Number(paperId)] : [],
        choices: row.choices.map((text, choiceIndex) => ({ label: questionLabels[choiceIndex], text: text.trim() })),
      }));
      const updatedSession = [...imported.reverse(), ...sessionQuestions];
      const nextCount = sessionCount + result.count;
      setSessionQuestions(updatedSession); setSessionCount(nextCount); rememberSession(updatedSession.map((item) => item.id), nextCount);
      setBulkRows([]); setPasteText(""); setCsvFileName("");
      notify(`Imported ${result.count} MCQs.`);
      await onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Bulk import failed; no MCQs were saved."); }
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
    setBusy(true); setError("");
    try {
      await adminRequest("/api/admin/questions/bulk", "POST", { action, ids: selectedIds, ...values });
      notify(`${selectedIds.length} MCQ${selectedIds.length === 1 ? "" : "s"} updated.`);
      setSelectedIds([]);
      await Promise.all([loadBank(), onUpdated()]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The bulk action failed."); }
    finally { setBusy(false); }
  }

  const paper = selectedPaper();
  const contextBar = <section className="mcq-context-bar" aria-label="MCQ entry context">
    <div className="mcq-context-heading"><div><span className="eyebrow">ENTRY CONTEXT</span><h2>Set once, keep adding</h2></div><span>Context stays after each save</span></div>
    <div className="mcq-context-grid">
      {canUsePapers && <SearchPicker id="mcq-context-paper" label="Exam / paper" value={paperId} options={paperPickerOptions} placeholder="Search exams and papers" onChange={(value) => { setPaperId(value); const selected = paperOptions.find((item) => String(item.id) === value); if (selected) setSourceNote(`${selected.examName} ${selected.year} Past Paper`); }} action={{ label: "+ New paper", onClick: () => { setNewPaperError(""); setNewPaperOpen(true); } }} />}
      <SearchPicker id="mcq-context-topic" label="Category · topic" value={topicId} options={topicOptions} placeholder="Search subject › topic" onChange={setTopicId} />
      <div className="mcq-context-field"><label htmlFor="mcq-context-difficulty">Default difficulty</label><select id="mcq-context-difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div>
      <div className="mcq-context-field"><label htmlFor="mcq-context-source">Source note</label><input id="mcq-context-source" value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} maxLength={500} placeholder={paper ? `${paper.examName} ${paper.year} Past Paper` : "Exam, year, and source"} /></div>
    </div>
    {paper && <p className="mcq-context-paper-note">New MCQs will be linked to <strong>{paper.title}</strong> in paper order.</p>}
  </section>;

  return <div className="admin-content-stack mcq-workspace">
    {contextBar}
    <div className="mcq-workspace-tabs" role="tablist" aria-label="MCQ tools">
      <button type="button" role="tab" aria-selected={mode === "quick"} className={mode === "quick" ? "active" : ""} onClick={() => setMode("quick")}>Quick entry</button>
      <button type="button" role="tab" aria-selected={mode === "bulk"} className={mode === "bulk" ? "active" : ""} onClick={() => setMode("bulk")}>Paste multiple MCQs</button>
      <button type="button" role="tab" aria-selected={mode === "bank"} className={mode === "bank" ? "active" : ""} onClick={() => setMode("bank")}>MCQ bank</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {toast && <div className="mcq-toast" role="status">{toast}</div>}

    {mode === "quick" && <>
      <section className="admin-panel mcq-entry-panel">
        <div className="admin-panel-heading"><div><span className="eyebrow">FAST MCQ ENTRY</span><h3>{editingId ? `Edit MCQ #${editingId}` : "Add a multiple-choice question"}</h3><p>Press Ctrl + Enter to save and continue.</p></div><span className="mcq-session-counter">{sessionCount} MCQs added in this session</span></div>
        <form className="admin-form mcq-entry-form" onSubmit={(event) => { event.preventDefault(); void saveQuestion(false); }} onKeyDown={onQuestionKeyDown}>
          <label htmlFor="fast-mcq-question">Question text</label>
          <textarea ref={questionRef} id="fast-mcq-question" value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} rows={3} minLength={8} maxLength={1500} required placeholder="Enter the question" />
          {similar.length > 0 && <aside className="mcq-similar-warning" role="status"><strong>Possible similar MCQ in this topic</strong>{similar.map((item) => <small key={item.id}>#{item.id} · {item.similarity}% similar · {item.prompt}</small>)}<small>This is only a warning; you can still save the question.</small></aside>}
          <div className="mcq-option-grid">{draft.choices.map((choice, index) => <div className="mcq-option-row" key={questionLabels[index]}><label className="mcq-correct-radio" htmlFor={`fast-mcq-correct-${index}`} title="Mark as correct"><input id={`fast-mcq-correct-${index}`} type="radio" name="fast-mcq-correct" value={questionLabels[index]} checked={draft.correctChoice === questionLabels[index]} onChange={() => setDraft({ ...draft, correctChoice: questionLabels[index] })} aria-label={`Option ${questionLabels[index]} is correct`} /></label><div><label htmlFor={`fast-mcq-option-${index}`}>Option {questionLabels[index]}{draft.correctChoice === questionLabels[index] && <b className="mcq-correct-label">Correct</b>}</label><input id={`fast-mcq-option-${index}`} value={choice} onChange={(event) => setDraft({ ...draft, choices: draft.choices.map((item, choiceIndex) => choiceIndex === index ? event.target.value : item) })} maxLength={800} required /></div></div>)}</div>
          <label htmlFor="fast-mcq-explanation">Explanation <span className="mcq-optional">optional</span></label>
          <textarea id="fast-mcq-explanation" value={draft.explanation} onChange={(event) => setDraft({ ...draft, explanation: event.target.value })} rows={2} maxLength={3000} placeholder="Explain the answer if useful" />
          <div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save & Add Next"}</button><button className="button button-light" type="button" disabled={busy} onClick={() => void saveQuestion(true)}>Save & Close</button>{editingId && <button className="button button-light" type="button" disabled={busy} onClick={() => { setEditingId(null); setEditingPaperIds([]); setDraft(emptyDraft); }}>Cancel edit</button>}</div>
          {canPublish && <p className="form-hint">New MCQs are saved as drafts. Publish them from the session list or MCQ bank after review.</p>}
        </form>
      </section>
      <SessionList questions={sessionQuestions} topics={topics} papers={paperOptions} selectedPaperId={paperId ? Number(paperId) : null} canManagePapers={canManagePapers} canPublish={canPublish} canDelete={canDelete} onEdit={editQuestion} onAction={sessionAction} />
    </>}

    {mode === "bulk" && <section className="admin-panel mcq-bulk-panel">
      <div className="admin-panel-heading"><div><span className="eyebrow">BULK ENTRY</span><h3>Paste multiple MCQs or upload a CSV</h3><p>Paste blank-line-separated question blocks, or use CSV columns: question, A, B, C, D, answer, explanation.</p></div></div>
      <label className="mcq-csv-upload" htmlFor="mcq-csv-file">Upload CSV <input id="mcq-csv-file" type="file" accept=".csv,text/csv" onChange={(event) => void handleCsvFile(event)} /></label>
      {csvFileName && <p className="admin-helper">Loaded {csvFileName}. You can also edit the parsed source below.</p>}
      <textarea className="mcq-bulk-textarea" value={pasteText} onChange={(event) => setPasteText(event.target.value)} rows={12} placeholder={`Q: Which word is a noun?\nA) Quickly\nB) Honest\nC) Teacher\nD) Run\nAnswer: C\nExplanation: A teacher is a person.\n\nQ: ...`} />
      <div className="admin-inline-actions"><button type="button" className="button button-light" onClick={previewText}>Preview pasted MCQs</button>{bulkRows.length > 0 && <button type="button" className="button button-primary" disabled={busy || !bulkRows.some((row) => !row.errors.length)} onClick={() => void importRows()}>{busy ? "Importing…" : `Import ${bulkRows.filter((row) => !row.errors.length).length} valid MCQs`}</button>}</div>
      {bulkRows.length > 0 && <div className="mcq-preview-wrap"><div className="admin-panel-heading"><div><h4>Preview · {bulkRows.filter((row) => !row.errors.length).length} valid / {bulkRows.length} rows</h4><p>Rows with errors will not be sent. Valid rows import together in one transaction.</p></div></div><div className="mcq-preview-table-wrap"><table className="mcq-preview-table"><thead><tr><th>Row</th><th>Question</th><th>Options</th><th>Answer</th><th>Validation</th></tr></thead><tbody>{bulkRows.map((row) => <tr key={row.rowNumber} className={row.errors.length ? "has-errors" : ""}><td>{row.rowNumber}</td><td>{row.prompt}</td><td>{row.choices.map((choice, index) => `${questionLabels[index]}) ${choice}`).join(" · ")}</td><td>{row.correctChoice}</td><td>{row.errors.length ? row.errors.join(" ") : "Ready"}</td></tr>)}</tbody></table></div></div>}
    </section>}

    {mode === "bank" && <section className="admin-panel mcq-bank-panel">
      <div className="admin-panel-heading"><div><span className="eyebrow">MCQ BANK</span><h3>{bankTotal.toLocaleString()} MCQs</h3></div></div>
      <div className="mcq-bank-filters"><input className="admin-filter" aria-label="Search MCQs" value={bankSearch} onChange={(event) => { setBankSearch(event.target.value); setBankPage(1); }} placeholder="Search question, source, subject, or topic…" /><select aria-label="Filter by category" value={bankTopic} onChange={(event) => { setBankTopic(event.target.value); setBankPage(1); }}><option value="">All categories</option>{topicOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
      {selectedIds.length > 0 && <div className="mcq-bulk-toolbar"><strong>{selectedIds.length} selected</strong><div className="mcq-bulk-control"><select aria-label="Bulk change category" value={bulkTopicId} onChange={(event) => setBulkTopicId(event.target.value)}><option value="">Choose category</option>{topicOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button type="button" className="button button-light" disabled={busy || !bulkTopicId} onClick={() => void runBulkAction("change-category")}>Change category</button></div>{canManagePapers && <div className="mcq-bulk-control"><select aria-label="Bulk paper action" value={bulkPaperId} onChange={(event) => setBulkPaperId(event.target.value)}><option value="">Choose paper</option>{paperPickerOptions.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.meta}</option>)}</select><button type="button" className="button button-light" disabled={busy || !bulkPaperId} onClick={() => void runBulkAction("add-to-paper")}>Add to paper</button></div>}<button type="button" className="button button-light" disabled={busy} onClick={() => void runBulkAction("submit-review")}>Submit for review</button>{canPublish && <button type="button" className="button button-primary" disabled={busy} onClick={() => void runBulkAction("publish")}>Publish</button>}{canDelete && <button type="button" className="button button-light" disabled={busy} onClick={() => void runBulkAction("archive")}>Archive</button>}<button type="button" className="text-link" onClick={() => setSelectedIds([])}>Clear</button></div>}
      {bankLoading ? <p className="loading-panel">Searching MCQs…</p> : <div className="mcq-bank-table-wrap"><table className="mcq-bank-table"><thead><tr><th><input type="checkbox" aria-label="Select all MCQs on this page" checked={bankQuestions.length > 0 && bankQuestions.every((item) => selectedIds.includes(item.id))} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, ...bankQuestions.map((item) => item.id)])] : current.filter((id) => !bankQuestions.some((item) => item.id === id)))} /></th><th>Question</th><th>Category</th><th>Difficulty</th><th>Status</th><th>Actions</th></tr></thead><tbody>{bankQuestions.map((question) => <tr key={question.id}><td><input type="checkbox" aria-label={`Select MCQ ${question.id}`} checked={selectedIds.includes(question.id)} onChange={(event) => toggleSelected(question.id, event.target.checked)} /></td><td><strong>#{question.id} · {question.prompt}</strong><small>{question.sourceNote}</small></td><td>{question.subjectName} › {question.topicName}</td><td>{question.difficulty}</td><td><span className={`admin-status admin-status-${question.status}`}>{question.status}</span></td><td><div className="admin-inline-actions"><button type="button" className="button button-light" disabled={question.status === "published" && !canPublish} onClick={() => editQuestion(question)}>Edit</button>{canPublish && question.status !== "published" && <button type="button" className="button button-primary" onClick={() => void sessionAction("publish", question)}>Publish</button>}{canDelete && question.status !== "archived" && <button type="button" className="button button-light" onClick={() => void sessionAction("archive", question)}>Archive</button>}</div></td></tr>)}{!bankQuestions.length && <tr><td colSpan={6}>No MCQs match these filters.</td></tr>}</tbody></table></div>}
      <div className="mcq-bank-pagination"><button type="button" className="button button-light" disabled={bankPage <= 1 || bankLoading} onClick={() => setBankPage((page) => Math.max(1, page - 1))}>← Previous</button><span>Page {bankPage} of {bankPages}</span><button type="button" className="button button-light" disabled={bankPage >= bankPages || bankLoading} onClick={() => setBankPage((page) => Math.min(bankPages, page + 1))}>Next →</button></div>
    </section>}

    {newPaperOpen && <div className="mcq-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewPaperOpen(false); }}><section className="mcq-new-paper-modal" role="dialog" aria-modal="true" aria-labelledby="mcq-new-paper-title"><div className="admin-panel-heading"><div><span className="eyebrow">QUICK CREATE</span><h3 id="mcq-new-paper-title">New past paper</h3><p>It will be saved as a draft. Add verified MCQs and source details before publishing.</p></div><button type="button" className="text-link" onClick={() => setNewPaperOpen(false)}>Close</button></div><form className="admin-form" onSubmit={(event) => void createPaper(event)}><label htmlFor="quick-paper-exam">Exam / commission</label><input id="quick-paper-exam" value={newPaper.examName} onChange={(event) => setNewPaper({ ...newPaper, examName: event.target.value })} maxLength={160} minLength={2} required placeholder="FPSC, PPSC, NTS…" /><label htmlFor="quick-paper-title">Paper title</label><input id="quick-paper-title" value={newPaper.title} onChange={(event) => setNewPaper({ ...newPaper, title: event.target.value })} maxLength={220} minLength={3} required placeholder="FPSC Assistant Written Test" /><label htmlFor="quick-paper-year">Year</label><input id="quick-paper-year" type="number" value={newPaper.year} onChange={(event) => setNewPaper({ ...newPaper, year: event.target.value })} min="1900" max="2200" required /><p className="form-hint">Source note will be set to “{newPaper.examName || "Exam"} {newPaper.year} Past Paper”.</p>{newPaperError && <p className="form-error" role="alert">{newPaperError}</p>}<div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={newPaperBusy}>{newPaperBusy ? "Creating…" : "Create & select paper"}</button><button className="button button-light" type="button" onClick={() => setNewPaperOpen(false)}>Cancel</button></div></form></section></div>}
  </div>;
}

function SessionList({ questions, topics, papers, selectedPaperId, canManagePapers, canPublish, canDelete, onEdit, onAction }: { questions: Question[]; topics: Topic[]; papers: Paper[]; selectedPaperId: number | null; canManagePapers: boolean; canPublish: boolean; canDelete: boolean; onEdit: (question: Question) => void; onAction: (action: string, question: Question, values?: Record<string, unknown>) => Promise<void> }) {
  const [removePaperIds, setRemovePaperIds] = useState<Record<number, number>>({});
  return <section className="admin-panel mcq-session-panel"><div className="admin-panel-heading"><div><span className="eyebrow">THIS SESSION</span><h3>Recently added MCQs · {questions.length}</h3><p>Make quick corrections here without leaving the entry screen.</p></div></div>
    {!questions.length ? <p className="admin-empty">Saved questions will appear here.</p> : <div className="mcq-session-table-wrap"><table className="mcq-session-table"><thead><tr><th>ID</th><th>Question</th><th>Category</th><th>Paper links</th><th>Status</th><th>Actions</th></tr></thead><tbody>{questions.map((question) => {
      const attached = question.paperIds.map((id) => papers.find((paper) => paper.id === id)).filter((paper): paper is Paper => Boolean(paper));
      const removable = attached.find((paper) => paper.id === (removePaperIds[question.id] ?? selectedPaperId)) ?? attached[0];
      return <tr key={question.id} className={question.status === "archived" ? "is-archived" : ""}><td>#{question.id}</td><td><strong>{question.prompt}</strong><small>{question.sourceNote}</small></td><td><select aria-label={`Change category for MCQ ${question.id}`} value={String(question.topicId)} disabled={question.status === "archived"} onChange={(event) => void onAction("change-category", question, { topicId: Number(event.target.value) })}>{topics.filter((topic) => topic.status !== "archived").map((topic) => <option key={topic.id} value={topic.id}>{topic.subject_name} › {topic.name}</option>)}</select></td><td>{attached.length ? <>{attached.length} paper{attached.length === 1 ? "" : "s"}{canManagePapers && <select aria-label={`Select paper to remove MCQ ${question.id} from`} value={String(removePaperIds[question.id] ?? (selectedPaperId && question.paperIds.includes(selectedPaperId) ? selectedPaperId : attached[0].id))} onChange={(event) => setRemovePaperIds({ ...removePaperIds, [question.id]: Number(event.target.value) })}>{attached.map((paper) => <option key={paper.id} value={paper.id}>{paper.title}</option>)}</select>}</> : "—"}</td><td><span className={`admin-status admin-status-${question.status}`}>{question.status}</span></td><td><div className="mcq-row-actions"><button type="button" className="text-link" onClick={() => onEdit(question)} disabled={question.status === "published" && !canPublish}>Edit</button>{canManagePapers && removable && <button type="button" className="text-link" onClick={() => void onAction("remove-from-paper", question, { paperId: removable.id })}>Remove from paper</button>}{canPublish && question.status === "draft" && <button type="button" className="text-link" onClick={() => void onAction("publish", question)}>Publish</button>}{canDelete && question.status !== "archived" && <button type="button" className="text-link text-danger" onClick={() => void onAction("archive", question)}>Undo (archive)</button>}</div></td></tr>;
    })}</tbody></table></div>}
  </section>;
}
