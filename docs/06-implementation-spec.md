# 06 — Implementation Spec

The executable detail behind [03-development-plan.md](03-development-plan.md). Code here is
the intended shape, verified against live docs for `ai@7`, `drizzle-orm@0.45.2` and `pgvector`.
Where a signature was checked against documentation it is marked **[verified]**.

---

## 1. Module dependency graph

Strictly one-directional. Nothing in `lib/rag/` imports from `app/` or `components/`.

```
lib/db/schema.ts ──────────┐
                           ├──> lib/db/queries.ts ──┐
lib/db/index.ts  ──────────┘                        │
                                                    ├──> app/api/chat/route.ts
lib/rag/parse.ts ──> lib/rag/chunk.ts ──> lib/rag/embed.ts ──> lib/rag/retrieve.ts ──┤
                                                    │                                │
lib/rag/prompt.ts ──────────────────────────────────┤                                │
lib/rag/tools.ts  ──────────────────────────────────┘                                │
                                                                                     │
lib/rag/parse|chunk|embed ─────────────────> app/api/documents/route.ts               │
                                                                                     │
components/** ───────────────────────────────────────────────────────────────────────┘
                (import types only, never db or rag modules)
```

The rule that keeps this honest: **`components/` may import types from `lib/`, never
functions.** Any component needing data gets it as props from an RSC or from `useChat`.

---

## 2. Core type contracts

These four types are the spine. Every module boundary speaks one of them.

```ts
// lib/rag/types.ts

/** Output of every parser. One block = one page (PDF) or one section (MD) or one paragraph run (TXT). */
export interface LocatedBlock {
  text: string;
  /** 1-indexed page, PDF only */
  page?: number;
  /** Heading path, Markdown only, e.g. "Setup > Environment" */
  section?: string;
  /** Offsets into the full reconstructed document text */
  charStart: number;
  charEnd: number;
}

/** A chunk before embedding. Locator fields are carried straight through from LocatedBlock. */
export interface PendingChunk {
  chunkIndex: number;
  content: string;
  pageFrom?: number;
  pageTo?: number;
  section?: string;
  charStart: number;
  charEnd: number;
}

/** A chunk retrieved for a query, joined with its document. */
export interface RetrievedChunk {
  id: string;
  content: string;
  filename: string;
  kind: 'pdf' | 'txt' | 'md';
  pageFrom: number | null;
  pageTo: number | null;
  section: string | null;
  charStart: number;
  charEnd: number;
  score: number;
}

/** What the client renders. Built server-side only; never assembled from model output. */
export interface Citation {
  chunkId: string;
  /** 1-based marker the model used, e.g. 1 for "[1]" */
  index: number;
  filename: string;
  /** Human locator: "p. 12" | "Setup > Environment" | "lines 340-388" | null */
  locator: string | null;
  excerpt: string;
}
```

---

## 3. Database

### 3.1 Drizzle schema — `lib/db/schema.ts`

```ts
import { sql, type SQL } from 'drizzle-orm';
import {
  customType, index, integer, jsonb, pgTable, text, timestamp, uuid, vector,
} from 'drizzle-orm/pg-core';
import type { UIMessage } from 'ai';

/** pgvector has a first-class Drizzle type; tsvector does not, so declare it. [verified] */
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const chats = pgTable('chats', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    kind: text('kind', { enum: ['pdf', 'txt', 'md'] }).notNull(),
    pageCount: integer('page_count'),
    status: text('status', { enum: ['processing', 'ready', 'failed'] })
      .notNull()
      .default('processing'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('documents_chat_id_idx').on(t.chatId)],
);

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    pageFrom: integer('page_from'),
    pageTo: integer('page_to'),
    section: text('section'),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    // 1536, not the model default of 3072 — pgvector HNSW caps at 2000 dims. See 04/D2.
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    contentTsv: tsvector('content_tsv').generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', ${chunks.content})`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('chunks_tsv_idx').using('gin', t.contentTsv),
    index('chunks_document_id_idx').on(t.documentId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    // The AI SDK's own message id — makes re-saving a stream idempotent. See 04/D5.
    id: text('id').primaryKey(),
    chatId: uuid('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    parts: jsonb('parts').notNull().$type<UIMessage['parts']>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_chat_created_idx').on(t.chatId, t.createdAt)],
);

