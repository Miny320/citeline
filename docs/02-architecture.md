# 02 — Architecture

## 1. Stack (versions verified against the npm registry on 2026-08-28)

| Concern | Choice | Version | Why |
|---|---|---|---|
| Framework | Next.js App Router | `16.3.3` | Required by brief |
| Language | TypeScript (`strict`) | 5.x | Required by brief |
| AI | Vercel AI SDK | `ai@7.0.83`, `@ai-sdk/react@4.0.86` | Required by brief |
| Provider | Google Generative AI | `@ai-sdk/google@4.0.55` | Free AI Studio tier for **both** chat and embeddings |
| DB | Neon Postgres + `pgvector` | free plan | Required by brief |
| ORM | Drizzle | `drizzle-orm@0.45.2` | First-class `vector` column + HNSW index support; migrations as plain SQL |
| Validation | Zod | `4.4.3` | Peer-compatible with `ai@7` (accepts `^3.25.76` or `^4.1.8`) |
| PDF | `unpdf` | `1.8.1` | Serverless-safe pdfjs build; **returns text per page** |
| UI | Tailwind + shadcn/ui | latest | Speed; not a differentiator, do not over-invest |

> **AI SDK v7 is not v5.** The route handler API changed. Verified current pattern:
>
> ```ts
> return createUIMessageStreamResponse({
>   stream: toUIMessageStream({
>     stream: result.stream,
>     originalMessages: messages,
>     onEnd: ({ messages }) => saveChat({ chatId, messages }),
>   }),
> });
> ```
>
> Most tutorials — and most model training data — still show `result.toUIMessageStreamResponse()`.
> Tools use `inputSchema` (not `parameters`). Client parts are typed `tool-${toolName}` with
> states `input-streaming` → `input-available` → `output-available` | `output-error`.

## 2. Platform constraints that actually shape the design

Verified from Vercel docs (2026-08-24 revision):

| Limit | Value | Design consequence |
|---|---|---|
| **Request body size** | **4.5 MB** | **The binding constraint.** Cap uploads at 4 MB client- and server-side with a clear error. No Blob storage needed — adding it would burn budget for no assessed benefit. |
| Max duration (Hobby) | 300s | Not a problem. Synchronous ingest inside the route handler is safe; no queue or worker needed. |
| Memory (Hobby) | 2 GB / 1 vCPU | Fine for a file of 4 MB or less. In-memory parse is acceptable. |
| pgvector HNSW | **2000 dimensions max** | `gemini-embedding-001` defaults to **3072** → must set `outputDimensionality: 1536`. |
| Neon free plan | autosuspends when idle | First request after idle is slow → a cold-start skeleton is a *real* requirement, not decoration. |

> **Gotcha to handle:** Gemini embeddings truncated below their native 3072 dims are **not
> unit-normalised**. After requesting 1536 dims, L2-normalise each vector before storing, or
> cosine distance is subtly wrong. This does not error — it silently degrades retrieval.

## 3. Data flow

### Ingestion (write path)

```
composer file picker
  -> POST /api/documents  (multipart, max 4 MB)
      -> validate: mime + extension + size          [reject early, clear message]
      -> insert documents row (status: processing)  [row exists at once, so UI can poll]
      -> parse
           .pdf -> unpdf extractText(mergePages:false) -> string[] indexed by page
           .md  -> split on ATX headings, keep heading path
           .txt -> paragraph split, track line offsets
      -> chunk (~1000 chars, 150 overlap, never across a page boundary)
           each chunk carries { pageFrom, pageTo, section, charStart, charEnd }
      -> embedMany(gemini-embedding-001, 1536d) -> L2 normalise
      -> insert chunks (batched)
      -> update documents.status = 'ready' | 'failed' + error text
```

### Query (read path)

```
useChat sendMessage
  -> POST /api/chat { chatId, messages }
      -> embed(question)
      -> HYBRID RETRIEVAL over chunks scoped to this chat's documents
             a) vector:  1 - cosineDistance(embedding, q)        top 20
             b) lexical: ts_rank_cd(tsv, plainto_tsquery(q))      top 20
             c) fuse with Reciprocal Rank Fusion -> top 8
      -> build context block, each chunk labelled [1]..[8] with its real DB id
      -> streamText(gemini flash, system prompt + context, tools: { showEvidence })
      -> stream to client
      -> onEnd: persist assistant UIMessage.parts as JSONB
```

