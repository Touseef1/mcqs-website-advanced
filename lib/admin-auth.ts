import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db, hasDatabase } from "@/lib/db";

export const ADMIN_COOKIE = "mcqs_admin";
export const ADMIN_SESSION_SECONDS = 60 * 60 * 8;

export type AdminRole = "super_admin" | "admin" | "editor" | "reviewer";
export type AdminPermission = "content:view" | "questions:manage" | "categories:manage" | "papers:manage" | "content:publish" | "users:manage";
export type AdminPrincipal = { id: string; name: string; email: string; role: AdminRole };

const rolePermissions: Record<AdminRole, AdminPermission[]> = {
  super_admin: ["content:view", "questions:manage", "categories:manage", "papers:manage", "content:publish", "users:manage"],
  admin: ["content:view", "questions:manage", "categories:manage", "papers:manage", "content:publish", "users:manage"],
  editor: ["content:view", "questions:manage", "categories:manage", "papers:manage"],
  reviewer: ["content:view", "content:publish"],
};

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return secret;
}

export function adminLoginConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET);
}

export function bootstrapAdminEmail() {
  return (process.env.ADMIN_EMAIL || "admin@mcqpath.local").trim().toLowerCase();
}

export function verifyBootstrapPassword(email: string, password: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !adminLoginConfigured() || email.trim().toLowerCase() !== bootstrapAdminEmail()) return false;
  const submitted = Buffer.from(password);
  const target = Buffer.from(expected);
  return submitted.length === target.length && timingSafeEqual(submitted, target);
}

export function hashAdminPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const digest = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${digest}`;
}

export function verifyPasswordHash(password: string, encoded: string) {
  const [algorithm, salt, digest] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !digest || !/^[a-f0-9]{128}$/i.test(digest)) return false;
  const expected = Buffer.from(digest, "hex");
  const supplied = scryptSync(password, salt, expected.length);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function encodeSession(principal: AdminPrincipal) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ ...principal, issuedAt })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function createAdminSession(principal: AdminPrincipal) {
  return encodeSession(principal);
}

function decodeSession(token: string | undefined): (AdminPrincipal & { issuedAt: number }) | null {
  if (!token) return null;
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) return null;
  try {
    const expected = Buffer.from(createHmac("sha256", sessionSecret()).update(payload).digest("hex"));
    const supplied = Buffer.from(suppliedSignature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AdminPrincipal & { issuedAt: number };
    const age = Math.floor(Date.now() / 1000) - parsed.issuedAt;
    if (!parsed.id || !parsed.email || !parsed.name || !rolePermissions[parsed.role] || age < 0 || age > ADMIN_SESSION_SECONDS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getAdminPrincipal(): Promise<AdminPrincipal | null> {
  if (!process.env.SESSION_SECRET) return null;
  const cookieStore = await cookies();
  const session = decodeSession(cookieStore.get(ADMIN_COOKIE)?.value);
  if (!session) return null;
  if (session.id === "env-root") {
    return adminLoginConfigured() && session.email === bootstrapAdminEmail()
      ? { id: session.id, name: session.name, email: session.email, role: "super_admin" }
      : null;
  }
  if (!hasDatabase || !db) return null;
  const [rows] = await db.execute<Array<{ id: number; name: string; email: string; role: AdminRole; status: string } & import("mysql2").RowDataPacket>>(
    "SELECT id, name, email, role, status FROM admin_users WHERE id = ? LIMIT 1",
    [session.id],
  );
  const user = rows[0];
  if (!user || user.status !== "active" || !rolePermissions[user.role]) return null;
  return { id: String(user.id), name: user.name, email: user.email, role: user.role };
}

export async function isAdminAuthenticated() {
  return Boolean(await getAdminPrincipal());
}

export function hasPermission(principal: AdminPrincipal, permission: AdminPermission) {
  return rolePermissions[principal.role].includes(permission);
}

export const ADMIN_ROLES: Array<{ value: AdminRole; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "editor", label: "Editor" },
  { value: "reviewer", label: "Reviewer" },
];
