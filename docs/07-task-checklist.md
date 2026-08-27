# 07 — Task Checklist

Granular, checkable tasks with exact commands. Work top to bottom. Each phase ends with a
**gate** — do not start the next phase until the gate passes, and if the clock has run out,
fire that phase's cut-line from [03](03-development-plan.md) and move on.

Legend: `[ ]` todo · `[x]` done · `[~]` cut (record in [05-worklog.md](05-worklog.md))

---

## Phase 0 — Skeleton and deployment path (0:30)

**Scaffold**
- [ ] `npx create-next-app@latest . --typescript --app --tailwind --eslint --src-dir=false --import-alias "@/*"`
- [ ] `npm i ai @ai-sdk/react @ai-sdk/google drizzle-orm @neondatabase/serverless unpdf zod`
- [ ] `npm i -D drizzle-kit @types/node`
- [ ] `tsconfig.json`: confirm `"strict": true`; add `"noUncheckedIndexedAccess": true`
- [ ] `.eslintrc`: error on `@typescript-eslint/no-explicit-any`
- [ ] `.gitignore` covers `.env*.local`; commit `.env.example`

**Accounts and secrets**
- [ ] Neon project created → copy pooled connection string
- [ ] Google AI Studio key created
- [ ] `.env.local`: `DATABASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`
- [ ] `.env.example` with the same keys, values blanked

**Prove the model id exists** *(cheap now, painful at hour four)*
- [ ] Scratch script: one `generateText` call with the chosen Gemini flash id → prints a reply
- [ ] Scratch script: one `embed` call at `outputDimensionality: 1536` → prints `embedding.length === 1536`

**Deploy first**
- [ ] `git init`, first commit, push to a public GitHub repo
- [ ] Import to Vercel; set both env vars for Production **and** Preview
- [ ] `app/api/health/route.ts` → `SELECT 1` via Neon, returns `{ ok: true, db: 1 }`
- [ ] Deploy

> **GATE 0:** `curl https://<app>.vercel.app/api/health` returns `{"ok":true,"db":1}`.
> Nothing else matters until this passes.

---

## Phase 1 — Schema and data layer (0:45)

