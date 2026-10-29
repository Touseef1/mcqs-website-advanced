import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_QUESTION_TRANSITIONS,
  canActorTransition,
  getActorQuestionTransition,
  canActorEditQuestion,
  getQuestionTransition,
  isSelfApproval,
  statusAfterQuestionEdit,
} from "../lib/admin-workflow.ts";

test("question state machine accepts only configured transitions", () => {
  assert.equal(getQuestionTransition("draft", "in_review")?.permission, "mcq.edit_own");
  assert.equal(getQuestionTransition("in_review", "approved")?.permission, "mcq.review");
  assert.equal(getQuestionTransition("approved", "published")?.permission, "mcq.publish");
  assert.equal(getQuestionTransition("published", "draft"), null);
  assert.equal(getQuestionTransition("archived", "published"), null);
});

test("each configured transition declares a permission", () => {
  for (const transitions of Object.values(ALLOWED_QUESTION_TRANSITIONS)) {
    for (const transition of Object.values(transitions)) assert.ok(transition?.permission);
  }
});

test("self approval and self publishing are detected by owner identity", () => {
  const owner = { id: "42", role: "admin" as const };
  assert.equal(isSelfApproval(owner, 42, "approved"), true);
  assert.equal(isSelfApproval(owner, "42", "published"), true);
  assert.equal(isSelfApproval(owner, 43, "approved"), false);
  assert.equal(isSelfApproval(owner, 42, "rejected"), false);
});

test("approval and publishing block the owner except for Super Admin", () => {
  const reviewer = { id: "11", role: "reviewer" as const };
  const superAdmin = { id: "11", role: "super_admin" as const };
  const grantAll = () => true;
  assert.equal(canActorTransition(reviewer, 11, "in_review", "approved", grantAll), false);
  assert.equal(canActorTransition(reviewer, 11, "approved", "published", grantAll), false);
  assert.equal(canActorTransition(superAdmin, 11, "in_review", "approved", grantAll), true);
  assert.equal(canActorTransition(superAdmin, 11, "approved", "published", grantAll), true);
  assert.equal(canActorTransition(superAdmin, 11, "draft", "published", grantAll), true);
  assert.equal(canActorTransition(superAdmin, 12, "in_review", "published", grantAll), true);
  assert.equal(getActorQuestionTransition(superAdmin, "draft", "published")?.action, "publish");
  assert.equal(canActorTransition(reviewer, 12, "draft", "published", grantAll), false);
  assert.equal(canActorTransition(superAdmin, 12, "in_review", "approved", () => false), false);
});

test("Data Entry may edit only own draft or rejected items", () => {
  const actor = { id: "9", role: "data_entry" as const };
  assert.equal(canActorEditQuestion(actor, 9, "draft", false, true), true);
  assert.equal(canActorEditQuestion(actor, 9, "rejected", false, true), true);
  assert.equal(canActorEditQuestion(actor, 10, "draft", false, true), false);
  assert.equal(canActorEditQuestion(actor, 9, "published", false, true), false);
});

test("editing reviewed or public content returns it to review by default", () => {
  assert.equal(statusAfterQuestionEdit("approved", false), "in_review");
  assert.equal(statusAfterQuestionEdit("published", false), "in_review");
  assert.equal(statusAfterQuestionEdit("published", true), "published");
  assert.equal(statusAfterQuestionEdit("rejected", false), "draft");
});
