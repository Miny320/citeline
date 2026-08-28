# 05 — Worklog

Filled in **as the build happens**, not reconstructed afterwards. This is the source for the
"time spent", "AI tools used", and "an example where you corrected or rejected AI output"
sections of the final README.

## Time log

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
| 7 — UI redesign (requested after review) | — | 0:50 |
| **Total** | **5:00** | **~6:30** |

Over the five-hour box by about forty minutes. Recording the real figure rather than the
budgeted one. The overrun was mostly Phase 0 and 2: verifying the provider surfaced a dead
model id that had to be re-selected by measurement, and the ingestion phase absorbed the
pdf.js buffer-detachment bug plus writing the PDF fixture generator.

### Deviation from the plan (Phase 0 → 1 overlap)

`npm install` for Next 16 ran for several minutes of dead time, so the schema, query layer and
migration were written during that wait. Phases 0 and 1 are interleaved rather than
sequential. No gates were skipped, only reordered.

### Gate status — all passed

| Gate | Status |
|---|---|
| **0** — deployed URL healthy from Neon | ✅ `{"ok":true,"db":1,"pgvector":true,"latencyMs":89}` |
| **1** — schema live, index types correct | ✅ pgvector 0.8.6, hnsw + gin confirmed |
| **2** — real PDF ingests with correct pages | ✅ 5 pages → 5 chunks in 2.5s on Vercel |
| **3** — ask → stream → reload → intact | ✅ full history server-rendered from Neon |
| **4** — citations resolve to real rows, survive reload | ✅ excerpts + evidence cards restored |
| **5** — QA rows pass on the deployed URL | ✅ see below |
| **6** — a stranger can clone and run from the README | ✅ README complete |

### Production QA results (https://citeline-henna.vercel.app)

| Check | Result |
|---|---|
| Refund question → cites p.2 | ✅ correct page |
| `ERR_2043` (exact token, lexical arm) → cites p.5 | ✅ correct page |
| Paraphrased onboarding question → cites p.4 | ✅ correct page |
| **Out-of-scope question ("capital of Peru")** | ✅ *"The document doesn't cover that."* — no citation, no tool call, no invention |
| Hard reload restores conversation | ✅ text, citation excerpts and evidence cards all present |
| Scanned / image-only PDF | ✅ 422 `NO_EXTRACTABLE_TEXT` |
| 4.4 MB upload | ✅ 413 `FILE_TOO_LARGE` with our message, not Vercel's opaque error |
| `.docx` upload | ✅ 415 `UNSUPPORTED_TYPE` |
| Unknown chat id | ✅ 404 `CHAT_NOT_FOUND` |
| Failed ingest persists its reason | ✅ survives reload, zero partial chunks |

### Two things worth noting from deployment

**The region pin paid for itself.** `SELECT 1` against Neon took **1,821ms locally** and
**89ms from the deployed function** — functions are pinned to `cle1` (Ohio) to sit in the
same region as the Neon database rather than the `iad1` (Virginia) default. The HTTP driver
makes one round-trip per query, so a cross-region hop compounds across a request.

**Deployment protection was on by default.** The first live health check returned `302
Redirecting…` — Vercel enables SSO protection on new projects, which would have made the
submitted URL unopenable for a reviewer. Disabled via the API. This is the kind of thing that
looks like a working deployment right up until someone else clicks the link.

**The geo restriction was environmental, as predicted.** Gemini calls that failed locally with
`FAILED_PRECONDITION: User location is not supported` (egress via an OVH datacenter VPN in GB)
work from Vercel's US East egress with no code change.

## State

Complete and deployed. One demo conversation is left in the database so a reviewer landing on
the live URL sees a working example immediately; "New conversation" shows the empty state.

## AI tools used

| Tool | Used for |
|---|---|
| Claude Code (Opus 5) | Planning, live-doc verification, scaffolding, schema + query layer, review |

## AI output corrected or rejected

The brief asks for one concrete example. Logging every instance; the strongest goes in the
README. The best examples are **silent** errors — ones that would have shipped looking fine.

---

### C1 — AI SDK v7 route handler API (caught during planning, before writing code)

**What AI produced (and what nearly every tutorial still shows):**

```ts
const result = streamText({ model, messages });
return result.toUIMessageStreamResponse();
```

**Why it was rejected:** this is the AI SDK **v5** shape. The installed version is `ai@7.0.83`.
I verified the current pattern against the live AI SDK docs rather than trusting the
generated code:

```ts
return createUIMessageStreamResponse({
  stream: toUIMessageStream({
    stream: result.stream,
    originalMessages: messages,
    onEnd: ({ messages }) => saveChat({ chatId, messages }),
  }),
});
```

**Why it mattered:** beyond the API being wrong, the v5 shape has no obvious hook for
persistence. Following it would have pushed message saving into the client — where an
interrupted stream or a closed tab loses the assistant's reply, quietly failing R6 (survive a
reload). The v7 `onEnd` callback puts persistence on the server where it belongs. The root
cause generalises: **models are confidently fluent about fast-moving SDKs at whatever version
dominated their training data.** For `ai`, `next` and `zod` — all of which shipped majors
recently — every generated snippet in this build is checked against live docs first.

*Corroborated during Phase 0:* Next.js 16 now ships its own `AGENTS.md` opening with "This is
NOT the Next.js you know — this version has breaking changes… read the bundled docs before
writing any code." The framework authors are warning about precisely this failure mode.

---

### C2 — `drizzle-kit generate` silently omits `CREATE EXTENSION vector`

**What the tool produced:** a migration whose first statement is `CREATE TABLE "chats"`, with
`"embedding" vector(1536) NOT NULL` inside `chunks` — and no extension statement anywhere.

**Why it was corrected:** on a fresh Neon database the `vector` type does not exist until the
extension is created, so this migration fails at the `chunks` table. Prepended by hand:

```sql
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
```

**Why it mattered:** it fails *only* on a cold database. Anyone whose local database already
had the extension would see it pass, commit it, and hit the failure on the reviewer's machine
or on first deploy — the worst possible time. The hand-edit is also fragile: regenerating the
migration drops it again, so the reason is written into the file as a comment rather than
trusted to memory.

---

### C3 — `create-next-app`'s `.gitignore` excludes `.env.example`

**What the tool produced:** `.env*` in `.gitignore`.

**Why it was corrected:** that glob matches `.env.example` too. The file would have existed
locally, looked committed, and been absent from the clone — leaving a reviewer with no
indication of which environment variables the app needs. Added `!.env.example`.

**Why it mattered:** it is invisible locally and only shows up for someone cloning fresh,
which is exactly what a reviewer does. Small, but it fails the "setup" section of the README
by omission.

---

### C4 — A model id straight from training data was already dead

**What AI produced:** `model: google('gemini-2.5-flash')` — a reasonable, very commonly cited
Gemini model id.

**What happened when it actually ran:**

```
FAIL  This model models/gemini-2.5-flash is no longer available to new users.
      Please update your code to use models/gemini-3.6-flash
```

**Why it mattered:** the subtle part is that `gemini-2.5-flash` **is still returned by the
models list endpoint**. Asking "does this model exist?" returns yes. Only a real inference
call reveals that new API keys are refused. Any verification short of genuinely calling it
would have passed — and the failure would then have surfaced on the reviewer's key, not mine.

Testing the alternatives rather than trusting the error message's suggestion was also worth
it: `gemini-3.7-flash` was unavailable ("currently experiencing" issues) and
`gemini-3.5-flash` took 23s against 4.9s for `gemini-3.6-flash`. Measured, not assumed — the
numbers are in docs/04 D11.

---

### C5 — Rejected the similarity threshold that every pgvector tutorial uses

**What the canonical Drizzle pgvector example does** — and what AI reproduces from it:

```ts
const similarity = sql`1 - (${cosineDistance(guides.embedding, embedding)})`;
// ...
.where(gt(similarity, 0.5))   // "only keep relevant matches"
```

**Why it was rejected:** I measured what these embeddings actually score. In a
retrieval-shaped probe the correct passage scored **0.8932** — and three *unrelated* passages
from the same document scored **0.7386**, **0.7220** and **0.7032**. Two entirely unrelated
sentences still scored **0.5355**.

So `gt(similarity, 0.5)` matches **everything**. It reads like a relevance filter, raises no
error, returns plausible-looking results, and does nothing whatsoever.

**Why it mattered:** this is the most dangerous class of bug in the build — syntactically
fine, semantically inert, and invisible. Tightening the number would not rescue it either:
0.8 would start discarding correct matches whenever a document's phrasing differs from the
question's. The absolute scores are not stable across models or corpora; only the *ordering*
and the *margin* (0.15 here) are. So retrieval ranks by fused position (RRF) and never
thresholds on a raw score — docs/04 D12.

