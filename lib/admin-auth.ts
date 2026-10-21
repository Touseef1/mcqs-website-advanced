import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "mcqs_admin";
export const ADMIN_SESSION_SECONDS = 60 * 60 * 8;

function createSignature(timestamp: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return createHmac("sha256", secret).update(timestamp).digest("hex");
}

export function adminLoginConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET);
}

export function verifyAdminPassword(value: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !adminLoginConfigured()) return false;
  const submitted = Buffer.from(value);
  const target = Buffer.from(expected);
  return submitted.length === target.length && timingSafeEqual(submitted, target);
}

export function createAdminSession() {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return timestamp + "." + createSignature(timestamp);
}

export function verifyAdminSession(token: string | undefined) {
  if (!token || !adminLoginConfigured()) return false;
  const [timestamp, suppliedSignature] = token.split(".");
  if (!timestamp || !suppliedSignature) return false;
  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || age < 0 || age > ADMIN_SESSION_SECONDS) return false;
  const expected = Buffer.from(createSignature(timestamp));
  const supplied = Buffer.from(suppliedSignature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function isAdminAuthenticated() {
  const cookieStore = await cookies();
  return verifyAdminSession(cookieStore.get(ADMIN_COOKIE)?.value);
}
