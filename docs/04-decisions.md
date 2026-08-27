# 04 — Decision Log

Written as decisions are made. This is the source for the "key trade-offs" section of the
final README. Format: decision, rationale, what was rejected, and what it costs.

---

## D1 — Google Gemini for both chat and embeddings

**Decision:** `@ai-sdk/google` with an AI Studio key. `gemini-embedding-001` at 1536 dims for
embeddings, a Gemini Flash model for chat.

**Why:** The brief requires that no paid services are needed. Google AI Studio has a free
tier covering *both* chat and embeddings from one key and one provider package — the only
mainstream option where a reviewer can clone the repo, paste one key, and have everything
work.

**Rejected:**
- *OpenAI* — best-documented embeddings, but no free tier; a reviewer without credit could not
  run it. Fails the spirit of the constraint.
- *Vercel AI Gateway string model ids* (`"google/gemini-..."`) — elegant, and the docs now show
  it as the default style, but it routes through Vercel credits and adds an account
  dependency for anyone cloning the repo. Explicit provider + own key is more portable.
- *Groq for chat + a separate embedding provider* — free and fast, but two providers, two
  keys, two failure modes, for no gain.

**Cost:** Gemini free-tier rate limits are modest. Under demo load that means occasional 429s,
so the UI needs a real rate-limit error state (folded into Phase 5).

---

## D2 — Embedding dimensions pinned to 1536, then L2-normalised

**Decision:** request `outputDimensionality: 1536` and normalise each vector before storing.

**Why:** `gemini-embedding-001` emits 3072 dims by default. **pgvector's HNSW index supports a
maximum of 2000 dimensions**, so the native output cannot be indexed — the app would either
fail to create the index or silently fall back to a sequential scan over every chunk.
Separately, Gemini vectors truncated below their native size are no longer unit-length, and
cosine distance on non-normalised vectors is subtly wrong. Neither problem raises an error;
both quietly degrade retrieval.

**Rejected:**
- *Store 3072 dims unindexed* — works at demo scale, but a vector column with no index in a
  submission assessed on retrieval quality is exactly the detail an interviewer probes.
- *A 768-dim model* — cheaper and smaller, but measurably weaker retrieval, which is a graded axis.

**Cost:** ~11 lines of normalisation code and a fixed dimension in the schema. Changing
embedding model later means a migration and a re-index of all chunks.

---

## D3 — Chunk locators captured at parse time, never inferred later

**Decision:** every chunk stores `pageFrom` / `pageTo` (PDF), `section` (Markdown heading
path), or `charStart` / `charEnd` (TXT), assigned while parsing. Chunks never span a page
boundary.