export type Chat = typeof chats.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Chunk = typeof chunks.$inferSelect;
export type Message = typeof messages.$inferSelect;
```

### 3.2 Migration note

`drizzle-kit generate` will **not** emit the pgvector extension. Hand-edit migration `0000`
so its first line is:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Neon supports `vector` on the free plan, but the extension must exist before the `chunks`
table is created or the migration fails on a cold database. Verify after push:

```sql
SELECT extname FROM pg_extension WHERE extname = 'vector';
\d+ chunks   -- confirm chunks_embedding_idx is hnsw, not btree
```

### 3.3 Connection — `lib/db/index.ts`

```ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

export const db = drizzle(neon(process.env.DATABASE_URL), { schema });
```

HTTP driver, not WebSocket: every query here is a single round-trip, no transactions spanning
requests, and HTTP is the cheaper fit for serverless.

---

## 4. Parsing — `lib/rag/parse.ts`

One exported function per kind, all returning `LocatedBlock[]`.

```ts
export async function parsePdf(bytes: Uint8Array): Promise<{ blocks: LocatedBlock[]; pageCount: number }>
export function parseMarkdown(text: string): LocatedBlock[]
export function parseText(text: string): LocatedBlock[]
```

**PDF** — `unpdf` returns one string per page when `mergePages: false` **[verified]**:

```ts
import { extractText, getDocumentProxy } from 'unpdf';

const pdf = await getDocumentProxy(bytes);
const { totalPages, text } = await extractText(pdf, { mergePages: false }); // text: string[]
```

Each page becomes one block with `page = i + 1`, and `charStart` accumulates across pages.
Pages whose text is empty after trimming are skipped, but still advance the page counter.

> **If every page is empty**, the PDF is image-only (a scan). Fail the document with
> `"This PDF contains no extractable text — it may be a scanned image. OCR is not supported."`
> Do **not** store zero chunks and report `ready`; a document that answers nothing while
> claiming success is the worst available outcome.

**Markdown** — split on ATX headings (`^#{1,6}\s`). Maintain a heading stack so `section` is
the full path (`"Setup > Environment > Secrets"`). Content before the first heading gets
`section: undefined`.

**TXT** — split on blank lines into paragraph runs, accumulating offsets. `section` stays
undefined; the locator falls back to line numbers derived from `charStart`.

---

## 5. Chunking — `lib/rag/chunk.ts`

```ts
export function chunkBlocks(blocks: LocatedBlock[], opts?: {
  targetChars?: number;  // default 1000
  overlapChars?: number; // default 150
  minChars?: number;     // default 200
}): PendingChunk[]
```

**Algorithm**

1. Process blocks in order. **Never merge across a page boundary** — a chunk spanning pages 3
   and 4 cannot be cited unambiguously (04/D3).
2. Accumulate a block's text into the current chunk while `length < targetChars`.
3. On overflow, break at the last sentence boundary (`/(?<=[.!?])\s+/`) within the final 200
   chars; if none exists, break at the last whitespace; if none, hard-cut.
4. Start the next chunk with the trailing `overlapChars` of the previous one, snapped forward
   to a word boundary.
5. A trailing fragment shorter than `minChars` merges back into the previous chunk **if they
   share a page**; otherwise it stands alone (a short final page is legitimate).
6. `pageFrom` / `pageTo` / `section` copy from the source block. `charStart` / `charEnd` are
   absolute offsets into the reconstructed document text.

**Invariants worth an assertion in dev:** `chunkIndex` is dense and ascending from 0;
`charEnd > charStart`; `pageFrom === pageTo` for every PDF chunk.

---

## 6. Embedding — `lib/rag/embed.ts`