**Strongest README candidate.** Rejecting this required measuring rather than reasoning, and
the wrong version would have shipped looking entirely correct.

---

### C6 — `unpdf`/pdf.js silently destroys the buffer you hand it

**What the documented usage looks like** — and what AI reproduces verbatim:

```ts
const { totalPages, text } = await extractText(bytes, { mergePages: false });
```

**What actually happens:** pdf.js **transfers** the underlying `ArrayBuffer` to its worker,
which *detaches* the caller's view. The first call succeeds. Any later read of the same
`Uint8Array` throws:

```
PARSE_FAILED: Cannot transfer object of unsupported type.
```

**How it was caught:** not by reading the code — by writing tests that parse the same fixture
more than once. Test 1 passed, tests 2 and 3 failed with an error that pointed at a
"corrupted PDF" rather than at buffer ownership. The fixture was fine; the first call had
eaten it.

**The fix**, in `lib/rag/parse.ts` — hand pdf.js a copy so parsing never destroys the
caller's data:

```ts
const owned = new Uint8Array(bytes);
const result = await extractText(owned, { mergePages: false });
```

**Why it mattered:** in the ingest route each request has its own buffer, so this would
*probably* never have fired in production — which is exactly what makes it dangerous. Any
later change that touched the bytes after parsing (hashing for deduplication, retrying a
failed parse, storing the original) would have hit a silently emptied buffer, and the error
message points at the file rather than the cause. It also mis-reports as `PARSE_FAILED`,
so the user would have been told their document was corrupt when it was not.

The general lesson, which is really the same one as C5: the bug was invisible to reading and
only appeared under a test that used the code *twice*.

---

### C7 — The renderer I generated handled text and citations, but not markdown

**What I built:** a message renderer that split assistant text on `[n]` markers and rendered
citation chips. It typechecked, it passed its tests, and it looked correct in review.

**What was actually on screen**, read out of the deployed page's DOM:

```
`ERR_2043` indicates that the uploaded file exceeded the maximum permitted size
Enterprise customers may request a full refund within **45 days** of the invoice date
```

Gemini emits markdown. Nothing in the pipeline rendered it, so users saw literal backticks
and asterisks in every answer.

**Why it was missed:** the tests asserted that citations resolved to the right chunks — which
they did. Nothing asserted anything about *how the answer reads*. The unit tests, the
typechecker and the linter were all satisfied by output that was visibly wrong to any human
who opened the page.

**How it was caught:** by fetching the deployed page and grepping the rendered DOM for
markdown syntax, rather than trusting that "the chat works" meant "the chat looks right".

**The fix:** a small purpose-written markdown renderer. A general library was the obvious
choice and was rejected: `[n]` markers must interleave with inline formatting *and* become
interactive components, while `[label](url)` links must still work. Every library would either
escape the markers or force a second parse over its output to find them. 15 tests now cover
both halves — including that a link is never mistaken for a citation, and that an unmatched
marker stays plain text rather than becoming a dead chip.

**Why it mattered:** this is the same failure mode as C5, from the other direction. C5 was
code that looked right and behaved wrong; this was code that behaved right and *looked*
wrong. Both were invisible to every automated check in the project. The general lesson is that
"tests pass" and "typecheck clean" say nothing about what a user actually sees, and the only
cure is to go and look at the real rendered output.

---

### C8 — _(next entry)_

## Cut list (anything not finished, for honest disclosure in the README)

| Item | Status | Reason |
|---|---|---|
| `compareItems` comparison-table tool | Pre-declared stretch | Only if budget allows after Phase 5 |
| _(add cuts as they happen)_ | | |

## Surprises and notes

- Planning-phase checks found three constraints that would each have caused a silent failure
  or a late rewrite: the 4.5 MB Vercel body cap, pgvector's 2000-dim HNSW ceiling versus
  Gemini's 3072-dim default, and the v7 route-handler change.
- Two of the three correction entries so far (C2, C3) are **tooling** defaults rather than
  model output — and both fail only on a fresh clone or cold database. Worth noting in the
  README: "verify AI output" and "verify generated scaffolding" are the same discipline.
- `npm run check` passing against the real installed versions confirmed the spec in docs/06
  was written correctly — the schema, query layer and health route compiled first time with
  no type errors.
