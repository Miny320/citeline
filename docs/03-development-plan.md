# 03 — Development Plan

## Budget: 5 hours, 7 phases

The brief timeboxes this at five hours and asks for time spent to be reported. The plan below
is built to *fit* that, not to be aspirational. Each phase has a hard stop. If a phase
overruns its box, the pre-declared cut for that phase fires and the build moves on.

**Sequencing principle: deploy on day zero.** Phase 0 ends with a live Vercel URL serving a
hello-world that reads from Neon. Every subsequent phase ships to that URL. The single worst
outcome for this task is a beautiful local app that fails to deploy at hour 4:55 — so
deployment risk is retired first, while it is cheap to fix.

---

### Phase 0 — Skeleton and deployment path (0:00 → 0:30)

- `create-next-app` (TS, App Router, Tailwind), `strict: true`, no `any`
- Install: `ai`, `@ai-sdk/react`, `@ai-sdk/google`, `drizzle-orm`, `drizzle-kit`,
  `@neondatabase/serverless`, `unpdf`, `zod`
- Neon project created; `DATABASE_URL` in `.env.local`
- Google AI Studio key; `GOOGLE_GENERATIVE_AI_API_KEY`
- GitHub repo, first commit
- **Vercel project linked, env vars set, deployed**
- A `/api/health` route that runs `select 1` against Neon and returns the row

**Exit criteria:** the deployed URL returns healthy from Neon. Nothing else matters yet.

---

### Phase 1 — Schema and data layer (0:30 → 1:15)

- `lib/db/schema.ts` — the four tables from [02](02-architecture.md#4-database-schema)
- Migration 0000: `CREATE EXTENSION IF NOT EXISTS vector`, tables, HNSW + GIN indexes
- `drizzle-kit generate` + push to Neon; migrations committed
- Thin repository functions: `createChat`, `getChatWithMessages`, `saveMessages`,
  `createDocument`, `setDocumentStatus`, `insertChunks`
- Types inferred from Drizzle (`$inferSelect` / `$inferInsert`) — no hand-written duplicates

**Exit criteria:** tables live in Neon; a scratch script round-trips a chat + message.

**Cut if overrunning:** drop the `tsv` column and GIN index. Vector-only retrieval still
satisfies R7/R8; hybrid search is an enhancement, not a requirement. (Cheaper to re-add later
than to debug now.)

---

### Phase 2 — Ingestion pipeline (1:15 → 2:15)

The highest-risk phase — PDF parsing in a serverless runtime is where these builds usually
break, which is why it gets a full hour and comes before any chat work.

- `lib/rag/parse.ts` — three parsers returning a common `LocatedBlock[]`
  (`{ text, pageFrom?, pageTo?, section?, charStart, charEnd }`)
- `lib/rag/chunk.ts` — ~1000 chars / 150 overlap, never spanning a page boundary
- `lib/rag/embed.ts` — `embedMany` at `outputDimensionality: 1536`, **then L2 normalise**
- `POST /api/documents` — validate → insert `processing` row → parse → chunk → embed →
  insert chunks → mark `ready`; any throw marks `failed` with a readable reason
- `GET /api/documents/[id]` — status polling
- Upload control wired into the chat composer (R5)

**Exit criteria:** upload a real multi-page PDF **on the deployed URL** and see chunks with
correct page numbers in Neon.

**Cut if overrunning:** drop `.md` heading-path extraction and treat Markdown as plain text
(section becomes `null`). PDF page citations are the visible win; MD sections are a refinement.

---

### Phase 3 — Chat, retrieval, streaming, persistence (2:15 → 3:15)

- `lib/rag/retrieve.ts` — vector top-20 + lexical top-20 → RRF → top-8
- `lib/rag/prompt.ts` — numbered context block; grounding rules; explicit
  "say you don't know" instruction
- `POST /api/chat` — `streamText` + `createUIMessageStreamResponse` / `toUIMessageStream`,
  persisting in `onEnd`
- `app/chat/[id]/page.tsx` — RSC loads messages, passes through `validateUIMessages`
- `useChat` wired with `id` + `messages` + `DefaultChatTransport`

**Exit criteria:** ask a question, watch it stream, **hard-reload the page, conversation is
still there** (R6/R7).

**Cut if overrunning:** drop RRF, use vector-only ordering.

---

### Phase 4 — Citations and evidence cards (3:15 → 4:00)

- Server-side index → chunk-id resolution with out-of-range indexes dropped
- `showEvidence` tool (`inputSchema`, server `execute` resolving real rows)
- Citation chip component: filename + page/section/lines, expands to the verbatim excerpt
- Evidence card: collapsed claim + confidence + pills; expanded excerpts
- Tool part rendering across all four states, including `output-error`

**Exit criteria:** a factual answer renders cards whose excerpts match the DB exactly, and
survives reload (R8/R9).

**Cut if overrunning:** drop the `confidence` field and the stretch `compareItems` table.

---

### Phase 5 — States and hardening (4:00 → 4:30)

Straight down the R10 checklist in [01](01-requirements.md#4-acceptance-checklist-definition-of-done):

- Loading: chat skeleton (Neon cold start is real), ingest progress, streaming indicator
- Empty: no chats, no document uploaded yet, zero retrieval hits
- Error: bad file type, oversize file, ingest failure, provider error, DB unreachable
- One deliberate failure test of each error path against the deployed URL

**Exit criteria:** every box in the R10 section of the acceptance checklist ticked.

---

### Phase 6 — README, verification, submission (4:30 → 5:00)

- README: setup, architecture + schema, trade-offs, time spent, AI tools used, and the
  correction example — sourced from [04](04-decisions.md) and [05](05-worklog.md), which are
  written *as I go*, not reconstructed at the end
- Seed a sample PDF in the repo so a reviewer can test in 30 seconds
- Cold-start check of the live URL in a private window
- Final commit and submission email

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `unpdf` / pdfjs fails in the Vercel bundle | Medium | Phase 0 deploys early; Phase 2 tests parsing **on the deployed URL**, not just locally |
| AI SDK v7 API differs from tutorials and model output | **High** | Already verified against live docs — see the callout in [02](02-architecture.md#1-stack-versions-verified-against-the-npm-registry-on-2026-08-28). Treat every AI-generated route handler as suspect |
| Embedding dims exceed the pgvector HNSW limit | High if unchecked | Already caught: 3072 → `outputDimensionality: 1536` |
| Truncated Gemini vectors not normalised | Medium | L2 normalise in `embed.ts`; verify a known-similar pair scores high |
| Neon cold start looks like a hang | High | Skeletons; it is a UX requirement, not decoration |
| Free-tier rate limits during demo | Medium | Flash-tier chat model, small `k`, and a friendly error state on 429 |
| Scope creep past 5 hours | **High** | Cut-lines pre-declared per phase; anything cut is recorded honestly in the README |

## What "very perfect" means here

Not "the most features". The submission is judged on functionality and reliability,
retrieval and citation quality, TypeScript and architecture, UX judgement, and clarity of
decisions. So a small app where **every path works, every citation is real, and every cut is
explained** scores higher than a large app with two broken flows and an unexplained gap.

There is also a live coding session on this codebase afterwards. That is a strong argument
for a small, clean, well-named codebase I can navigate under pressure — and against a sprawl
of half-finished features I would have to apologise for.
