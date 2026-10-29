import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { getAdminPrincipal, requirePermission } from "@/lib/admin-auth";
import { db } from "@/lib/db";

const filenamePattern = /^[a-f0-9-]{36}\.(?:png|jpg|webp)$/i;
const mimeTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
const imagePermissions = ["mcq.create", "mcq.edit_any", "mcq.edit_own"] as const;

export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  if (!filenamePattern.test(filename)) return new NextResponse(null, { status: 404 });

  const principal = await getAdminPrincipal();
  const isStaff = principal && imagePermissions.some((permission) => requirePermission(principal, permission));
  if (!isStaff) {
    if (!db) return new NextResponse(null, { status: 404 });
    const [rows] = await db.execute<Array<RowDataPacket & { allowed: number }>>(
      `SELECT EXISTS (
         SELECT 1 FROM questions q
         WHERE q.status = 'published' AND SUBSTRING_INDEX(q.question_image_url, '/', -1) = ?
       ) OR EXISTS (
         SELECT 1 FROM choices c JOIN questions q ON q.id = c.question_id
         WHERE q.status = 'published' AND SUBSTRING_INDEX(c.image_url, '/', -1) = ?
       ) AS allowed`,
      [filename, filename],
    );
    if (!rows[0]?.allowed) return new NextResponse(null, { status: 404 });
  }

  try {
    const bytes = await readFile(path.join(process.cwd(), "uploads", "mcqs", filename));
    const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeTypes[extension],
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
