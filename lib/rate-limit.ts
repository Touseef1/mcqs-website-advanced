import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db, hasDatabase } from "@/lib/db";

const memory = new Map<string, { started: number; hits: number }>();

function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || request.headers.get("x-real-ip") || "unknown").slice(0, 100);
}

export async function rateLimit(request: Request, scope: string, limit: number, windowSeconds: number) {
  const bucket = createHash("sha256").update(`${scope}:${clientAddress(request)}`).digest("hex");
  if (!hasDatabase || !db) {
    const now = Date.now(); const current = memory.get(bucket);
    if (!current || now - current.started >= windowSeconds * 1000) memory.set(bucket, { started: now, hits: 1 });
    else current.hits += 1;
    const entry = memory.get(bucket)!;
    return { allowed: entry.hits <= limit, retryAfter: Math.max(1, Math.ceil((windowSeconds * 1000 - (now - entry.started)) / 1000)) };
  }
  await db.execute(
    `INSERT INTO api_rate_limit_buckets (bucket_key, window_started_at, hits)
     VALUES (?, UTC_TIMESTAMP(), 1)
     ON DUPLICATE KEY UPDATE
       hits = IF(window_started_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND), 1, hits + 1),
       window_started_at = IF(window_started_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND), UTC_TIMESTAMP(), window_started_at)`,
    [bucket, windowSeconds, windowSeconds],
  );
  const [rows] = await db.execute<Array<RowDataPacket & { hits: number; seconds_left: number }>>(
    "SELECT hits, GREATEST(1, ? - TIMESTAMPDIFF(SECOND, window_started_at, UTC_TIMESTAMP())) AS seconds_left FROM api_rate_limit_buckets WHERE bucket_key = ?",
    [windowSeconds, bucket],
  );
  const row = rows[0];
  return { allowed: Number(row?.hits ?? 0) <= limit, retryAfter: Number(row?.seconds_left ?? windowSeconds) };
}
