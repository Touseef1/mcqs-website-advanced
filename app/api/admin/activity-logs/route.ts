import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { ADMIN_ACTIVITY_ACTIONS } from "@/lib/admin-activity";
import { getAdminPrincipal } from "@/lib/admin-auth";
import { db, hasDatabase } from "@/lib/db";

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  const principal = await getAdminPrincipal();
  if (!principal) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  if (principal.role !== "super_admin") return NextResponse.json({ error: "Activity logs are available to Super Admins only." }, { status: 403 });
  if (!hasDatabase || !db) return NextResponse.json({ error: "Configure MySQL and apply migration 009 first." }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(100000, Number(params.get("page")) || 1));
  const pageSize = Math.max(10, Math.min(100, Number(params.get("pageSize")) || 50));
  const userValue = params.get("userId")?.trim() ?? "";
  const userId = userValue ? Number(userValue) : null;
  if (userValue && (!Number.isSafeInteger(userId) || Number(userId) < 1)) return NextResponse.json({ error: "Choose a valid user filter." }, { status: 400 });

  const action = params.get("action")?.trim() ?? "";
  if (action && !(ADMIN_ACTIVITY_ACTIONS as readonly string[]).includes(action)) return NextResponse.json({ error: "Choose a valid activity type." }, { status: 400 });

  const from = params.get("from")?.trim() ?? "";
  const to = params.get("to")?.trim() ?? "";
  if ((from && !validDate(from)) || (to && !validDate(to))) return NextResponse.json({ error: "Use valid dates in YYYY-MM-DD format." }, { status: 400 });
  if (from && to && from > to) return NextResponse.json({ error: "The start date must be before or equal to the end date." }, { status: 400 });

  const conditions: string[] = [];
  const values: Array<string | number> = [];
  if (userId !== null) { conditions.push("user_id = ?"); values.push(userId); }
  if (action) { conditions.push("action_type = ?"); values.push(action); }
  if (from) { conditions.push("occurred_at >= CONCAT(?, ' 00:00:00')"); values.push(from); }
  if (to) { conditions.push("occurred_at < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY)"); values.push(to); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [countRows] = await db.execute<Array<RowDataPacket & { total: number }>>(
    `SELECT COUNT(*) AS total FROM admin_activity_logs ${where}`, values,
  );
  const total = Number(countRows[0]?.total ?? 0);
  const offset = (page - 1) * pageSize;
  const [logs] = await db.execute<Array<RowDataPacket & {
    id: number; user_id: number; user_name: string; user_role: string; action_type: string;
    target_type: string | null; target_id: number | null; target_title: string | null; ip_address: string | null; occurred_at_utc: string;
  }>>(
    `SELECT id, user_id, user_name, user_role, action_type, target_type, target_id, target_title, ip_address,
            DATE_FORMAT(occurred_at, '%Y-%m-%d %H:%i:%s') AS occurred_at_utc
       FROM admin_activity_logs ${where}
      ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...values, pageSize, offset],
  );

  const [users] = await db.execute<Array<RowDataPacket & {
    id: number; name: string; role: string; last_login_at_utc: string | null;
    mcqs_added: number; mcqs_archived: number; papers_added: number; papers_archived: number;
  }>>(
    `SELECT u.id, u.name, u.role, DATE_FORMAT(u.last_login_at, '%Y-%m-%d %H:%i:%s') AS last_login_at_utc,
            COALESCE(SUM(l.action_type = 'mcq_added'), 0) AS mcqs_added,
            COALESCE(SUM(l.action_type = 'mcq_archived'), 0) AS mcqs_archived,
            COALESCE(SUM(l.action_type = 'paper_added'), 0) AS papers_added,
            COALESCE(SUM(l.action_type = 'paper_archived'), 0) AS papers_archived
       FROM admin_users u LEFT JOIN admin_activity_logs l ON l.user_id = u.id
      GROUP BY u.id, u.name, u.role, u.last_login_at
      ORDER BY u.name, u.id`,
  );

  return NextResponse.json({
    logs: logs.map((row) => ({
      id: Number(row.id), userId: String(row.user_id), userName: row.user_name, userRole: row.user_role,
      action: row.action_type, targetType: row.target_type, targetId: row.target_id == null ? null : Number(row.target_id),
      targetTitle: row.target_title, ipAddress: row.ip_address, occurredAtUtc: row.occurred_at_utc,
    })),
    users: users.map((row) => ({
      id: String(row.id), name: row.name, role: row.role, lastLoginAtUtc: row.last_login_at_utc,
      mcqsAdded: Number(row.mcqs_added), mcqsArchived: Number(row.mcqs_archived),
      papersAdded: Number(row.papers_added), papersArchived: Number(row.papers_archived),
    })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  }, { headers: { "Cache-Control": "no-store, private" } });
}
