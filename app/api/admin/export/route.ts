import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { db, hasDatabase } from "@/lib/db";

type ExportQuestion = RowDataPacket & { id: number; prompt: string; topic: string; subject: string; source_note: string; explanation: string; correct_choice: string; question_image_url: string | null };
type ExportChoice = RowDataPacket & { question_id: number; label: string; choice_text: string; image_url: string | null };

function quoteCsv(value: unknown) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
function pdfEscape(value: string) { return value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "?").replace(/([\\()])/g, "\\$1"); }
function makePdf(title: string, lines: string[]) {
  const wrappedLines = lines.flatMap((line) => {
    const wrapped = line.match(/.{1,92}(?:\s|$)/g) ?? [line];
    return wrapped.map((part) => part.trim());
  });
  const pages = Array.from({ length: Math.max(1, Math.ceil(wrappedLines.length / 55)) }, (_, index) => wrappedLines.slice(index * 55, (index + 1) * 55));
  const pageIds = pages.map((_, index) => 3 + index);
  const fontId = 3 + pages.length * 2;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`];
  pages.forEach((pageLines, index) => {
    const pageId = 3 + index; const contentId = 3 + pages.length + index;
    objects[pageId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    const content = [`BT /F1 16 Tf 48 790 Td (${pdfEscape(`${title}${index ? " (continued)" : ""}`)}) Tj /F1 9 Tf 0 -24 Td`, ...pageLines.map((line) => `0 -13 Td (${pdfEscape(line)}) Tj`), "ET"].join("\n");
    objects[contentId - 1] = `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`;
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let output = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output, "ascii")); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output, "ascii");
}

export async function GET(request: Request) {
  const principal = await getAdminPrincipal();
  if (!principal || !requirePermission(principal, "content:view")) return NextResponse.json({ error: "Sign in with a content role." }, { status: 401 });
  if (!hasDatabase || !db) return NextResponse.json({ error: "Configure MySQL and apply migrations first." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind"); const id = Number(params.get("id")); const format = params.get("format") ?? "csv";
  if (!Number.isSafeInteger(id) || id < 1 || !["paper", "category"].includes(String(kind)) || !["csv", "pdf"].includes(format)) return NextResponse.json({ error: "Choose a paper or category and a CSV or PDF format." }, { status: 400 });
  let scope = ""; const values: number[] = [id]; let title = kind === "paper" ? `paper-${id}` : `category-${id}`;
  if (kind === "paper") {
    scope = "JOIN paper_questions pq ON pq.question_id = q.id AND pq.paper_id = ?";
    const [paperRows] = await db.execute<Array<RowDataPacket & { title: string }>>("SELECT title FROM papers WHERE id = ?", [id]);
    title = String(paperRows[0]?.title ?? title);
  } else if (params.get("categoryType") === "subject") {
    scope = "JOIN topics st ON st.id = q.topic_id AND st.subject_id = ?";
    const [categoryRows] = await db.execute<Array<RowDataPacket & { name: string }>>("SELECT name FROM subjects WHERE id = ?", [id]);
    title = String(categoryRows[0]?.name ?? title);
  } else {
    scope = "JOIN topics st ON st.id = q.topic_id AND st.id = ?";
    const [categoryRows] = await db.execute<Array<RowDataPacket & { name: string }>>("SELECT name FROM topics WHERE id = ?", [id]);
    title = String(categoryRows[0]?.name ?? title);
  }
  const [questions] = await db.execute<ExportQuestion[]>(
    `SELECT q.id, q.question_text AS prompt, q.question_image_url, t.name AS topic, s.name AS subject, q.source_note, q.explanation, q.correct_choice
       FROM questions q ${scope} JOIN topics t ON t.id = q.topic_id JOIN subjects s ON s.id = t.subject_id
      WHERE q.status != 'archived' ORDER BY q.id LIMIT 5000`, values,
  );
  const ids = questions.map((question) => question.id);
  const [choices] = ids.length ? await db.execute<ExportChoice[]>(`SELECT question_id,label,choice_text,image_url FROM choices WHERE question_id IN (${ids.map(() => "?").join(",")}) ORDER BY question_id,label`, ids) : [[] as ExportChoice[]];
  const choiceByQuestion = new Map<number, Map<string, ExportChoice>>();
  for (const choice of choices) { const map = choiceByQuestion.get(choice.question_id) ?? new Map<string, ExportChoice>(); map.set(choice.label, choice); choiceByQuestion.set(choice.question_id, map); }
  const header = ["ID", "Subject", "Topic", "Question", "Question image", "Option A", "Option B", "Option C", "Option D", "Option A image", "Option B image", "Option C image", "Option D image", "Correct option", "Explanation", "Source"];
  const rows = questions.map((question) => {
    const options = choiceByQuestion.get(question.id) ?? new Map<string, ExportChoice>();
    const labels = ["A", "B", "C", "D"];
    return [question.id, question.subject, question.topic, question.prompt, question.question_image_url ?? "", ...labels.map((label) => `${label}) ${options.get(label)?.choice_text ?? ""}`), ...labels.map((label) => options.get(label)?.image_url ?? ""), question.correct_choice, question.explanation, question.source_note];
  });
  const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mcqs";
  if (format === "csv") {
    const csv = [header, ...rows].map((row) => row.map(quoteCsv).join(",")).join("\r\n");
    return new NextResponse(`\uFEFF${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safeName}-mcqs.csv"`, "Cache-Control": "no-store" } });
  }
  const lines = rows.flatMap((row, index) => [`${index + 1}. ${row[3]} [${row[1]} / ${row[2]}]`, `Question image: ${row[4] || "none"}`, ...row.slice(5, 9).map(String), ...row.slice(9, 13).map((image, imageIndex) => `Option ${"ABCD"[imageIndex]} image: ${image || "none"}`), `Answer: ${row[13]} · Source: ${row[15]}`, `Explanation: ${row[14]}`, ""]);
  const pdf = makePdf(`${title} MCQs`, lines);
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safeName}-mcqs.pdf"`, "Cache-Control": "no-store" } });
}
