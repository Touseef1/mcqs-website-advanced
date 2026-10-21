# MCQPath

MCQPath is a search-friendly MCQ and exam-practice website for learners in Pakistan. It is built with Next.js App Router, React, TypeScript, MySQL, and Tailwind CSS.

## Phase 1 features

- Public subject, topic, quiz, search, and past-paper practice pages
- Timed quizzes with server-side answer checking and explanations
- MySQL schema and sample seed questions for English, General Knowledge, and Pakistan Studies
- Password-protected admin area for publishing questions
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

4. Create the database tables and load sample content:

   ```bash
   sudo mysql < sql/migrations/001_initial_schema.sql
   sudo mysql < sql/seed.sql
   ```

5. Set `DB_USER` and `DB_PASSWORD` in `.env.local` to match the user created above. Set a private admin password and generate a session secret:

   ```bash
   openssl rand -hex 32
   ```

   Put the generated value in `SESSION_SECRET`. Do not commit `.env.local`.

6. Start the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). The admin area is at `/admin`.

If database variables are missing, the public pages use the built-in sample content. The admin area requires both MySQL and its environment settings.

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