```ts
import { google } from '@ai-sdk/google';
import { embed, embedMany } from 'ai';

// Model ids live in lib/ai/models.ts — chosen by measurement, see docs/04 D11.
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from '@/lib/ai/models';

/** Truncated Gemini vectors are not unit-length; cosine distance needs them normalised. 04/D2 */
function l2normalise(v: number[]): number[] {
  const norm = Math.hypot(...v);
  return norm === 0 ? v : v.map((x) => x / norm);
}

export async function embedChunks(texts: string[]): Promise<number[][]> {
  // embedMany splits oversized requests internally — no manual batching needed. [verified]
  const { embeddings } = await embedMany({
    model: google.embedding(EMBEDDING_MODEL),
    values: texts,
    providerOptions: { google: { outputDimensionality: EMBEDDING_DIMS } },
    maxParallelCalls: 4, // stay polite to the free tier
  });
  return embeddings.map(l2normalise);
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: google.embedding(EMBEDDING_MODEL),
    value: text,
    providerOptions: { google: { outputDimensionality: EMBEDDING_DIMS } },
  });
  return l2normalise(embedding);
}
```

> **Sanity check to run once in Phase 2:** embed `"the cat sat on the mat"` and `"a feline
> rested on the rug"`; cosine similarity must exceed ~0.6. Against an unrelated sentence it
> should fall well below. If both score ~0.99, normalisation or dimensionality is wrong — this
> is the check that catches a silently broken embedding pipeline before it poisons retrieval.

---

## 7. Retrieval — `lib/rag/retrieve.ts`

One raw SQL round-trip. Two ranked lists, fused with Reciprocal Rank Fusion
(`score = Σ 1/(k + rank)`, `k = 60`).

```ts
export async function retrieve(args: {
  chatId: string;
  query: string;
  limit?: number; // default 8
}): Promise<RetrievedChunk[]>
```

```sql
WITH vec AS (
  SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.embedding <=> $1::vector) AS rank
  FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE d.chat_id = $2 AND d.status = 'ready'
  ORDER BY c.embedding <=> $1::vector
  LIMIT 20
),
lex AS (
  SELECT c.id,
         ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.content_tsv, q.query) DESC) AS rank
  FROM chunks c
  JOIN documents d ON d.id = c.document_id,
       plainto_tsquery('english', $3) AS q(query)
  WHERE d.chat_id = $2 AND d.status = 'ready' AND c.content_tsv @@ q.query
  ORDER BY ts_rank_cd(c.content_tsv, q.query) DESC
  LIMIT 20
),
fused AS (
  SELECT id, SUM(w) AS score FROM (
    SELECT id, 1.0 / (60 + rank) AS w FROM vec
    UNION ALL
    SELECT id, 1.0 / (60 + rank) AS w FROM lex
  ) s GROUP BY id
)
SELECT c.id, c.content, c.page_from, c.page_to, c.section, c.char_start, c.char_end,
       d.filename, d.kind, f.score
FROM fused f
JOIN chunks c   ON c.id = f.id
JOIN documents d ON d.id = c.document_id
ORDER BY f.score DESC
LIMIT $4;
```

Notes:
- `<=>` is pgvector's **cosine distance** operator and is what `chunks_embedding_idx` was
  built for. Using `<->` (L2) instead would silently bypass the index.
- The `lex` CTE contributes nothing when `plainto_tsquery` yields no lexemes (a query of pure
  stopwords). RRF degrades cleanly to vector-only — no special-casing needed.
- Scoping is by `chat_id`, so a chat only ever retrieves from its own documents.
- **If cut (04/D6):** delete the `lex` and `fused` CTEs and order by `embedding <=> $1` directly.

---

## 8. Prompt construction — `lib/rag/prompt.ts`

```ts
export function buildContextBlock(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] (${c.filename}${formatLocator(c) ? `, ${formatLocator(c)}` : ''})\n${c.content}`)
    .join('\n\n---\n\n');
}

export function formatLocator(c: RetrievedChunk): string | null {
  if (c.kind === 'pdf' && c.pageFrom != null) return `p. ${c.pageFrom}`;
  if (c.kind === 'md' && c.section) return c.section.replace(/>/g, '›'); // "Setup › Environment"
  if (c.kind === 'txt') return `lines ${lineOf(c.charStart)}–${lineOf(c.charEnd)}`;
  return null;
}
```

Chunk ids are deliberately **absent** from the prompt — the model only ever sees `[1]`..`[8]`
and cannot reference anything outside that set (04/D4).

### System prompt

```
You answer questions about documents the user has uploaded. You have been given numbered
excerpts from those documents as context.

