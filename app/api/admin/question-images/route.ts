import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { auditAdmin, csrfFailure } from "@/lib/admin-security";

const maxBytes = 5 * 1024 * 1024;

function sniff(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (!principal || (!requirePermission(principal, "mcq.create") && !requirePermission(principal, "mcq.edit_any") && !requirePermission(principal, "mcq.edit_own"))) return NextResponse.json({ error: "Your role cannot upload MCQ images." }, { status: 403 });
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes + 65536) return NextResponse.json({ error: "Images must be no larger than 5 MB." }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image file." }, { status: 400 });
  if (file.size < 1 || file.size > maxBytes) return NextResponse.json({ error: "Images must be no larger than 5 MB." }, { status: 413 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = sniff(bytes);
  if (!ext) return NextResponse.json({ error: "Use a valid PNG, JPEG, or WebP image. SVG and other formats are not accepted." }, { status: 415 });
  const directory = path.join(process.cwd(), "public", "uploads", "mcqs");
  await mkdir(directory, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  await writeFile(path.join(directory, filename), bytes, { flag: "wx", mode: 0o644 });
  const url = `/uploads/mcqs/${filename}`;
  await auditAdmin(principal, request, "upload", "question_image", null, null, { url, bytes: file.size, type: ext });
  return NextResponse.json({ url }, { status: 201 });
}