- [ ] `lib/db/schema.ts` — four tables exactly as in [06 §3.1](06-implementation-spec.md#31-drizzle-schema--libdbschemats)
- [ ] `drizzle.config.ts` pointing at `lib/db/schema.ts`
- [ ] `npx drizzle-kit generate`
- [ ] **Hand-edit migration `0000`**: add `CREATE EXTENSION IF NOT EXISTS vector;` as line 1
- [ ] `npx drizzle-kit push` (or `migrate`)
- [ ] Verify in Neon SQL editor:
  - [ ] `SELECT extname FROM pg_extension WHERE extname='vector';` returns a row
  - [ ] `\d+ chunks` shows `chunks_embedding_idx` as **hnsw**, not btree
  - [ ] `\d+ chunks` shows `content_tsv` as a stored generated column with a GIN index
- [ ] `lib/db/index.ts` — neon-http drizzle client
- [ ] `lib/db/queries.ts`: `createChat`, `getChat`, `getMessages`, `saveMessages` (upsert on id),
      `listDocuments`, `createDocument`, `setDocumentStatus`, `insertChunks`
- [ ] Scratch script round-trips a chat + a message with a `parts` array
- [ ] Commit + deploy

> **GATE 1:** all four tables live in Neon with correct index types; round-trip script passes.
> **Cut-line:** drop `content_tsv` + GIN if this overruns → vector-only retrieval.

---

## Phase 2 — Ingestion pipeline (1:00)

**Highest-risk phase. Test on the deployed URL, not just locally.**

- [ ] `lib/rag/types.ts` — the four contracts from [06 §2](06-implementation-spec.md#2-core-type-contracts)
- [ ] `lib/rag/parse.ts`
  - [ ] `parsePdf` via `extractText(pdf, { mergePages: false })`, 1-indexed pages
  - [ ] empty-after-trim pages skipped but still advance the counter
  - [ ] all-pages-empty → throw `NO_EXTRACTABLE_TEXT`
  - [ ] `parseMarkdown` with a heading stack producing the full section path
  - [ ] `parseText` paragraph runs with char offsets
- [ ] `lib/rag/chunk.ts` — algorithm per [06 §5](06-implementation-spec.md#5-chunking--libragchunkts); assert the three invariants
- [ ] `lib/rag/embed.ts` — `embedChunks` / `embedQuery` + `l2normalise`
- [ ] **Run the embedding sanity check** (similar pair > ~0.6, unrelated pair much lower)
- [ ] `app/api/documents/route.ts`
  - [ ] Zod-validate multipart: size ≤ 4 MB, extension **and** mime both checked
  - [ ] create `chats` row if no `chatId`
  - [ ] insert `documents` row as `processing` **before** parsing, return `202` immediately after work starts
  - [ ] parse → chunk → embed → `insertChunks`
  - [ ] `status = 'ready'` with `pageCount`; on throw → `failed` + mapped error code
  - [ ] wrap the whole body so no raw exception escapes
- [ ] `app/api/documents/[id]/route.ts` — status + `chunkCount`
- [ ] Composer file input wired (accept `.pdf,.txt,.md`), client-side size guard, 800 ms polling
- [ ] Deploy, then **on the live URL**: upload a real multi-page PDF
- [ ] Verify in Neon: chunk count sane, `page_from` values match the real PDF pages

> **GATE 2:** a real PDF ingests **on Vercel** with correct page numbers in Neon.
> **Cut-line:** drop MD heading paths → treat `.md` as plain text.

---

## Phase 3 — Chat, retrieval, streaming, persistence (1:00)

- [ ] `lib/rag/retrieve.ts` — the RRF CTE from [06 §7](06-implementation-spec.md#7-retrieval--libragretrievets)
  - [ ] confirm `<=>` (cosine), not `<->`
  - [ ] confirm `EXPLAIN` shows an index scan on `chunks_embedding_idx`
  - [ ] stopword-only query returns vector results, does not error
- [ ] `lib/rag/prompt.ts` — `formatLocator`, `buildContextBlock`, system prompt verbatim from [06 §8](06-implementation-spec.md#system-prompt)
- [ ] `app/api/chat/route.ts`
  - [ ] Zod-validate body
  - [ ] empty-retrieval short circuit (**no model call**)
  - [ ] `streamText` + `createUIMessageStreamResponse` / `toUIMessageStream` — **v7 shape**
  - [ ] `onEnd` → `saveMessages` (server-side persistence)
  - [ ] `export const maxDuration`
- [ ] `app/chat/[id]/page.tsx` — RSC loads messages, runs `validateUIMessages({ messages, tools })`
- [ ] `app/page.tsx` — chat list / new chat
- [ ] Client `useChat({ id, messages, transport: new DefaultChatTransport({ api: '/api/chat' }) })`
- [ ] Deploy and test streaming on the live URL
- [ ] **Hard-reload test** — conversation restored from Neon

> **GATE 3:** ask → stream → hard reload → conversation still there.
> **Cut-line:** drop RRF → vector-only ordering.

---

## Phase 4 — Citations and evidence cards (0:45)

- [ ] `lib/rag/tools.ts` — `buildTools(retrieved)` closing over the request's retrieval set
- [ ] Out-of-range citation indexes silently dropped (unit-test this explicitly)
- [ ] `components/evidence/citation-chip.tsx` — filename + locator, expands to excerpt
- [ ] `components/evidence/evidence-card.tsx` — collapsed claim/confidence/pills; expanded excerpts
- [ ] Empty-citations card renders a visible "no source" state, never blank
- [ ] Tool part rendering handles **all four** states incl. `output-error`
- [ ] Inline `[n]` markers in streamed text become chips
- [ ] Deploy; verify an excerpt matches the source PDF character-for-character
- [ ] **Reload test** — evidence cards survive

> **GATE 4:** citations resolve to real DB rows; cards survive reload.
> **Cut-line:** drop `confidence`; drop the stretch `compareItems` table.

---

## Phase 5 — States and hardening (0:30)

- [ ] Loading: chat skeleton (Neon cold start), ingest progress, streaming indicator
- [ ] Empty: no chats · no document yet · zero retrieval hits
- [ ] Error: every code in [06 §11](06-implementation-spec.md#11-error-taxonomy) has a UI path
- [ ] `app/error.tsx` + `app/chat/[id]/not-found.tsx`
- [ ] Failed ingest still shows its reason after a reload
- [ ] Run **the full QA script**, [06 §13](06-implementation-spec.md#13-qa-script-run-against-the-deployed-url-not-localhost), rows 6 and 9 first
- [ ] `npx tsc --noEmit` clean · `npm run lint` clean · `npm run build` clean
- [ ] Grep for `any`, `console.log`, `TODO`

> **GATE 5:** all 15 QA rows pass on the deployed URL.

---

## Phase 6 — README and submission (0:30)

- [ ] `README.md` with all six required sections:
  - [ ] **Setup** — clone, `.env.example`, Neon, key, `drizzle-kit push`, `npm run dev`
  - [ ] **Architecture + DB schema** — condensed from [02](02-architecture.md), with the data-flow diagram
  - [ ] **Key trade-offs** — the strongest 5–6 from [04](04-decisions.md), each with its rejected alternative
  - [ ] **Time spent** — the real table from [05](05-worklog.md)
  - [ ] **AI tools used**
  - [ ] **AI output corrected/rejected** — the v7 route-handler example (C1)
- [ ] **"What I did not build and why"** section — the cut list, stated plainly
- [ ] Sample PDF committed so a reviewer can test in 30 seconds
- [ ] Cold-start check: live URL in a private window, full happy path
- [ ] Repo public; README links the live URL; final commit
- [ ] Reply to Cameron with live URL + repo link

> **GATE 6:** a stranger can clone, configure and run it from the README alone.

---

## Standing rules for the whole build

1. **Verify AI-generated `ai` SDK code against live docs before running it.** v7 changed the
   route handler; training data is mostly v5. Log every correction in [05](05-worklog.md).
2. **Deploy at the end of every phase.** A phase is not done until it works in production.
3. **No `any`.** If typing is hard, the boundary is probably wrong.
4. **When a cut-line fires, write it down immediately** — the README's honesty is graded.
5. **Commit per phase** with a real message. The commit history is part of the submission.
