# Citeline

Chat with your documents — with citations you can actually check.

Upload a PDF, TXT or Markdown file inside the conversation, ask questions about it, and get
streamed answers grounded in the document. Every factual claim carries a citation showing the
filename, the page or section, and the verbatim excerpt it came from.

> **Status: in progress.** This README is completed in the final phase of the build. Sections
> marked _pending_ are not yet written. Planning and design documents live in [`docs/`](docs/).

**Live URL:** _pending deployment_
**Planning docs:** [docs/](docs/) — requirements, architecture, decision log, worklog

---

## Setup

Requires Node.js 20.9+ (developed on 22.23). Both services below are free and need no credit
card.

```bash
git clone <repo-url>
cd citeline
npm install
```

### 1. Database — Neon

Create a project at [neon.com](https://neon.com) (Free plan) and copy the **pooled**
connection string.

### 2. Model provider — Google AI Studio

Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The free
tier covers both the Gemini Flash chat models and `gemini-embedding-001`.

> On the free tier Google may use submitted content to improve their products, so use public
> or synthetic documents only.

### 3. Environment

```bash
cp .env.example .env.local
```

Fill in `DATABASE_URL` and `GOOGLE_GENERATIVE_AI_API_KEY`.

### 4. Verify the provider before building

```bash
npm run verify:provider
```

Confirms the chat model id resolves, embeddings return at 1536 dimensions, vectors are
unit-length after normalisation, and semantic similarity actually works. If this fails, stop —
nothing downstream will behave correctly.

### 5. Create the database schema

```bash
npm run db:migrate
npm run verify:db
```

The first migration enables `pgvector` and creates four tables with an HNSW index for vector
search and a GIN index for full-text search.

> Use `db:migrate`, **not** `db:push`. `push` generates DDL from the schema and never reads
> the migration files, so it would skip the hand-added `CREATE EXTENSION vector` statement.
>
> `verify:db` then confirms what actually landed — in particular that the embedding index is
> really HNSW rather than silently falling back to a sequential scan.

### 6. Run

```bash
npm run dev
```

Then check <http://localhost:3000/api/health> — it should report `ok: true` and
`pgvector: true`.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run check` | Typecheck + lint |
| `npm run verify:provider` | Provider and embedding sanity checks |
| `npm run verify:db` | Verify schema, index types and cascades in Neon |
| `npm run db:generate` | Generate a migration from the schema |
| `npm run db:migrate` | Apply migrations to Neon (use this) |
| `npm run db:studio` | Browse the database |

---

## Architecture

_Pending — see [docs/02-architecture.md](docs/02-architecture.md) for the full design._

**Stack:** Next.js 16 (App Router) · TypeScript (strict) · Vercel AI SDK 7 ·
Google Gemini (chat + embeddings) · Neon Postgres + pgvector · Drizzle ORM · Tailwind 4

## Database schema

_Pending — see [docs/02-architecture.md](docs/02-architecture.md#4-database-schema)._

## Key trade-offs

_Pending — see [docs/04-decisions.md](docs/04-decisions.md) for the full decision log._

## Time spent

_Pending — tracked live in [docs/05-worklog.md](docs/05-worklog.md)._

## AI tools used

_Pending — tracked in [docs/05-worklog.md](docs/05-worklog.md)._

## Where I corrected or rejected AI output

_Pending — logged in [docs/05-worklog.md](docs/05-worklog.md)._

## What I did not build, and why

_Pending._
