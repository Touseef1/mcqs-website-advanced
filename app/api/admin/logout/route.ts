import { NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/admin-auth";

import { csrfFailure } from "@/lib/admin-security";
export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
