# Admin roles, permissions, and workflow

Apply `sql/migrations/006_admin_roles_workflow_security.sql` after migrations 001–005. It preserves existing users and content, maps the old `editor` role to `data_entry` and the old UI’s `admin` / Paper Manager role to `publisher`; existing reviewers remain reviewers. No users are deleted. Existing `draft` and `published` question statuses are kept as-is. The bootstrap account is created in `admin_users` on its first successful database-backed login using `ADMIN_EMAIL` and `ADMIN_PASSWORD`; it must change that password immediately.

## Permission matrix

| Permission | Super Admin | Admin | Data Entry | Reviewer | Publisher |
|---|:---:|:---:|:---:|:---:|:---:|
| `content:view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `mcq.create` | ✓ | ✓ | ✓ | — | — |
| `mcq.edit_own` | ✓ | ✓ | ✓ | — | — |
| `mcq.edit_any` | ✓ | ✓ | — | ✓ | — |
| `mcq.review` | ✓ | ✓ | — | ✓ | — |
| `mcq.publish` | ✓ | ✓ | — | — | ✓ |
| `mcq.archive` | ✓ | ✓ | — | — | — |
| `category.manage` | ✓ | ✓ | — | — | — |
| `paper.manage` | ✓ | ✓ | — | — | ✓ |
| `paper.publish` | ✓ | ✓ | — | — | ✓ |
| `paper.add_questions` | ✓ | ✓ | ✓ | — | ✓ |
| `paper.quickcreate` | ✓ | ✓ | — | — | ✓ |
| `user.manage` | ✓ | ✓* | — | — | — |
| `super_admin.manage` | ✓ | — | — | — | — |
| `system.settings` | ✓ | — | — | — | — |

`*` Admins may manage regular team accounts. Only Super Admins may create, modify, or assign the `admin` and `super_admin` roles. Role grants are centralized in `ROLE_PERMISSIONS` in `lib/admin-auth.ts`. Optional per-user allow/deny grants are stored in `admin_user_permissions`.

Admin has all workspace permissions other than `super_admin.manage` and `system.settings`. Publisher manages papers and publishes approved MCQs; it has no edit permission on MCQs.

## MCQ review lifecycle

The shared state machine is in `lib/admin-workflow.ts` and is authoritative for single-question transitions and bulk status actions:

| Current status | Allowed next status | Permission |
|---|---|---|
| `draft` | `in_review` | `mcq.edit_own` (owner only) |
| `in_review` | `approved` or `rejected` | `mcq.review` (comment required) |
| `approved` | `published` | `mcq.publish` |
| `approved`, `published` | `in_review` | `mcq.edit_any` (editing/unpublishing) |
| `rejected` | `draft` | `mcq.edit_own` (owner only) |
| Any non-archived status | `archived` | `mcq.archive` |

All other transitions are rejected. Reviewers and Publishers cannot approve or publish their own MCQs. A Super Admin may do so, and the audit event marks the self-approval override. Admins and Super Admins may explicitly keep an edited approved/published MCQ in its current state; this action is recorded in the audit log. By default, editing an approved or published question returns it to `in_review`. Data Entry can edit only their own `draft` or `rejected` items; editing a rejected item reopens it as `draft`.

Before changing the correct option or option text on a published question, the API snapshots its prior question and options in `question_revisions` and links earlier quiz answer rows that have no revision id to that snapshot. Publishing creates a snapshot for the newly published content, and new learner answer rows store that revision id. Edits use a monotonically increasing `questions.version`; clients must send `expectedVersion`, and stale edits receive HTTP 409.

Archiving or moving a question out of published status checks for published papers. The API returns the affected paper names and requires explicit confirmation before removing those links. `paper.add_questions` allows Data Entry, Publisher, Admin, and Super Admin to attach MCQs; `paper.quickcreate` is limited to Publisher, Admin, and Super Admin. The fast-entry UI only shows the inline paper-creation action when that permission is present. Paper rows are locked before calculating the next question order.

Bulk imports and actions accept at most 200 rows. The API validates each row's state, ownership, and permission inside a transaction. If a row fails, all changes roll back and the response includes row-specific results and a clear rollback message.

## Account and session safeguards

- Password hashes use scrypt. Temporary passwords set `must_change_password`; `/api/admin/password` forces the user to set a private password.
- Admin sessions are signed, HttpOnly, SameSite=Strict, Secure in production, and expire after eight hours. `session_version` is checked on every request; role edits, password resets, and deactivation invalidate prior cookies.
- Login attempts are recorded by email and IP and throttled after ten failures in fifteen minutes; five failures lock the account for fifteen minutes.
- Mutating admin endpoints require a matching Origin/Referer. Audit events are stored in `admin_audit_log` with actor, action, entity, JSON values, IP, and timestamp.

## Migration and rollout

1. Back up `mcqs_website`.
2. Run migrations 001–005 if they have not already been applied, then execute `006_admin_roles_workflow_security.sql` once.
3. Ensure `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SESSION_SECRET` are configured. The bootstrap user is materialized in the database on first successful login.
4. Sign in as the bootstrap account and change its password. Review the team role assignments and test each role with a dedicated account.

The added `created_by`/`updated_by` ownership columns are nullable so historical rows remain valid. New MCQ creation records its owner; legacy ownership is intentionally not guessed or assigned during migration.
