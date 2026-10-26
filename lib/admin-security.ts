import { NextResponse } from "next/server";
import type { AdminPrincipal } from "@/lib/admin-auth";
import { db } from "@/lib/db";

/** Same-origin guard for browser cookie-authenticated state changes. */
export function csrfFailure(request: Request) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const expected = new URL(request.url).origin;
  const observed = origin ?? (referer ? new URL(referer).origin : null);
  return observed !== expected ? NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 }) : null;
}

export async function auditAdmin(principal: AdminPrincipal, request: Request, action: string, entityType: string, entityId: number | null, oldValues: unknown, newValues: unknown) {
  if (!db) return;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded && /^[0-9a-f:.]{3,45}$/i.test(forwarded) ? forwarded : null;
  await db.execute(
    "INSERT INTO admin_audit_log (admin_id,action,entity_type,entity_id,old_values,new_values,ip) VALUES (?,?,?,?,?,?,?)",
    [principal.id, action, entityType, entityId, JSON.stringify(oldValues), JSON.stringify(newValues), ip],
  );
}
