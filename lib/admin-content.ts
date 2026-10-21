import type { AdminPrincipal } from "@/lib/admin-auth";

export type ContentStatus = "draft" | "published" | "archived";

export function slugify(value: string) {
  return value.normalize("NFKD").toLowerCase().trim()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function requestedStatus(value: unknown, principal: AdminPrincipal): ContentStatus {
  if (principal.role === "admin" || principal.role === "super_admin") {
    return value === "published" || value === "archived" ? value : "draft";
  }
  if (principal.role === "reviewer" && value === "published") return "published";
  return "draft";
}

export function validSlug(value: string) {
  return value.length >= 2 && value.length <= 240 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function safeRole(value: unknown): value is "admin" | "editor" | "reviewer" {
  return value === "admin" || value === "editor" || value === "reviewer";
}