## 4. Database schema

Four tables. `pgvector` enabled via `CREATE EXTENSION IF NOT EXISTS vector;` in the first migration.

```
chats
  id           uuid pk default gen_random_uuid()
  title        text                      -- derived from first user message
  created_at   timestamptz not null default now()
  updated_at   timestamptz not null default now()

documents
  id           uuid pk
  chat_id      uuid not null -> chats.id on delete cascade
  filename     text not null
  mime_type    text not null
  byte_size    integer not null
  kind         text not null             -- 'pdf' | 'txt' | 'md'
  page_count   integer                   -- null for txt/md
  status       text not null             -- 'processing' | 'ready' | 'failed'
  error        text
  created_at   timestamptz not null default now()
  idx: (chat_id)

chunks
  id           uuid pk
  document_id  uuid not null -> documents.id on delete cascade
  chunk_index  integer not null
  content      text not null
  page_from    integer                   -- pdf only
  page_to      integer
  section      text                      -- md heading path, e.g. "Setup > Environment"
  char_start   integer                   -- txt fallback locator
  char_end     integer
  embedding    vector(1536) not null
  tsv          tsvector generated always as (to_tsvector('english', content)) stored
  idx: hnsw (embedding vector_cosine_ops)
  idx: gin (tsv)
  idx: (document_id)

messages
  id           text pk                   -- the AI SDK message id, not a fresh uuid
  chat_id      uuid not null -> chats.id on delete cascade
  role         text not null             -- 'user' | 'assistant'
  parts        jsonb not null            -- the full UIMessage.parts array
  created_at   timestamptz not null default now()
  idx: (chat_id, created_at)
```

**Why `messages.parts` is JSONB rather than a flattened text column.**
AI SDK v7 messages are an array of typed parts — text, tool calls, tool results, sources.
Storing only flattened text would lose the `showEvidence` tool output, so the structured UI
(R9) would vanish on reload and silently break R6. Storing `parts` wholesale round-trips
everything. On load, messages pass through `validateUIMessages({ messages, tools })` so a
later schema change cannot crash the chat with malformed historical rows.

**Why `messages.id` is the SDK's own id.** Persistence becomes idempotent — re-saving the
same stream upserts rather than duplicating.

## 5. Citation design (the part that is actually graded)

The failure mode to design against is **the model inventing a plausible citation**.

**Protocol**

1. Retrieved chunks are injected into the system prompt numbered `[1]`..`[8]`, with the
   filename and locator but **not** the DB id: `[1] (report.pdf, p. 12) <content>`.
   The server keeps the index → chunk-id mapping privately for this request. Withholding the
   id means there is no identifier for the model to fabricate.
2. The model is instructed to cite inline as `[1]`, `[2]`, and that uncited factual claims
   are not permitted — if nothing supports an answer, it must say so.
3. On the server, marker → chunk id is resolved **from the retrieval set this request
   actually built**. The model never supplies an id, only an index into a server-owned
   array. An out-of-range index is dropped.
4. The excerpt shown to the user is read from the DB row, **not** from model output. The
   quoted text is therefore guaranteed verbatim.

This makes a fabricated citation structurally impossible rather than merely unlikely. The
model's only influence is *which* of the real retrieved chunks to point at.

**Locator display, degrading honestly**

| Source | Shows |
|---|---|
| PDF | `report.pdf · p. 12` |
| Markdown | `spec.md · Setup › Environment` |
| TXT | `notes.txt · lines 340–388` |

## 6. Structured UI component (R9)

**Choice: expandable evidence cards**, exposed as a `showEvidence` tool.

Rationale: the brief offers evidence cards / comparison table / timeline / checklist and asks
me to choose "what you think is most useful". For a document-chat product the highest-value
structured component is the one that makes grounding *inspectable* — it compounds with the
citation requirement (R8) instead of sitting beside it as decoration. A timeline or checklist
is only meaningful for documents that happen to contain dates or tasks; evidence cards are
meaningful for every document.

