import type { AdminPermission, AdminPrincipal } from "@/lib/admin-auth";

export const QUESTION_STATUSES = ["draft", "in_review", "approved", "published", "rejected", "archived"] as const;
export type QuestionStatus = typeof QUESTION_STATUSES[number];

export type QuestionTransition = {
  permission: AdminPermission;
  action: "submit" | "approve" | "publish" | "reject" | "revise" | "archive" | "unpublish";
};

/** All question status changes must pass through this transition map. */
export const ALLOWED_QUESTION_TRANSITIONS: Record<QuestionStatus, Partial<Record<QuestionStatus, QuestionTransition>>> = {
  draft: { in_review: { permission: "mcq.edit_own", action: "submit" }, archived: { permission: "mcq.archive", action: "archive" } },
  in_review: { approved: { permission: "mcq.review", action: "approve" }, rejected: { permission: "mcq.review", action: "reject" }, archived: { permission: "mcq.archive", action: "archive" } },
  approved: { published: { permission: "mcq.publish", action: "publish" }, in_review: { permission: "mcq.edit_any", action: "unpublish" }, archived: { permission: "mcq.archive", action: "archive" } },
  published: { in_review: { permission: "mcq.edit_any", action: "unpublish" }, archived: { permission: "mcq.archive", action: "archive" } },
  rejected: { draft: { permission: "mcq.edit_own", action: "revise" }, archived: { permission: "mcq.archive", action: "archive" } },
  archived: {},
};

export type TransitionActor = Pick<AdminPrincipal, "id" | "role">;
export function getQuestionTransition(from: string, to: string): QuestionTransition | null {
  if (!QUESTION_STATUSES.includes(from as QuestionStatus) || !QUESTION_STATUSES.includes(to as QuestionStatus)) return null;
  return ALLOWED_QUESTION_TRANSITIONS[from as QuestionStatus][to as QuestionStatus] ?? null;
}

/** Super Admin may publish their own or another person's MCQ without waiting on the review queue. */
export function getActorQuestionTransition(actor: TransitionActor, from: string, to: string): QuestionTransition | null {
  const direct = getQuestionTransition(from, to);
  if (direct) return direct;
  if (actor.role === "super_admin" && to === "published" && (from === "draft" || from === "in_review" || from === "rejected")) {
    return { permission: "mcq.publish", action: "publish" };
  }
  return null;
}

export function isSelfApproval(actor: TransitionActor, ownerId: number | string | null | undefined, to: string) {
  return (to === "approved" || to === "published") && ownerId != null && String(ownerId) === String(actor.id);
}

export function canActorTransition(
  actor: TransitionActor,
  ownerId: number | string | null | undefined,
  from: string,
  to: string,
  hasPermission: (permission: AdminPermission) => boolean,
) {
  const transition = getActorQuestionTransition(actor, from, to);
  if (!transition || !hasPermission(transition.permission)) return false;
  if ((from === "draft" && to === "in_review") || (from === "rejected" && to === "draft")) {
    if (ownerId == null || String(ownerId) !== String(actor.id)) return false;
  }
  if (isSelfApproval(actor, ownerId, to) && actor.role !== "super_admin") return false;
  return true;
}

export function canActorEditQuestion(actor: TransitionActor, ownerId: number | string | null | undefined, status: string, canEditAny: boolean, canEditOwn: boolean) {
  if (canEditAny) return true;
  return canEditOwn && ownerId != null && String(ownerId) === String(actor.id) && (status === "draft" || status === "rejected");
}

export function statusAfterQuestionEdit(status: QuestionStatus, keepPublished: boolean) {
  if (keepPublished) return status;
  if (status === "approved" || status === "published") return "in_review";
  if (status === "rejected") return "draft";
  return status;
}
