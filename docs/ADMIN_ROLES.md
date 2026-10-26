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
| `user.manage` | ✓ | ✓* | — | — | — |
| `super_admin.manage` | ✓ | — | — | — | — |
| `system.settings` | ✓ | — | — | — | — |

`*` Admins may manage regular team accounts. Only Super Admins may create, modify, or assign the `admin` and `super_admin` roles. Role grants are centralized in `ROLE_PERMISSIONS` in `lib/admin-auth.ts`. Optional per-user allow/deny grants are stored in `admin_user_permissions`.

Admin has all workspace permissions other than `super_admin.manage` and `system.settings`. Publisher manages papers and publishes approved MCQs; it has no edit permission on MCQs.

## MCQ review lifecycle

`draft → in_review → approved → published → archived`; a reviewer can send an item to `rejected` with a required `review_note`. Data Entry users may submit only their own drafts and may edit only their own drafts. Reviewers may edit and decide submitted questions. Publishers may publish approved questions and manage papers. Admin APIs remain the authority; hidden UI controls do not grant access.

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
