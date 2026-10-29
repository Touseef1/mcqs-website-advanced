import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { RowDataPacket } from "mysql2";
import { db, hasDatabase } from "@/lib/db";

export const ADMIN_COOKIE = "mcqs_admin";
export const ADMIN_SESSION_SECONDS = 60 * 60 * 8;
export type AdminRole = "super_admin" | "admin" | "data_entry" | "reviewer" | "publisher";
export type AdminPermission =
  | "content:view" | "mcq.create" | "mcq.edit_own" | "mcq.edit_any" | "mcq.review" | "mcq.publish" | "mcq.archive"
  | "category.manage" | "paper.manage" | "paper.publish" | "user.manage" | "super_admin.manage" | "system.settings"
  | "paper.add_questions" | "paper.quickcreate"
  // Legacy keys remain accepted temporarily so every existing route is covered during rollout.
  | "questions:manage" | "categories:manage" | "papers:manage" | "content:publish" | "content:delete" | "users:manage";
export type AdminPrincipal = { id: string; name: string; email: string; role: AdminRole; mustChangePassword?: boolean; permissionOverrides?: Record<string, boolean> };
export type AdminCapabilities = { manageQuestions: boolean; manageCategories: boolean; managePapers: boolean; addQuestionsToPapers: boolean; quickCreatePapers: boolean; publishContent: boolean; deleteContent: boolean; manageUsers: boolean; createMcqs: boolean; reviewMcqs: boolean; editOwnMcqs: boolean; editAnyMcqs: boolean };

/** The single source of truth for role grants. */
export const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  super_admin: ["content:view", "mcq.create", "mcq.edit_own", "mcq.edit_any", "mcq.review", "mcq.publish", "mcq.archive", "category.manage", "paper.manage", "paper.publish", "paper.add_questions", "paper.quickcreate", "user.manage", "super_admin.manage", "system.settings"],
  admin: ["content:view", "mcq.create", "mcq.edit_own", "mcq.edit_any", "mcq.review", "mcq.publish", "mcq.archive", "category.manage", "paper.manage", "paper.publish", "paper.add_questions", "paper.quickcreate", "user.manage"],
  data_entry: ["content:view", "mcq.create", "mcq.edit_own", "paper.add_questions"],
  reviewer: ["content:view", "mcq.edit_any", "mcq.review"],
  publisher: ["content:view", "mcq.publish", "paper.manage", "paper.publish", "paper.add_questions", "paper.quickcreate"],
};
const aliases: Partial<Record<AdminPermission, AdminPermission>> = {
  "questions:manage": "mcq.create", "categories:manage": "category.manage", "papers:manage": "paper.manage",
  "content:publish": "mcq.publish", "content:delete": "mcq.archive", "users:manage": "user.manage",
};
const isRole = (role: unknown): role is AdminRole => typeof role === "string" && Object.hasOwn(ROLE_PERMISSIONS, role);

function sessionSecret() { const secret = process.env.SESSION_SECRET; if (!secret) throw new Error("SESSION_SECRET is not configured."); return secret; }
export function adminLoginConfigured() { return Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET); }
export function bootstrapAdminEmail() { return (process.env.ADMIN_EMAIL || "admin@mcqpath.local").trim().toLowerCase(); }
export function verifyBootstrapPassword(email: string, password: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !adminLoginConfigured() || email.trim().toLowerCase() !== bootstrapAdminEmail()) return false;
  const submitted = Buffer.from(password); const target = Buffer.from(expected);
  return submitted.length === target.length && timingSafeEqual(submitted, target);
}
export function hashAdminPassword(password: string) {
  const salt = randomBytes(16).toString("hex"); return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPasswordHash(password: string, encoded: string) {
  const [algorithm, salt, digest] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !digest || !/^[a-f0-9]{128}$/i.test(digest)) return false;
  const expected = Buffer.from(digest, "hex"); const supplied = scryptSync(password, salt, expected.length);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
function encodeSession(principal: AdminPrincipal, sessionVersion: number) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ ...principal, sessionVersion, issuedAt })).toString("base64url");
  return `${payload}.${createHmac("sha256", sessionSecret()).update(payload).digest("hex")}`;
}
export function createAdminSession(principal: AdminPrincipal, sessionVersion = 0) { return encodeSession(principal, sessionVersion); }
function decodeSession(token?: string): (AdminPrincipal & { issuedAt: number; sessionVersion: number }) | null {
  if (!token) return null;
  const [payload, signature] = token.split("."); if (!payload || !signature) return null;
  try {
    const expected = Buffer.from(createHmac("sha256", sessionSecret()).update(payload).digest("hex")); const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const age = Math.floor(Date.now() / 1000) - parsed.issuedAt;
    if (!parsed.id || !parsed.email || !parsed.name || !isRole(parsed.role) || !Number.isInteger(parsed.sessionVersion) || age < 0 || age > ADMIN_SESSION_SECONDS) return null;
    return parsed;
  } catch { return null; }
}

