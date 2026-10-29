import type { AdminPrincipal } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const ADMIN_ACTIVITY_ACTIONS = [
  "login", "logout",
  "mcq_added", "mcq_edited", "mcq_archived", "mcq_unarchived", "mcq_deleted",
  "paper_added", "paper_edited", "paper_archived", "paper_unarchived", "paper_deleted",
] as const;

export type AdminActivityAction = typeof ADMIN_ACTIVITY_ACTIONS[number];
export type AdminActivityEvent = {
  action: AdminActivityAction;
  targetType: "mcq" | "paper" | null;
  targetId: number | null;
  targetTitle?: string | null;
};

type AuditActivityInput = {
  action: string;
  entityType: string;
  entityId: number | null;
  oldValues: unknown;
  newValues: unknown;
};

function valuesRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
}

function targetTitle(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500);
  }
  return null;
}

/** Convert the existing audit events into the smaller set of events requested for the Super Admin activity feed. */
export function activityEventsFromAudit(input: AuditActivityInput): AdminActivityEvent[] {
  const oldValues = valuesRecord(input.oldValues);
  const newValues = valuesRecord(input.newValues);
  const beforeStatus = typeof oldValues.status === "string" ? oldValues.status : null;
  const afterStatus = typeof newValues.status === "string" ? newValues.status : null;

  if (input.entityType === "admin_user" && (input.action === "login" || input.action === "logout")) {
    return [{ action: input.action, targetType: null, targetId: null }];
  }

  const type = input.entityType === "question" ? "mcq" : input.entityType === "paper" ? "paper" : null;
  if (!type) return [];
  const prefix = type === "mcq" ? "mcq" : "paper";
  let suffix: "added" | "edited" | "archived" | "unarchived" | "deleted" | null = null;

  if (input.action === "delete") suffix = "deleted";
  else if (input.action === "create" || input.action === "bulk_create") suffix = "added";
  else if ((afterStatus === "archived" && beforeStatus !== "archived") || (input.action === "archive" && beforeStatus !== "archived") || (input.action === "archived" && beforeStatus !== "archived")) suffix = "archived";
  else if (beforeStatus === "archived" && afterStatus !== null && afterStatus !== "archived") suffix = "unarchived";
  else if (["update", "reorder"].includes(input.action) || (type === "mcq" && ["change-category", "submit-review", "approve", "reject", "publish", "unpublish"].includes(input.action))) suffix = "edited";

  if (!suffix) return [];
  const action = `${prefix}_${suffix}` as AdminActivityAction;
  const ids = positiveIds(newValues.questionIds ?? newValues.ids);
  const targetIds = input.entityId ? [input.entityId] : ids;
  const title = targetTitle(newValues.title, newValues.prompt, oldValues.title, oldValues.prompt);
  return targetIds.map((targetId) => ({ action, targetType: type, targetId, targetTitle: title }));
}

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded && /^[0-9a-f:.]{3,45}$/i.test(forwarded) ? forwarded : null;
}

/** Persist immutable user and target snapshots so activity remains readable after later edits. */
export async function writeAdminActivity(principal: AdminPrincipal, request: Request, events: AdminActivityEvent[]) {
  if (!db || !events.length) return;
  const idsByType = new Map<"mcq" | "paper", number[]>();
  for (const event of events) {
    if (!event.targetType || !event.targetId) continue;
    const ids = idsByType.get(event.targetType) ?? [];
    ids.push(event.targetId);
    idsByType.set(event.targetType, ids);
  }

  const titles = new Map<string, string>();
  for (const [type, rawIds] of idsByType) {
    const ids = [...new Set(rawIds)];
    if (!ids.length) continue;
    const marks = ids.map(() => "?").join(",");
    const table = type === "mcq" ? "questions" : "papers";
    const titleColumn = type === "mcq" ? "question_text" : "title";
    const [rows] = await db.execute<Array<RowDataPacket & { id: number; title: string }>>(
      `SELECT id, ${titleColumn} AS title FROM ${table} WHERE id IN (${marks})`, ids,
    );
    for (const row of rows) titles.set(`${type}:${row.id}`, row.title);
  }

  const ip = clientIp(request);
  for (const event of events) {
    const title = event.targetTitle ?? (event.targetType && event.targetId ? titles.get(`${event.targetType}:${event.targetId}`) ?? null : null);
    await db.execute(
      `INSERT INTO admin_activity_logs
        (user_id, user_name, user_role, action_type, target_type, target_id, target_title, ip_address, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [principal.id, principal.name.slice(0, 140), principal.role, event.action, event.targetType, event.targetId, title?.slice(0, 500) ?? null, ip],
    );
  }
}
