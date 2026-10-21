import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2";
import { db, hasDatabase } from "@/lib/db";

export const LEARNER_COOKIE = "mcqpath_learner";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

export type LearnerPrincipal = { id: string; name: string; email: string };

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return secret;
}

export function hashLearnerPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyLearnerPassword(password: string, encoded: string) {
  const [algorithm, salt, digest] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !digest || !/^[a-f0-9]{128}$/i.test(digest)) return false;
  const expected = Buffer.from(digest, "hex");
  const supplied = scryptSync(password, salt, expected.length);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function createLearnerSession(principal: LearnerPrincipal) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = Buffer.from(JSON.stringify({ ...principal, expiresAt })).toString("base64url");
  return `${payload}.${createHmac("sha256", sessionSecret()).update(payload).digest("hex")}`;
}

function decodeLearnerSession(token?: string): LearnerPrincipal | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  try {
    const expected = Buffer.from(createHmac("sha256", sessionSecret()).update(payload).digest("hex"));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as LearnerPrincipal & { expiresAt: number };
    if (!session.id || !session.name || !session.email || session.expiresAt < Date.now() / 1000) return null;
    return { id: session.id, name: session.name, email: session.email };
  } catch {
    return null;
  }
}

export async function getLearnerPrincipal(): Promise<LearnerPrincipal | null> {
  const token = (await cookies()).get(LEARNER_COOKIE)?.value;
  if (!hasDatabase || !db || !process.env.SESSION_SECRET) return null;
  const session = decodeLearnerSession(token);
  if (!session) return null;
  const [rows] = await db.execute<(RowDataPacket & LearnerPrincipal & { status: string })[]>(
    "SELECT id, name, email, status FROM learners WHERE id = ? LIMIT 1", [session.id],
  );
  const learner = rows[0];
  return learner?.status === "active" ? { id: String(learner.id), name: learner.name, email: learner.email } : null;
}

export const learnerCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_SECONDS,
};
