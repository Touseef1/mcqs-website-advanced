import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_SECONDS,
  adminLoginConfigured,
  createAdminSession,
  verifyAdminPassword,
} from "@/lib/admin-auth";

export async function POST(request: Request) {
  if (!adminLoginConfigured()) {
    return NextResponse.json({ error: "Set ADMIN_PASSWORD and SESSION_SECRET in .env.local first." }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body.password !== "string" || !verifyAdminPassword(body.password)) {
    return NextResponse.json({ error: "The password is incorrect." }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, createAdminSession(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  });
  return response;
}