**Why:** R8 asks for page or section "where possible". Once page-delimited text is flattened
into one string, page attribution can only be re-derived by guessing at offsets — which is how
demos end up citing "page 7" for content on page 9. `unpdf`'s `extractText(pdf, { mergePages:
false })` hands back one string per page, so the true page number is free at parse time.
Refusing to let a chunk straddle pages keeps the locator unambiguous.

**Rejected:** flatten-then-chunk with offset arithmetic. Simpler, and wrong often enough to be
noticed by anyone who checks a citation against the source.

**Cost:** slightly smaller and less even chunks near page breaks. Worth it.

---

## D4 — Citations are server-resolved indexes, not model-supplied ids

**Decision:** the model receives numbered context blocks and cites `[1]`, `[2]`. The server
maps those numbers back to chunk rows from the retrieval set it built for that request. The
excerpt displayed comes from the database row, never from model output. Out-of-range indexes
are dropped.

**Why:** this is the difference between "the model usually cites correctly" and "a fabricated
citation is structurally impossible". If the model were asked to emit chunk ids or quote the
source text itself, both could be hallucinated, and a hallucinated *citation* is worse than a
hallucinated answer — it manufactures false confidence. Constraining the model to an index
into a server-owned array means its only freedom is choosing among genuinely retrieved
passages.

**Rejected:**
- *Model emits chunk UUIDs* — fabricable, and long ids waste tokens and invite transcription errors.
- *Model quotes the excerpt inline* — quotes drift from the source under paraphrasing pressure.

**Cost:** the model cannot cite anything outside the retrieved set. That is the intended
behaviour: if the answer is not in the retrieved context, it should say so.

---

## D5 — Messages persisted as JSONB `parts`, not flattened text

**Decision:** store the whole AI SDK `UIMessage.parts` array as JSONB, keyed by the SDK's own
message id; validate with `validateUIMessages` on load.

**Why:** R6 (survives reload) and R9 (structured UI) interact. AI SDK v7 messages are typed
part arrays including tool calls and results. Flattening to text would make the evidence cards
disappear on refresh — R9 would appear to work in a live demo and silently fail the moment a
reviewer hits reload. Using the SDK's id makes re-saving a stream idempotent rather than
duplicating rows. `validateUIMessages` on load means a later tool-schema change degrades
gracefully instead of crashing the chat on old rows.

**Rejected:** normalised `message_parts` table. Cleaner relationally, but nothing in this app
queries *inside* a part, so it buys join complexity and a hand-maintained mapping for no
retrieval benefit.

**Cost:** part contents are not directly queryable in SQL. Acceptable — nothing needs to.

---

## D6 — Hybrid retrieval (vector + full-text, fused with RRF)

**Decision:** run vector top-20 and Postgres `tsvector` top-20 in parallel, fuse with
Reciprocal Rank Fusion, take top-8. **Pre-declared as cuttable** if Phase 1 or 3 overruns.

**Why:** pure vector search reliably misses exact-token queries — error codes, product names,
section numbers, acronyms — which is exactly what people ask a document chat. The lexical side
is nearly free here: a generated `tsvector` column plus a GIN index, no extra service.
Retrieval quality is an explicitly graded axis.

**Rejected:**
- *Vector only* — simpler, and the failure mode (asking about `ERR_2043` and getting nothing)
  is very visible in a demo.
- *A re-ranking model* — better quality still, but another provider, more latency, and more
  free-tier exposure. Wrong trade at five hours.

**Cost:** one extra query and ~30 lines of fusion. If cut, the README will say so explicitly
rather than leaving it unmentioned.

---

## D7 — Synchronous ingestion in the route handler; no queue

**Decision:** parse, chunk, embed and store inside `POST /api/documents`, with a
`processing → ready | failed` status row created up front so the client can poll.

**Why:** Vercel Hobby allows 300s per function, and a document of 4 MB or less parses and
embeds well inside that. A queue would add a service, a worker, and a whole class of failure
modes to solve a problem this app does not have. The status column gives the honest UX
benefits of async (progress, resumable-looking UI, a real `failed` state) at almost no cost.

**Rejected:** background job queue / Vercel Workflows. Correct at production scale, overkill here.

**Cost:** a very large or pathological PDF could time out. Mitigated by the 4 MB cap, which is
forced by the platform anyway — see D8.

---

## D8 — 4 MB upload cap, enforced on client and server

**Decision:** reject files over 4 MB before any work starts, with an explicit message.

**Why:** **Vercel functions cap request *and* response bodies at 4.5 MB.** This is a platform
limit, not a preference — a larger upload returns an opaque `413 FUNCTION_PAYLOAD_TOO_LARGE`
that looks like a broken app. Enforcing 4 MB with a clear message turns a confusing platform
error into an understood product boundary.

**Rejected:** client-side direct upload to blob storage to bypass the cap. It is the correct
production answer and genuinely not hard — but it adds a storage service, signed-URL
plumbing, and a second ingest trigger, none of which is assessed. The app also discards
original bytes after parsing (only text is retained), so there is nothing for blob storage to
usefully hold.

**Cost:** large documents are unsupported. Stated plainly in the README rather than hidden.

---

## D9 — Expandable evidence cards as the structured UI component

**Decision:** implement `showEvidence` (claim + supporting citation indexes + confidence) as
the R9 component.

**Why:** the brief offers a menu and asks which is "most useful". For a document-chat product,
the component that earns its place is the one making grounding inspectable — it compounds with
R8 instead of sitting beside it. A timeline or checklist only renders meaningfully for
documents that happen to contain dates or tasks; evidence cards are meaningful for every
document, so the demo does not depend on the reviewer picking a convenient file.

**Rejected:** comparison table (needs a document that contrasts things), timeline (needs
dates), checklist (needs actions). Kept as an optional stretch, not a dependency.

**Cost:** overlaps conceptually with citations. Handled by making the card the *expanded,
claim-level* view and the inline chip the *lightweight* one, so they complement rather than duplicate.

---

## D10 — Deploy in Phase 0, before any feature work

**Decision:** the first 30 minutes end with a live Vercel URL reading from Neon, and every
phase thereafter ships to it.

**Why:** the failure mode that ruins these submissions is a polished local app that will not
deploy, discovered at 4:55. Serverless PDF parsing, `pgvector` extension creation, and env-var
wiring are the three things most likely to behave differently in production — all are cheap to
fix in hour 0 and expensive in hour 5.

**Rejected:** build locally, deploy at the end. Standard, and it front-loads none of the risk.

**Cost:** ~20 minutes early on that produces no visible feature.

---

## D11 — Model ids chosen by measurement, and pinned

**Decision:** `gemini-3.6-flash` for chat, `gemini-embedding-001` at 1536 dims for embeddings.
Both pinned explicitly in `lib/ai/models.ts`; no `-latest` aliases.

**Why, with the numbers** (measured on the real key, Phase 0):

| Chat candidate | Result |
|---|---|
| `gemini-2.5-flash` | **Rejected by the API**: "no longer available to new users" |
| `gemini-3.7-flash` | Failed after 3 retries: "currently experiencing" issues |
| `gemini-3.5-flash` | Worked, but 23,053 ms |
| **`gemini-3.6-flash`** | **Worked, 4,931 ms** |

| Embedding candidate | Margin (true match − best distractor) | Latency | Raw L2 norm |
|---|---|---|---|
| **`gemini-embedding-001`** | **0.1545** | **1,331 ms** | 0.699 |
| `gemini-embedding-2` | 0.1226 | 2,953 ms | 1.000 |

`gemini-2.5-flash` is the trap: it is still returned by the `models` list endpoint, so
"I checked it exists" is not evidence it works. Only an actual call reveals the rejection.

Aliases like `gemini-flash-latest` are avoided deliberately — this submission is reviewed days
after it is sent, and an alias that rolls forward could break the live demo with no commit in
between.

**Note for whoever swaps models later:** `gemini-embedding-001` returns vectors with an L2
norm of ~0.70 at 1536 dims, while `gemini-embedding-2` returns unit vectors. Code that
happens to work without normalisation on one silently degrades on the other. `lib/rag/embed.ts`
normalises unconditionally.

**Cost:** a pinned model eventually goes stale — exactly what happened to `gemini-2.5-flash`.
Mitigated by `npm run verify:provider`, which fails loudly and names the problem.

---

## D12 — No absolute similarity threshold; rank-based fusion only

**Decision:** retrieval ranks by fused position (RRF) and never filters on an absolute cosine
score.

**Why:** measured on the real embeddings, similarity has a **high floor**. In a
retrieval-shaped probe the true match scored 0.8932 while *unrelated passages from the same
document* scored 0.7386, 0.7220 and 0.7032. In the simpler paraphrase test, two completely
unrelated sentences still scored 0.5355.

The widely-copied Drizzle pgvector example filters with `gt(similarity, 0.5)`. Against these
embeddings that predicate matches **everything** — it looks like a relevance filter, reports
no error, and silently does nothing. A tighter guess like `0.8` would be worse: it would
discard correct matches on documents whose language differs from the query's.

What is stable is the *ordering*, and the *margin* between the top hit and the rest — 0.15
here — not the absolute value. RRF consumes only ranks, so it is immune to the floor moving
when the embedding model or document domain changes.

**Rejected:**
- *Fixed score threshold* — meaningless without calibrating per model and per corpus, and
  fails invisibly when wrong.
- *Percentile / relative threshold* — defensible, but adds a tuning knob for no gain when the
  top-k is already capped at 8.

**Cost:** genuinely irrelevant chunks can still enter the context when a document has nothing
on topic. Handled at the prompt layer instead: the system prompt requires the model to say the
document does not cover the question, which is a semantic judgement rather than an arithmetic
one — and it is QA row 6, tested explicitly.
