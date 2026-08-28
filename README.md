# Citeline

Chat with your documents — with citations you can actually check.

Upload a PDF, TXT or Markdown file inside the conversation, ask questions about it, and get
streamed answers grounded in the document. Every factual claim carries a citation showing the
filename, the page or section, and the verbatim excerpt it came from.

**Live URL:** https://citeline-henna.vercel.app
**Repository:** https://github.com/Miny320/citeline

Planning and design documents live in [`docs/`](docs/) — requirements, architecture, the full
decision log, and a worklog written as the build happened.

---

## Contents

- [Setup](#setup)
- [Architecture](#architecture)
- [Database schema](#database-schema)
- [Key trade-offs](#key-trade-offs)
- [Time spent](#time-spent)
- [AI tools used](#ai-tools-used)
- [Where I corrected or rejected AI output](#where-i-corrected-or-rejected-ai-output)
- [What I did not build, and why](#what-i-did-not-build-and-why)

---

## Setup

Requires Node.js 20.9+ (developed on 22.23). Both services are free and need no credit card.

```bash
git clone https://github.com/Miny320/citeline.git
cd citeline
npm install
```

### 1. Database — Neon

Create a project at [neon.com](https://neon.com) (Free plan) and copy the **pooled**
connection string. The host should contain `-pooler`.

### 2. Model provider — Google AI Studio

Create a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The free
tier covers both the Gemini Flash chat models and `gemini-embedding-001`.

> On the free tier Google may use submitted content to improve their products, so use public
> or synthetic documents only. The API also refuses requests from some datacenter and VPN exit
> IPs with `FAILED_PRECONDITION: User location is not supported` — if you hit that locally,
> it is your egress IP, not your key.

### 3. Environment

```bash
cp .env.example .env.local
```

Fill in `DATABASE_URL` and `GOOGLE_GENERATIVE_AI_API_KEY`.

### 4. Verify the provider before building anything on it

```bash
npm run verify:provider
```

Confirms the chat model id resolves, embeddings return at 1536 dimensions, vectors are
unit-length after normalisation, and semantic similarity actually separates a paraphrase from
unrelated text. If this fails, stop — nothing downstream will behave correctly.

### 5. Create the schema

```bash
npm run db:migrate
npm run verify:db
```

> Use `db:migrate`, **not** `db:push`. `push` generates DDL from the schema and never reads
> the migration files, so it would skip the hand-added `CREATE EXTENSION vector`.

`verify:db` asserts what actually landed — in particular that the embedding index really is
HNSW rather than having silently fallen back to a sequential scan.

### 6. Run

```bash
npm run dev
```

Then check <http://localhost:3000/api/health>; it should report `ok: true` and
`pgvector: true`. A sample document is committed at
[`fixtures/acme-handbook.pdf`](fixtures/acme-handbook.pdf) — upload it and ask
*"What is the refund window for enterprise customers?"* or *"What does ERR_2043 mean?"*

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run check` | Typecheck + lint + tests |
| `npm test` | Unit tests (87) |
| `npm run verify:provider` | Model, dimensions, normalisation, similarity |
| `npm run verify:db` | Schema, index *types*, cascades, JSONB round-trip |
| `npm run verify:rag` | End-to-end: ingest the fixture, retrieve, assert page attribution |
| `npm run db:generate` | Generate a migration from the schema |
| `npm run db:migrate` | Apply migrations to Neon |
| `npm run fixtures` | Regenerate the sample PDF |

---

## Architecture

**Stack:** Next.js 16 (App Router) · TypeScript strict · Vercel AI SDK 7 · Google Gemini
(chat + embeddings) · Neon Postgres + pgvector · Drizzle ORM · Tailwind 4

### Ingestion (write path)

```
composer file picker
  → POST /api/documents  (multipart, max 4 MB)
      → validate: extension + MIME + size          [reject early, clear message]
      → insert documents row as `processing`       [so a failure has somewhere to live]
      → parse
           .pdf → unpdf extractText(mergePages:false) → one string per page
           .md  → split on ATX headings, keep the heading path
           .txt → paragraph runs with char offsets
      → chunk (~1000 chars, 150 overlap, never across a page boundary)
      → embedMany(gemini-embedding-001 @ 1536d) → L2 normalise
      → insert chunks
      → status = 'ready' | 'failed' + reason
```

### Query (read path)

```
useChat sendMessage
  → POST /api/chat { chatId, messages }
      → embed(question)
      → HYBRID RETRIEVAL scoped to this chat's documents
            a) vector:  embedding <=> query          top 20
            b) lexical: ts_rank_cd over tsvector      top 20
            c) fuse by Reciprocal Rank Fusion  →      top 8
      → stream `data-sources` part (the resolved retrieval set)
      → streamText(gemini-3.6-flash, grounded system prompt, showEvidence tool)
      → onEnd: persist the full UIMessage.parts array as JSONB
```

### How citations are made unforgeable

This is the part the whole design rests on.

1. The model sees numbered excerpts — `[1] (handbook.pdf · p. 2)` — **with no chunk ids**.
2. It cites `[1]`, `[2]` inline. Its only freedom is *which real passage to point at*.
3. The server maps those indexes back to rows from the set it retrieved **for that request**.
   Anything out of range is dropped.
4. The excerpt displayed is read from Postgres, never from model output — so the quoted text
   is guaranteed to be what the document says.

A fabricated citation is structurally impossible rather than merely unlikely. This is covered
by tests: an out-of-range, zero or negative index resolves to nothing, and chunk ids never
appear in the context block.

### Layering

`components/` may import **types** from `lib/`, never functions. Anything needing data gets it
as props from a server component or from `useChat`. `lib/rag/` never imports from `app/`.

---

## Database schema

Four tables. The first migration enables `pgvector`.

```
chats        id · title · created_at · updated_at

documents    id · chat_id→chats · filename · mime_type · byte_size
             kind ('pdf'|'txt'|'md') · page_count
             status ('processing'|'ready'|'failed') · error
             idx (chat_id)

chunks       id · document_id→documents · chunk_index · content
             page_from · page_to · section · char_start · char_end
             embedding    vector(1536)
             content_tsv  tsvector GENERATED ALWAYS AS to_tsvector('english', content) STORED
             idx hnsw (embedding vector_cosine_ops)
             idx gin  (content_tsv)
             idx (document_id)

messages     id (the AI SDK's message id) · chat_id→chats · role
             parts jsonb  (the full UIMessage.parts array)
             idx (chat_id, created_at)
```

All foreign keys cascade on delete, so removing a chat removes its documents, chunks and
messages. Verified by test, not assumed.

**Why `messages.parts` is JSONB rather than flattened text.** AI SDK v7 messages are typed
part arrays including tool calls, tool results and custom data parts. Flattening to text would
make evidence cards and citations vanish on refresh — the structured UI would appear to work
in a live demo and silently fail the moment anyone reloaded. Storing `parts` wholesale
round-trips everything, and `validateUIMessages` on load means a later schema change degrades
gracefully instead of crashing the conversation.

**Why `messages.id` is the SDK's own id.** Persistence becomes idempotent: re-saving a stream
upserts rather than duplicating.

---

## Key trade-offs

Full log with rejected alternatives in [`docs/04-decisions.md`](docs/04-decisions.md).

### 1. No absolute similarity threshold — rank-based fusion only

Every pgvector tutorial, including Drizzle's own, filters with `.where(gt(similarity, 0.5))`.
I measured what these embeddings actually score:

| | cosine |
|---|---|
| correct passage | **0.8932** |
| unrelated passage, same document | 0.7386 |
| unrelated passage, same document | 0.7220 |
| unrelated passage, same document | 0.7032 |

`gt(similarity, 0.5)` matches **everything** — it reads as a relevance filter, raises no error,
and does nothing. Tightening it would be worse: `0.8` starts discarding correct matches when a
document's phrasing differs from the question's. Absolute scores are not stable across models
or corpora; the *ordering* and the *margin* are. So retrieval ranks by Reciprocal Rank Fusion,
which consumes ranks rather than scores, and grounding is enforced by the system prompt
instead — a semantic judgement rather than an arithmetic one.

### 2. Hybrid retrieval rather than vector-only

Pure vector search reliably misses exact tokens — error codes, product names, acronyms — which
is much of what people actually ask a document chat. The lexical arm costs one generated
`tsvector` column and a GIN index, no extra service. The sample document contains `ERR_2043`
specifically so this is testable.

### 3. Locators captured at parse time, never inferred afterwards

`unpdf` returns one string per page, so the true page number is free while the structure is
still visible. Flatten first and page attribution can only be re-derived by guessing at
offsets — which is how demos end up citing page 7 for content on page 9. Chunking refuses to
build a chunk that spans two pages, because such a chunk cannot be cited unambiguously.

### 4. Synchronous ingestion, no queue

Vercel Hobby allows 300s and a ≤4 MB file parses and embeds well inside that. A queue would
add a service and a class of failure modes to solve a problem this app does not have. The
`processing → ready | failed` status column gives the honest UX benefits of async — progress,
a real failure state that survives a reload — at almost no cost.

### 5. 4 MB upload cap

Vercel caps function request bodies at 4.5 MB. That is a platform limit, not a preference —
exceeding it returns an opaque `413 FUNCTION_PAYLOAD_TOO_LARGE` that reads as a broken app.
Rejecting at 4 MB with an explanation turns a confusing platform error into an understood
product boundary. Blob storage would lift the cap, but the app discards original bytes after
parsing, so there would be nothing for it to usefully hold.

### 6. Google Gemini for both chat and embeddings

The brief requires that no paid services are needed. Google AI Studio's free tier covers chat
*and* embeddings from one key and one provider package — the only mainstream option where a
reviewer can clone, paste one key, and have everything work. OpenAI has better-documented
embeddings but no free tier.

Model ids were chosen by measurement, not assumption ([`lib/ai/models.ts`](lib/ai/models.ts)):

| Candidate | Result |
|---|---|
| `gemini-2.5-flash` | Rejected by the API: "no longer available to new users" |
| `gemini-3.7-flash` | Failed after 3 retries: "currently experiencing" issues |
| `gemini-3.5-flash` | Worked, 23,053 ms |
| **`gemini-3.6-flash`** | **Worked, 4,931 ms** ✅ |

---

## Time spent

**About 6 hours 55 minutes** — over the five-hour box, the last hour and a quarter being a UI and accessibility pass after reviewing the deployed app, reported as measured rather than as budgeted. Tracked live in [`docs/05-worklog.md`](docs/05-worklog.md).

| Phase | Budget | Actual |
|---|---|---|
| Planning + stack verification | — | 0:20 |
| Implementation spec | — | 0:15 |
| 0 — Skeleton, deploy path, provider verification | 0:30 | 0:50 |
| 1 — Schema and data layer | 0:45 | 0:35 |
| 2 — Ingestion pipeline | 1:00 | 1:05 |
| 3 — Chat, retrieval, persistence | 1:00 | 0:50 |
| 4 — Citations and evidence cards | 0:45 | 0:40 |
| 5 — States, hardening, deploy, QA | 0:30 | 0:40 |
| 6 — README and submission | 0:30 | 0:25 |
| 7 — UI redesign (after reviewing the deployed app) | — | 0:50 |
| 8 — Accessibility pass | — | 0:25 |

The plan front-loaded deployment and provider verification deliberately: the failure mode that
ruins these submissions is a polished local app that will not deploy, discovered at hour five.
Two of the three most damaging problems in this build were caught in the first thirty minutes
because of that ordering.

---

## AI tools used

| Tool | Used for |
|---|---|
| Claude Code (Opus 5) | Planning, live-documentation verification, scaffolding, implementation, test authoring, review |

Working rule for the whole build: **every AI-generated snippet touching a fast-moving
dependency was checked against live documentation before being trusted.** `ai`, `next` and
`zod` had all shipped majors recently. That rule caught four separate defects, below.

---

## Where I corrected or rejected AI output

Eight instances are logged in [`docs/05-worklog.md`](docs/05-worklog.md). The most consequential:

### Rejected the similarity threshold that every pgvector tutorial uses

**What AI produced**, reproducing the canonical Drizzle example:

```ts
const similarity = sql`1 - (${cosineDistance(chunks.embedding, embedding)})`;
.where(gt(similarity, 0.5))   // "only keep relevant matches"
```

**Why I rejected it:** rather than reasoning about whether 0.5 was right, I measured. With a
retrieval-shaped probe the correct passage scored 0.8932 while three *unrelated* passages from
the same document scored 0.7386, 0.7220 and 0.7032. Two entirely unrelated sentences still
scored 0.5355.

So the predicate matches everything. It reads as a relevance filter, returns plausible
results, raises no error, and does nothing whatsoever.

**Why it mattered:** this is the most dangerous class of bug in the build — syntactically fine,
semantically inert, and invisible. It would have shipped looking completely correct, and the
symptom would have been "retrieval quality is a bit vague sometimes", which is nearly
impossible to trace back to a `where` clause that appears to be doing its job. Catching it
required running the numbers, not reading the code.

### Four others, briefly

- **AI SDK v7 route handler.** Generated code used `result.toUIMessageStreamResponse()` — the
  v5 shape. Beyond being wrong, it has no server-side persistence hook, which would have
  pushed message saving to the client, where an interrupted stream loses the reply. The v7
  `onEnd` callback is what makes "survives a reload" actually true.
- **`unpdf` detaches your buffer.** pdf.js *transfers* the `ArrayBuffer` to its worker, so a
  second read throws — and my error handler reported it to the user as "your file may be
  corrupted". Found only because the tests parse the same fixture twice. `parsePdf` now passes
  a copy.
- **`drizzle-kit generate` omits `CREATE EXTENSION vector`.** The migration fails on any cold
  database, but passes for anyone whose local database already has the extension — so it would
  have broken on the reviewer's machine, not mine.
- **The message renderer handled citations but not markdown.** Gemini emits markdown; nothing
  rendered it, so every answer showed literal backticks and asterisks. Typecheck, lint and 31
  tests were all green on output that was visibly wrong to anyone who opened the page. Caught
  by grepping the *deployed* DOM rather than trusting that "the chat works" meant "the chat
  looks right".

- **The palette failed WCAG contrast.** `--subtle` — used for hints, timestamps and footers
  throughout — measured 2.73:1 in light mode against a 4.5:1 requirement. Colours are strings,
  so nothing in the toolchain could have objected. Found by computing relative luminance for
  every foreground/background pairing the UI renders; all 22 now clear 4.6:1 and are asserted
  in tests. The same pass found there was no focus-visible style at all.

The recurring shape is worth naming: **every one of these was invisible to the typechecker,
the linter and the test suite until a check was written specifically for it.** Three of them
also fail only on someone else's machine, cold database, or eyes — never on the author's.

---

## What I did not build, and why

Stated plainly rather than left as unexplained gaps.

**Deliberately out of scope** (the brief excludes them): authentication, billing, admin.

**Deliberate cuts, pre-declared in the plan:**

- **Line-range locators for TXT citations.** PDFs cite a page and Markdown cites a heading
  path, but plain text degrades to filename + excerpt. Real line numbers need capture at parse
  time plus two more columns; showing an invented locator would be worse than showing none.
- **A `compareItems` comparison-table tool.** `showEvidence` was the structured component
  worth building first because it makes grounding inspectable, which compounds with the
  citation requirement instead of sitting beside it as decoration.
- **Re-ranking model.** Better retrieval quality, but another provider, more latency and more
  free-tier exposure. The wrong trade inside five hours.

**Known limitations:**

- **No authentication means no privacy boundary.** Authentication was explicitly out of scope,
  but the consequence is worth stating plainly rather than leaving implied: every conversation
  and every uploaded document is visible to anyone with the URL, and all conversations are
  listed on the home page. That is acceptable for a demo and is surfaced in the UI, but it is
  the first thing that would need building before real use.
- **Gemini's free tier is rate-limited to 20 requests for `gemini-3.6-flash`.** Quota is
  metered per model, so the app falls back through a chain of models when one is exhausted
  (`lib/ai/stream-with-fallback.ts`). The switch happens before any token is sent, so an
  answer never restarts mid-sentence, and only rate limits trigger it — a bad key would fail
  identically on every model. Sustained
  use will hit it, and the API asks for a short wait before retrying. The app detects this
  specifically and says *"The AI service is busy right now. Wait a moment and try again."*
  If every model in the chain is exhausted, the UI says *"The AI service is busy right now.
  Wait a moment and try again."* with a **Try again** button, rather than a generic failure.
  Retrieval still runs and its sources still stream, so only the generated answer is affected.
  Discovered by exhausting the quota during QA; the real cause was read out of the Vercel
  runtime logs.
- Scanned/image-only PDFs are rejected with a clear message. No OCR.
- Files over 4 MB are rejected (Vercel's body limit).
- No stream resumption: closing the tab mid-answer loses that answer, though everything
  already persisted survives.
- Retrieval is scoped per chat, so documents cannot be compared across conversations.
- Mobile is usable but not specifically designed for.