RULES
1. Answer ONLY from the numbered context below. Do not use outside knowledge, and do not
   infer facts the context does not state.
2. Every factual claim must carry a citation marker naming the excerpt it came from, like
   [1] or [2][4]. Place the marker at the end of the sentence it supports.
3. If the context does not contain the answer, say so plainly: "The document doesn't cover
   that." Then, if useful, name what the document does discuss nearby. Never fill a gap with
   a guess, and never apologise at length.
4. If excerpts conflict, say so and cite both.
5. Cite only numbers that appear in the context. Never invent a number, a page, a filename,
   or a quotation.
6. When the answer rests on specific passages, call the showEvidence tool so the user can
   inspect the supporting text. Prefer it for multi-part or comparative answers.
7. Be concise. Match the document's own terminology rather than paraphrasing it away.

CONTEXT
{contextBlock}
```

Rule 3 is the one that decides whether this reads as a real product or a demo. It gets an
explicit test in the QA script.

### Empty-retrieval short circuit

If `retrieve()` returns zero rows, **do not call the model**. Stream a fixed message instead
(`"I couldn't find anything relevant in <filename>. Try rephrasing…"`). Saves a call, removes
any chance of an ungrounded answer, and is faster.

---

## 9. Tool — `lib/rag/tools.ts`

```ts
import { tool } from 'ai';
import { z } from 'zod';

export function buildTools(retrieved: RetrievedChunk[]) {
  return {
    showEvidence: tool({
      description:
        'Present the supporting evidence for a factual answer as inspectable cards. ' +
        'Call this whenever the answer rests on specific passages in the document.',
      inputSchema: z.object({           // v7 uses inputSchema, NOT parameters. [verified]
        claims: z
          .array(
            z.object({
              claim: z.string().describe('One factual assertion, in your own words'),
              citationIndexes: z
                .array(z.number().int().min(1))
                .min(1)
                .describe('1-based indexes of supporting context blocks, e.g. [1, 3]'),
              confidence: z.enum(['high', 'medium', 'low']),
            }),
          )
          .min(1)
          .max(6),
      }),
      execute: async ({ claims }) => ({
        claims: claims.map((c) => ({
          claim: c.claim,
          confidence: c.confidence,
          // Indexes resolved against THIS request's retrieval set. Bad indexes vanish. 04/D4
          citations: c.citationIndexes
            .map((i) => retrieved[i - 1])
            .filter((chunk): chunk is RetrievedChunk => Boolean(chunk))
            .map((chunk, n) => ({
              chunkId: chunk.id,
              index: n + 1,
              filename: chunk.filename,
              locator: formatLocator(chunk),
              excerpt: chunk.content,   // from Postgres, never from the model
            })),
        })),
      }),
    }),
  };
}
```

The tool factory closes over `retrieved`, so resolution is scoped to the request. A claim
whose indexes all resolve to nothing keeps its text but renders with a "no source" state —
visible, not hidden.

---

## 10. API contracts

### `POST /api/documents` — multipart

| Field | Type |
|---|---|
| `file` | File, ≤ 4 MB, `.pdf` / `.txt` / `.md` |
| `chatId` | uuid; a new chat is created if absent |

`202` → `{ documentId, chatId, status: 'processing' }`
Errors → `{ error: { code, message } }` with the codes in §11.

### `GET /api/documents/[id]`

`200` → `{ id, filename, status, pageCount, chunkCount, error }`
Client polls every 800 ms while `processing`, giving up after 90 s with a timeout error.

### `POST /api/chat`

Body `{ chatId: string, messages: UIMessage[] }`. Returns an AI SDK UI message stream.

```ts
// app/api/chat/route.ts — v7 shape. [verified]
export const maxDuration = 60;

