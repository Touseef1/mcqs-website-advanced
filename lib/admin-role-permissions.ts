export type AdminRole = "super_admin" | "admin" | "data_entry" | "reviewer" | "publisher";
export type AdminPermission =
  | "content:view" | "mcq.create" | "mcq.edit_own" | "mcq.edit_any" | "mcq.review" | "mcq.publish" | "mcq.archive"
  | "category.manage" | "paper.manage" | "paper.publish" | "user.manage" | "super_admin.manage" | "system.settings"
  | "paper.add_questions" | "paper.quickcreate"
  | "questions:manage" | "categories:manage" | "papers:manage" | "content:publish" | "content:delete" | "users:manage";

/** Shared role defaults. Keep this module browser-safe; auth and routes import it too. */
export const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  super_admin: ["content:view", "mcq.create", "mcq.edit_own", "mcq.edit_any", "mcq.review", "mcq.publish", "mcq.archive", "category.manage", "paper.manage", "paper.publish", "paper.add_questions", "paper.quickcreate", "user.manage", "super_admin.manage", "system.settings"],
  admin: ["content:view", "mcq.create", "mcq.edit_own", "mcq.edit_any", "mcq.review", "mcq.publish", "mcq.archive", "category.manage", "paper.manage", "paper.publish", "paper.add_questions", "paper.quickcreate", "user.manage"],
  data_entry: ["content:view", "mcq.create", "mcq.edit_own", "paper.add_questions"],
  reviewer: ["content:view", "mcq.edit_any", "mcq.review"],
  publisher: ["content:view", "mcq.publish", "paper.manage", "paper.publish", "paper.add_questions", "paper.quickcreate"],
};
