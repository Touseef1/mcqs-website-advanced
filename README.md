# MCQPath

MCQPath is a search-friendly MCQ and exam-practice website for learners in Pakistan. It is built with Next.js App Router, React, TypeScript, MySQL, and Tailwind CSS.

## Phase 1 features

- Public subject, topic, quiz, search, and past-paper practice pages
- Timed quizzes with server-side answer checking and explanations
- MySQL schema and seed subject/topic categories; no generated MCQs are included
- Role-based admin workspace for subjects, topics, MCQs, past papers, and team accounts
- Page metadata, canonical URLs, sitemap, robots rules, and responsive layouts
- Real MCQs and past papers must include source details before they can be published

## Requirements

- Node.js 20.9 or newer
- npm
- MySQL 8.x with InnoDB

## Run locally

1. Install the JavaScript dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in your local MySQL details:

   ```bash
   cp .env.example .env.local
   ```

3. Create a dedicated MySQL user. Open MySQL as an administrator:

   ```bash
   sudo mysql
   ```

   Then run the following SQL, replacing the example password:

   ```sql
   CREATE USER 'mcqs_app'@'localhost' IDENTIFIED BY 'choose-a-strong-local-password';
   GRANT SELECT, INSERT, UPDATE, DELETE ON mcqs_website.* TO 'mcqs_app'@'localhost';
   FLUSH PRIVILEGES;
   ```

4. Create the database tables, add the admin and learner schemas, and configure verified past-paper content:

   ```bash
   sudo mysql < sql/migrations/001_initial_schema.sql
   sudo mysql < sql/migrations/002_role_based_admin.sql
   sudo mysql < sql/migrations/003_learner_accounts.sql
   sudo mysql < sql/migrations/004_paper_metadata.sql
   sudo mysql < sql/migrations/005_verified_papers_only.sql
   sudo mysql < sql/migrations/006_admin_roles_workflow_security.sql
   sudo mysql < sql/migrations/007_platform_improvements.sql
   sudo mysql < sql/migrations/008_workflow_integrity.sql
   sudo mysql < sql/seed.sql
   ```

5. Set `DB_USER` and `DB_PASSWORD` in `.env.local` to match the user created above. Choose a private `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the first super-admin account. Generate a session secret:

   ```bash
   openssl rand -hex 32
   ```

   Put the generated value in `SESSION_SECRET`. Do not commit `.env.local` or share admin passwords in chat.

6. Start the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). The admin area is at `/admin`.

Without MySQL, the site shows category placeholders only; it does not show generated MCQs or sample papers. The admin area requires MySQL and migrations `001` through `008` in order, as detailed in `docs/MIGRATIONS.md`. Learner registration, bookmarks, and quiz history additionally require migration `003` and `SESSION_SECRET`.

Every MCQ needs an exam/source reference in the admin form. MCQs without this reference cannot be published. MCQs follow the shared draft, review, approval, publication, rejection, and archive state machine. Data Entry staff can edit their own drafts or rejected items and add MCQs to papers; inline paper creation requires the separate `paper.quickcreate` permission. The paper builder searches the bank and orders questions. See `docs/ADMIN_ROLES.md` and `docs/MIGRATIONS.md` for permissions and upgrades.

## Admin roles

Sign in at `/admin` with the bootstrap credentials in `.env.local`. The bootstrap Super Admin is stored in `admin_users` at first database-backed login; after that, the database account and its password are authoritative. Use **Team & roles** to create staff accounts. Each team account needs a unique email; passwords are stored as salted scrypt hashes.

| Role | Access |
| --- | --- |
| Super Admin | Full access, including Super Admin team management and system settings |
| Admin | Manage content and regular team accounts; cannot manage Super Admins or system settings |
| Data Entry | Create MCQs, edit own draft/rejected MCQs, and add MCQs to papers |
| Reviewer | Edit and review submitted MCQs; approve or reject with a comment |
| Publisher | Manage papers and publish approved MCQs |

New staff accounts must change their temporary password on first login. Admin sessions are invalidated immediately when accounts are deactivated, roles change, or passwords reset. See `docs/ADMIN_ROLES.md` for the permission matrix and migration steps.

## Useful commands

```bash
npm run dev       # Start local development
npm run lint      # Run ESLint
npm run test      # Run workflow unit tests
npm run build     # Check the production build
npm run start     # Run a production build locally
```

## Project structure

```text
app/                  Next.js pages, APIs, sitemap and robots rules
components/           Shared page elements and interactive quiz/admin UI
lib/content.ts        Empty MCQ fallback and category placeholders
lib/data.ts           MySQL queries and content access functions
lib/db.ts             MySQL connection pool
lib/admin-auth.ts     Signed, HTTP-only admin session
sql/migrations/       Versioned MySQL schema changes
sql/seed.sql          Subject and topic categories only
```

## Before deployment

- Set `NEXT_PUBLIC_SITE_URL` to the real HTTPS website URL.
- Configure a production MySQL database that the web host can reach; `localhost` refers to the web server after deployment, not your Ubuntu computer.
- Set strong, private `ADMIN_PASSWORD` and `SESSION_SECRET` values in the hosting environment.
- Add only reviewed MCQs with exam/source references and verify every past-paper source before publishing.
- Test the site on mobile and connect the domain to Google Search Console.
