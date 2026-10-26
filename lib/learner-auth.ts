import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2";
import { db, hasDatabase } from "@/lib/db";

export const LEARNER_COOKIE = "mcqpath_learner";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

export type LearnerPrincipal = { id: string; name: string; email: string; sessionVersion?: number };

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

export function createLearnerSession(principal: LearnerPrincipal, sessionVersion = 1) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = Buffer.from(JSON.stringify({ ...principal, sessionVersion, expiresAt })).toString("base64url");
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
    if (!session.id || !session.name || !session.email || !Number.isInteger(session.sessionVersion) || session.expiresAt < Date.now() / 1000) return null;
    return { id: session.id, name: session.name, email: session.email, sessionVersion: session.sessionVersion };
  } catch {
    return null;
  }
}

export async function getLearnerPrincipal(): Promise<LearnerPrincipal | null> {
  const token = (await cookies()).get(LEARNER_COOKIE)?.value;
  if (!hasDatabase || !db || !process.env.SESSION_SECRET) return null;
  const session = decodeLearnerSession(token);
  if (!session) return null;
  const [rows] = await db.execute<(RowDataPacket & LearnerPrincipal & { status: string; email_verified_at: string | null })[]>(
    "SELECT id, name, email, status, email_verified_at, session_version AS sessionVersion FROM learners WHERE id = ? LIMIT 1", [session.id],
  );
  const learner = rows[0];
  return learner?.status === "active" && learner.email_verified_at && Number(learner.sessionVersion) === session.sessionVersion
    ? { id: String(learner.id), name: learner.name, email: learner.email, sessionVersion: Number(learner.sessionVersion) } : null;
}

export type LearnerTokenPurpose = "verify_email" | "reset_password";
export async function createLearnerActionToken(learnerId: number, email: string, purpose: LearnerTokenPurpose) {
  if (!db) throw new Error("Database is not configured.");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.execute("UPDATE learner_action_tokens SET used_at = NOW() WHERE learner_id = ? AND purpose = ? AND used_at IS NULL", [learnerId, purpose]);
  await db.execute("INSERT INTO learner_action_tokens (learner_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR))", [learnerId, tokenHash, purpose, purpose === "verify_email" ? 24 : 1]);
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const url = `${baseUrl}/account/${purpose === "verify_email" ? "verify" : "reset-password"}?token=${encodeURIComponent(token)}`;
  const subject = purpose === "verify_email" ? "Verify your MCQPath email" : "Reset your MCQPath password";
  const action = purpose === "verify_email" ? "Verify email" : "Reset password";
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "production") throw new Error("Email delivery is not configured.");
    console.info(`[MCQPath ${purpose}] ${email}: ${url}`);
    return;
  }
  const from = process.env.RESEND_FROM;
  if (!from) throw new Error("Set RESEND_FROM to a verified sender address.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [email], subject, html: `<p>Use the link below to ${action.toLowerCase()}.</p><p><a href="${url}">${action}</a></p><p>This link expires in ${purpose === "verify_email" ? "24 hours" : "1 hour"}.</p>` }),
  });
  if (!response.ok) throw new Error("Email delivery failed.");
}

export function hashLearnerActionToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

export const learnerCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_SECONDS,
};