export async function getAdminPrincipal(): Promise<AdminPrincipal | null> {
  if (!process.env.SESSION_SECRET || !hasDatabase || !db) return null;
  // Session age uses the current time. Wait for the request so prerender does not read the clock.
  await connection();
  const token = decodeSession((await cookies()).get(ADMIN_COOKIE)?.value); if (!token) return null;
  const [rows] = await db.execute<Array<RowDataPacket & { id: number; name: string; email: string; role: AdminRole; status: string; session_version: number; must_change_password: number }>>(
    "SELECT id, name, email, role, status, session_version, must_change_password FROM admin_users WHERE id = ? LIMIT 1", [token.id],
  );
  const user = rows[0];
  if (!user || user.status !== "active" || !isRole(user.role) || Number(user.session_version) !== token.sessionVersion) return null;
  const [grants] = await db.execute<Array<RowDataPacket & { permission_key: string; allowed: number }>>(
    "SELECT permission_key, allowed FROM admin_user_permissions WHERE admin_user_id = ?", [user.id],
  );
  // A forced password change permits access only so the account can reach its password form.
  const principal: AdminPrincipal = { id: String(user.id), name: user.name, email: user.email, role: user.role, mustChangePassword: Boolean(user.must_change_password) };
  principal.permissionOverrides = Object.fromEntries(grants.map((grant) => [grant.permission_key, Boolean(grant.allowed)]));
  return principal;
}
export function requirePermission(principal: AdminPrincipal, permission: AdminPermission) {
  if (principal.mustChangePassword) return false;
  const key = aliases[permission] ?? permission;
  const override = principal.permissionOverrides?.[key];
  return override === undefined ? ROLE_PERMISSIONS[principal.role].includes(key) : override;
}
export function hasPermission(principal: AdminPrincipal, permission: AdminPermission) { return requirePermission(principal, permission); }
export function getAdminCapabilities(principal: AdminPrincipal): AdminCapabilities {
  return { manageQuestions: hasPermission(principal, "mcq.create") || hasPermission(principal, "mcq.edit_any") || hasPermission(principal, "mcq.publish"), manageCategories: hasPermission(principal, "category.manage"), managePapers: hasPermission(principal, "paper.manage"), addQuestionsToPapers: hasPermission(principal, "paper.add_questions"), quickCreatePapers: hasPermission(principal, "paper.quickcreate"), publishContent: hasPermission(principal, "mcq.publish"), deleteContent: hasPermission(principal, "mcq.archive"), manageUsers: hasPermission(principal, "user.manage"), createMcqs: hasPermission(principal, "mcq.create"), reviewMcqs: hasPermission(principal, "mcq.review"), editOwnMcqs: hasPermission(principal, "mcq.edit_own"), editAnyMcqs: hasPermission(principal, "mcq.edit_any") };
}
export const ADMIN_ROLES: Array<{ value: AdminRole; label: string }> = [
  { value: "data_entry", label: "Data Entry" }, { value: "reviewer", label: "Reviewer" }, { value: "publisher", label: "Publisher" }, { value: "admin", label: "Admin" }, { value: "super_admin", label: "Super Admin" },
];
