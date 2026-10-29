import { NextResponse } from "next/server";
import { ADMIN_COOKIE, getAdminPrincipal } from "@/lib/admin-auth";

import { auditAdmin, csrfFailure } from "@/lib/admin-security";
export async function POST(request: Request) {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const principal = await getAdminPrincipal();
  if (principal) await auditAdmin(principal, request, "logout", "admin_user", Number(principal.id), null, null);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
