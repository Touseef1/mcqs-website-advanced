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
| 008 | `008_workflow_integrity.sql` | Question versions, immutable content snapshots, and links from learner answers to the question revision they saw. |
| 009 | `009_admin_activity_logs.sql` | Staff login/logout and MCQ/paper activity snapshots for the Super Admin activity view. |
| 010 | `010_link_source_matched_paper_questions.sql` | Links source-matched published questions to their matching papers. |
| 011 | `011_question_language.sql` | Adds `questions.language` with an English default and language/status index. |
| 012 | `012_ensure_question_language.sql` | Safe compatibility repair: adds the language column/index only if missing, preserving existing rows. |
| 013 | `013_learner_wrong_question_dismissals.sql` | Adds a per-learner dismissal list for missed questions without deleting quiz history. |

Migration 004 restores the missing sequence number with the paper metadata change. Migration 005 is retained in its historical position because it cleans up old sample rows and temporarily restores the legacy single paper type; 007 upgrades it to the current values. For an existing database that has already applied 005 and 006, apply 004 once to add paper metadata, then 007. Do not rerun 001–003, 005, or 006.

For an existing database that has completed 001–007, run migration 008 once. It preserves existing rows, adds a default version of `1` to every question, and leaves revision links nullable until a question is republished or edited while published.

For an existing database that has completed 001–008, run migration 009 once. It creates the activity log table without changing existing content. The table intentionally has no foreign key to `admin_users`, so recorded actor snapshots survive staff account removal. The activity UI and API require this migration.

For an existing database that has completed 001–010, run migration 011 once. It preserves existing question rows by assigning them `en`; set Urdu questions to `ur` from the editor. Do not rerun it after it has been applied.

Migration 012 is safe to apply even when migration 011 already succeeded. It checks the live schema and adds `questions.language` and its index only when either is missing. Use this repair when the admin questions API reports `Unknown column 'q.language'` after deployment.

For databases that have completed migrations 001–012, apply migration 013 once. It creates an empty dismissal table; existing quiz answer history is preserved and existing incorrect answers appear in the learner's wrong-question practice list.

```bash
for migration in sql/migrations/[0-9][0-9][0-9]_*.sql; do
  mysql -u YOUR_DB_USER -p mcqs_website < "$migration"
done
```

For the already-running project whose database has migrations 001–003, 005, and 006 applied, run only the newly missing metadata migration and the new platform migration:

```bash
mysql -u YOUR_DB_USER -p mcqs_website < sql/migrations/004_paper_metadata.sql
mysql -u YOUR_DB_USER -p mcqs_website < sql/migrations/007_platform_improvements.sql
mysql -u YOUR_DB_USER -p mcqs_website < sql/migrations/008_workflow_integrity.sql
mysql -u YOUR_DB_USER -p mcqs_website < sql/migrations/009_admin_activity_logs.sql
mysql -u YOUR_DB_USER -p mcqs_website < sql/migrations/010_link_source_matched_paper_questions.sql
mysql -u YOUR_DB_USER -p mcqs_website < sql/migrations/011_question_language.sql
mysql -u YOUR_DB_USER -p mcqs_website < sql/migrations/012_ensure_question_language.sql
mysql -u YOUR_DB_USER -p mcqs_website < sql/migrations/013_learner_wrong_question_dismissals.sql
```
