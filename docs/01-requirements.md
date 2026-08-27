# 01 — Requirements & Acceptance Criteria

## 1. Verbatim requirements from the brief

**Hard constraints (non-negotiable, all are pass/fail):**

| # | Requirement |
|---|---|
| R1 | TypeScript and Next.js App Router |
| R2 | Vercel AI SDK |
| R3 | Deployed on Vercel, free Hobby plan |
| R4 | Neon Postgres, free plan, with pgvector |
| R5 | Upload PDF, TXT or Markdown **from inside the conversation** |
| R6 | Persist document metadata, extracted content/chunks, embeddings, chats and messages in Neon so the conversation **survives a reload** |
| R7 | Ask questions about the document, **streamed** responses **grounded** in its content |
| R8 | Citations for factual answers: **filename**, **page or section where possible**, **relevant excerpt** |
| R9 | ≥1 meaningful **structured UI component** in the chat via **tool calling or structured output** |
| R10 | Sensible **loading, empty and error** states |

**Explicitly out of scope:** authentication, billing, admin area.
**Explicitly allowed:** any AI SDK-supported provider; AI coding tools "encouraged and expected".
**Explicitly required:** no paid services.

**Submission artefacts:** live Vercel URL, GitHub repo, README covering setup,
architecture/DB schema, key trade-offs, time spent, AI tools used, and **one concrete
example of correcting or rejecting AI-generated output**.

## 2. Read-between-the-lines requirements

These are not stated but are what actually separates a pass from a strong pass:

- **R5 "from inside the conversation"** — upload must be part of the chat composer, not a
  separate upload page that then redirects. This is a UX judgement test.
- **R6 "survives a reload"** — implies chats are addressable (`/chat/[id]`) and messages are
  reloaded from Postgres, *including* the structured tool-call UI from R9. Persisting only
  plain text would silently fail R9-on-reload.
- **R8 "where possible"** — an honest implementation gives page numbers for PDFs, heading
  sections for Markdown, and degrades gracefully (line ranges) for TXT. Faking page numbers
  for a TXT file is worse than omitting them.
- **"grounded"** — the app must be able to say *"the document does not cover that"* rather
  than answering from model priors. An ungrounded-but-fluent answer is the single most
  damaging failure mode for a RAG demo.

## 3. Assessment axes → what I will do about each

The brief names five axes. Mapping each to a deliberate, visible design choice:

| Axis | How this build addresses it |
|---|---|
| **Functionality & reliability** | Ingestion is a state machine (`pending → processing → ready / failed`) with the error surfaced in the UI, not a silent failure. Uploads validated for type and size before work starts. |
| **Retrieval & citation quality** | Page/section metadata captured at parse time (never inferred later). Hybrid vector + full-text retrieval. Citations are **IDs resolved server-side against the DB**, so the model cannot fabricate a source. |
| **TypeScript & architecture** | Strict TS, no `any`. Layered: `db/` → `lib/rag/` → `app/api/` → components. Zod at every boundary (upload, tool inputs, persisted message parts). Schema types inferred from Drizzle, single source of truth. |
| **UX / product judgement** | Upload inside the composer. Streaming with visible retrieval step. Citations expandable inline, not a footnote dump. Empty state teaches the user what to do. |
| **Clarity of decisions** | This `docs/` folder, the decision log, and an honest worklog with the cut-list. |

## 4. Acceptance checklist (definition of done)

Each item must be demonstrable on the **deployed** URL, not just locally.

**Ingestion**
- [ ] Upload control is inside the chat composer
- [ ] Accepts `.pdf`, `.txt`, `.md`; rejects anything else with a clear message
- [ ] Rejects >4 MB with a clear message (Vercel 4.5 MB body cap — see 02)
- [ ] Corrupt / zero-text PDF produces a `failed` status with a readable reason
- [ ] Progress is visible during parse + embed
- [ ] Document metadata, chunks and embeddings all land in Neon

**Chat & retrieval**
- [ ] Answers stream token-by-token
- [ ] Answers are grounded; out-of-scope questions get an explicit "not in this document"
- [ ] Reload of `/chat/[id]` restores the full conversation **including tool-call UI**
- [ ] Asking a question before any upload gives a helpful empty state, not an error

**Citations**
- [ ] Every factual claim carries ≥1 citation marker
- [ ] Citation shows filename + page (PDF) or section (MD) or line range (TXT)
- [ ] Citation expands to the verbatim excerpt actually retrieved
- [ ] Citation IDs are validated server-side; unknown IDs are dropped, never rendered

**Structured UI**
- [ ] At least one tool renders a real component (expandable evidence cards)
- [ ] Tool call shows a loading state while running
- [ ] Tool component survives reload

**States**
- [ ] Loading: skeleton on chat load, spinner during ingest, streaming indicator
- [ ] Empty: no chats, no documents, no retrieval hits
- [ ] Error: upload rejected, ingest failed, model/provider error, DB unreachable

**Submission**
- [ ] Live Vercel URL works from a cold start in a private window
- [ ] Public GitHub repo, clean commit history
- [ ] README covers all six required sections
