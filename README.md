# MCQPath

MCQPath is a search-friendly MCQ and exam-practice website for learners in Pakistan. It is built with Next.js App Router, React, TypeScript, MySQL, and Tailwind CSS.

## Phase 1 features

- Public subject, topic, quiz, search, and past-paper practice pages
- Timed quizzes with server-side answer checking and explanations
- MySQL schema and sample seed questions for English, General Knowledge, and Pakistan Studies
- Role-based admin workspace for subjects, topics, MCQs, past papers, and team accounts
- Page metadata, canonical URLs, sitemap, robots rules, and responsive layouts
- Demo content available before MySQL is configured

The included exam resources are clearly labelled practice sets. They are sample content, not represented as official past papers.

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

4. Create the database tables, add the admin-role schema, and load sample content:

   ```bash
   sudo mysql < sql/migrations/001_initial_schema.sql
   sudo mysql < sql/migrations/002_role_based_admin.sql
   sudo mysql < sql/migrations/003_learner_accounts.sql
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

If database variables are missing, the public pages use the built-in sample content. The admin area requires MySQL, migrations `001` and `002`, and its environment settings. Learner registration, bookmarks, and quiz history additionally require migration `003` and `SESSION_SECRET`.

## Admin roles

Sign in at `/admin` with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` configured in `.env.local`. This environment-based account is the bootstrap super admin and is not stored in the application database. Use **Team & roles** in the dashboard to create additional accounts. Each team account needs a unique email and a password of at least 12 characters; the password is stored as a salted scrypt hash.

| Role | Access |
| --- | --- |
| Super admin | Manage categories, MCQs, past papers, publishing, and team accounts; assign the Admin role |
| Admin | Manage all content and team accounts; cannot assign the Admin role |
| Editor | Create and edit subjects/topics, MCQs, and papers as drafts |
| Reviewer | Review records and publish or archive content |

Editors' changes are saved as drafts. A reviewer or admin must publish them before learners can see the content. Removing team access is done by setting the account to **Inactive**, which also ends its access on its next request.

## Useful commands

```bash
npm run dev       # Start local development
npm run lint      # Run ESLint
npm run build     # Check the production build
npm run start     # Run a production build locally
```

## Project structure

```text
app/                  Next.js pages, APIs, sitemap and robots rules
components/           Shared page elements and interactive quiz/admin UI
lib/content.ts        Demo content used before connecting MySQL
lib/data.ts           MySQL queries and content access functions
lib/db.ts             MySQL connection pool
lib/admin-auth.ts     Signed, HTTP-only admin session
sql/migrations/       Versioned MySQL schema changes
sql/seed.sql          Sample subjects, questions, and practice sets
```

## Before deployment

- Set `NEXT_PUBLIC_SITE_URL` to the real HTTPS website URL.
- Configure a production MySQL database that the web host can reach; `localhost` refers to the web server after deployment, not your Ubuntu computer.
- Set strong, private `ADMIN_PASSWORD` and `SESSION_SECRET` values in the hosting environment.
- Replace demo questions with reviewed material and verify all official past-paper sources before labelling content as an official paper.
- Test the site on mobile and connect the domain to Google Search Console.
