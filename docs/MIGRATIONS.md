# MySQL migration order

Apply each numbered migration exactly once, in ascending order, to the `mcqs_website` database. Take a database backup first. These SQL files are manual upgrade scripts, not an automatic migration runner; record each completed filename in your deployment notes.

| Order | File | Purpose |
|---|---|---|
| 001 | `001_initial_schema.sql` | Core questions, categories, exams, papers, and paper links. |
| 002 | `002_role_based_admin.sql` | Initial admin accounts and content statuses. |
| 003 | `003_learner_accounts.sql` | Learners, bookmarks, and quiz attempt summaries. |
| 004 | `004_paper_metadata.sql` | Paper timestamps, shift/session and expected count metadata. |
| 005 | `005_verified_papers_only.sql` | Removes shipped sample content and requires source review. |
| 006 | `006_admin_roles_workflow_security.sql` | Admin roles, audit log, ownership, and security workflow. |
| 007 | `007_platform_improvements.sql` | Search, image metadata, learner actions, quiz review data, and rate limiting. |

Migration 004 restores the missing sequence number with the paper metadata change. Migration 005 is retained in its historical position because it cleans up old sample rows and temporarily restores the legacy single paper type; 007 upgrades it to the current values. For an existing database that has already applied 005 and 006, apply 004 once to add paper metadata, then 007. Do not rerun 001–003, 005, or 006.

```bash
for migration in sql/migrations/00{1,2,3,4,5,6,7}_*.sql; do
  mysql -u YOUR_DB_USER -p mcqs_website < "$migration"
done
```

For the already-running project whose database has migrations 001–003, 005, and 006 applied, run only the newly missing metadata migration and the new platform migration:

```bash
mysql -u YOUR_DB_USER -p mcqs_website < sql/migrations/004_paper_metadata.sql
mysql -u YOUR_DB_USER -p mcqs_website < sql/migrations/007_platform_improvements.sql
```