```ts
showEvidence: tool({
  description:
    'Present the supporting evidence for a factual answer as inspectable cards. ' +
    'Call this whenever the answer rests on specific passages in the document.',
  inputSchema: z.object({
    claims: z
      .array(
        z.object({
          claim: z.string().describe('One factual assertion, in your own words'),
          citationIndexes: z
            .array(z.number().int())
            .describe('Indexes of supporting context blocks, e.g. [1, 3]'),
          confidence: z.enum(['high', 'medium', 'low']),
        }),
      )
      .min(1)
      .max(6),
  }),
  // execute resolves indexes -> real chunk rows server-side
});
```

Collapsed card: the claim, its confidence, and source pills.
Expanded card: verbatim excerpt(s) with the locator, straight from Postgres.

Stretch, only if budget allows: a second `compareItems` tool rendering a comparison table for
documents that contrast options. Pre-declared as cuttable.

## 7. Project structure

```
app/
  page.tsx                   new chat / chat list (empty state lives here)
  chat/[id]/page.tsx         RSC: loads chat + messages from Neon
  api/
    chat/route.ts            streamText + retrieval + tools + persistence
    documents/route.ts       upload + ingest
    documents/[id]/route.ts  status polling
components/
  chat/                      composer (with upload), message list, streaming indicator
  evidence/                  evidence card, citation chip, excerpt popover
  states/                    skeletons, empty states, error boundary
lib/
  db/schema.ts               drizzle tables (single source of truth for types)
  db/index.ts                neon client
  rag/parse.ts               pdf / md / txt -> located text blocks
  rag/chunk.ts               chunking with locator metadata
  rag/embed.ts               embedMany + L2 normalise
  rag/retrieve.ts            hybrid search + RRF
  rag/prompt.ts              context block construction
drizzle/                     generated SQL migrations (committed)
docs/                        this folder
```

## 8. Deliberate non-goals

Not building, and the README will say so plainly: auth, multi-tenant scoping, file storage
(original bytes are parsed then discarded — only text is retained), background job queue,
re-ranking model, stream resumption, rate limiting, multi-document cross-comparison, and
mobile polish beyond "does not break".

## 9. Cost posture and free-tier constraints

Verified 2026-08-28. **Total running cost: $0. No credit card required for any of the three.**

| Service | Plan | Card? | Relevant limits |
|---|---|---|---|
| Vercel | Hobby | No | 1M invocations, 4 CPU-hrs, 360 GB-hrs memory, 300s max duration, 100 deploys/day |
| Neon | Free (permanent, not a trial) | No | 0.5 GB/project, 100 CU-hours/mo, 100 projects, autosuspend after 5 min idle |
| Google AI Studio | Free tier | No | Gemini Flash chat models and `gemini-embedding-001` both included, free in all available regions |

**Constraints that follow from this, and what each one changes:**

1. **Free-tier Gemini content is used to improve Google's products.** Demo with public or
   synthetic documents only. Never a real client document. Stated in the README — the
   constraint is trivial here, but noticing it is the point.
2. **Free-tier rate limits are not published in the docs.** They are per-project and visible
   only in the AI Studio dashboard. **Phase 0 task:** read the actual RPM/TPM/RPD, then size
   retrieval `k`, `maxParallelCalls` in `embedChunks`, and the status-poll interval to fit.
   The `RATE_LIMITED` state (06 §11) covers the demo-day case regardless.
3. **Neon storage is not the binding limit.** A 1536-dim vector is ~6 KB, so 0.5 GB holds on
   the order of 80,000 chunks — hundreds of documents. The limit that actually shows is the
   **5-minute autosuspend**: the first request after idle is slow, which is precisely why the
   loading skeletons in Phase 5 are a functional requirement rather than decoration.
4. **Vercel Hobby is restricted to non-commercial, personal use** under their fair-use
   guidelines. A take-home submission qualifies; the brief mandates Hobby in any case. Do not
   reuse the project for commercial work.
5. **Exceeding a free limit suspends rather than bills.** Neon suspends compute until the next
   billing month; Vercel pauses the feature for ~30 days. There is no path to an accidental
   charge — but there *is* a path to a dead demo URL, so avoid load-testing the deployment.