export async function POST(req: Request) {
  const { chatId, messages } = BodySchema.parse(await req.json());

  const question = lastUserText(messages);
  const retrieved = await retrieve({ chatId, query: question });

  const result = streamText({
    model: google(CHAT_MODEL),
    system: buildSystemPrompt(buildContextBlock(retrieved)),
    messages: await convertToModelMessages(messages),
    tools: buildTools(retrieved),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      onEnd: ({ messages }) => saveMessages({ chatId, messages }),
    }),
  });
}
```

> **Resolved in Phase 0:** `gemini-3.6-flash`. `gemini-2.5-flash` is rejected for new keys and
> `gemini-3.7-flash` was unavailable when tested. See docs/04 D11 for the measurements.

---

## 11. Error taxonomy

Every failure maps to a code, an HTTP status, and a sentence a non-technical user can act on.
No raw exception text ever reaches the UI.

| Code | Status | User-facing message |
|---|---|---|
| `FILE_TOO_LARGE` | 413 | "That file is over the 4 MB limit. Try a smaller document." |
| `UNSUPPORTED_TYPE` | 415 | "Only PDF, TXT and Markdown files are supported." |
| `EMPTY_DOCUMENT` | 422 | "That file appears to be empty." |
| `NO_EXTRACTABLE_TEXT` | 422 | "This PDF has no extractable text — it may be a scan. OCR isn't supported." |
| `PARSE_FAILED` | 422 | "We couldn't read that file. It may be corrupted or password-protected." |
| `EMBEDDING_FAILED` | 502 | "We couldn't process the document just now. Please try again." |
| `RATE_LIMITED` | 429 | "The AI service is busy. Wait a moment and try again." |
| `DB_UNAVAILABLE` | 503 | "We can't reach the database. Please retry in a moment." |
| `CHAT_NOT_FOUND` | 404 | "That conversation no longer exists." |

Ingestion failures write both `status = 'failed'` and the message into `documents.error`, so
a reload still shows why — the error survives the page, not just the toast.

---

## 12. Component contracts

```ts
// components/chat/composer.tsx
interface ComposerProps {
  chatId: string;
  onSend: (text: string) => void;
  onUpload: (file: File) => void;
  disabled: boolean;
  uploadState: { status: 'idle' | 'uploading' | 'processing' | 'failed'; filename?: string; error?: string };
}

// components/evidence/evidence-card.tsx
interface EvidenceCardProps {
  claim: string;
  confidence: 'high' | 'medium' | 'low';
  citations: Citation[];   // [] renders the "no source" state, never hidden
  defaultOpen?: boolean;
}

// components/evidence/citation-chip.tsx
interface CitationChipProps {
  citation: Citation;      // click/hover reveals excerpt + locator
}
```

Rendering the tool part must handle **all four** states — `input-streaming`,
`input-available`, `output-available`, `output-error` **[verified]** — because a skipped
`output-error` branch renders as a blank message when the tool throws, which is the kind of
bug that only shows up in front of an interviewer.

---

## 13. QA script (run against the deployed URL, not localhost)

| # | Action | Expected |
|---|---|---|
| 1 | Load app with no chats | Empty state explaining how to start |
| 2 | Ask a question before uploading | Prompt to upload; no error, no model call |
| 3 | Upload a 10-page text PDF | Progress, then ready; chunks in Neon with correct pages |
| 4 | Ask a question answered on a known page | Streams; citation shows that exact page |
| 5 | Click a citation | Excerpt matches the PDF text verbatim |
| 6 | **Ask something the document does not cover** | "The document doesn't cover that" — **no fabrication** |
| 7 | Ask an exact-token question (a code, an acronym) | Lexical arm finds it where vector search alone would miss |
| 8 | Ask a comparative question | `showEvidence` renders; cards expand |
| 9 | **Hard reload** | Full conversation restored **including evidence cards** |
| 10 | Upload a `.docx` | `UNSUPPORTED_TYPE`, clear message |
| 11 | Upload a 6 MB file | `FILE_TOO_LARGE`, rejected client-side before upload |
| 12 | Upload a scanned/image PDF | `NO_EXTRACTABLE_TEXT`, document marked failed |
| 13 | Reload after a failed ingest | Failure and its reason still visible |
| 14 | Open in a private window after idle | Skeleton during Neon cold start, no layout jump |
| 15 | Break `DATABASE_URL` in a preview deploy | `DB_UNAVAILABLE`, no stack trace leaked |

Rows **6** and **9** are the two that most often fail silently in RAG demos. They are the
first two to run, every time.
