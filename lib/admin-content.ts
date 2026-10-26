import type { AdminPrincipal } from "@/lib/admin-auth";

export type ContentStatus = "draft" | "in_review" | "approved" | "published" | "rejected" | "archived";

export function slugify(value: string) {
  return value.normalize("NFKD").toLowerCase().trim()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function requestedStatus(value: unknown, principal: AdminPrincipal): ContentStatus {
  if ((principal.role === "admin" || principal.role === "super_admin" || principal.role === "publisher") && value === "published") return "published";
  return "draft";
}

export function validSlug(value: string) {
  return value.length >= 2 && value.length <= 240 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function safeRole(value: unknown): value is "admin" | "data_entry" | "reviewer" | "publisher" | "super_admin" {
  return value === "admin" || value === "data_entry" || value === "reviewer" || value === "publisher" || value === "super_admin";
}
