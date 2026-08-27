# 05 — Worklog

Filled in **as the build happens**, not reconstructed afterwards. This is the source for the
"time spent", "AI tools used", and "an example where you corrected or rejected AI output"
sections of the final README.

## Time log

| Phase | Budget | Actual | Notes |
|---|---|---|---|
| Planning + stack verification | — | 0:20 | docs/ folder; version, platform-limit and free-tier checks |
| Implementation spec | — | 0:15 | docs/06 + 07, after review that the plan was not yet buildable |
| 0 — Skeleton and deploy path | 0:30 | 0:50 | Scaffold, deps, health route, provider verification |
| 1 — Schema and data layer | 0:45 | 0:35 | ✅ **Gate 1 passed** — schema live in Neon, index types verified |
| 2 — Ingestion pipeline | 1:00 | 1:05 | parse/chunk/embed, routes, 18 tests, PDF fixture |
| 3 — Chat, retrieval, persistence | 1:00 | 0:50 | Hybrid RRF retrieval, grounded prompt, chat route, UI |
| 4 — Citations and evidence cards | 0:45 | 0:40 | Chips, cards, `data-sources` part, 13 more tests |
| 5 — States and hardening | 0:30 | 0:15 (partial) | States built; full QA blocked on the provider |
| 6 — README and submission | 0:30 | | |
| **Total** | **5:00** | **4:50 so far** | |

### Deviation from the plan (Phase 0 → 1 overlap)

The plan sequenced Phase 1 strictly after Phase 0. In practice `npm install` for Next 16 ran
for several minutes of dead time, so the schema, query layer and migration were written during
that wait. Phases 0 and 1 are therefore interleaved rather than sequential.

No gates were skipped, only reordered. Recording it because the alternative — quietly
presenting a reordered build as if it followed the plan — is exactly what the "clarity of
decisions" axis is looking for.

### Gate status

| Gate | Status |
|---|---|
| **0** — deployed URL returns healthy from Neon | 🟡 **Local half passed** (`{"ok":true,"db":1,"pgvector":true}`); Vercel deploy pending |
| **1** — schema live, index types correct | ✅ Passed |
| **2** — real PDF ingests with correct pages | 🟡 Parse + chunk verified in the live runtime and by tests; embedding blocked (see below) |
| **3** — ask → stream → reload → conversation intact | ⬜ Blocked on the provider |
| **4** — citations resolve to real rows, survive reload | 🟡 Logic tested (13 tests); live render blocked |
| **5** — all 15 QA rows pass on the deployed URL | ⬜ Blocked |
| **6** — a stranger can clone and run from the README | ⬜ Not started |

### 🔴 Current blocker: Gemini API geo restriction (environment, not code)

```
egress: GB / AS16276 OVH SAS   (VPN or proxy exit in a datacenter)
HTTP 400 FAILED_PRECONDITION — "User location is not supported for the API use."
```

Both chat and embedding calls passed earlier in the session and now fail, with no code change
in between: the connection began leaving through a datacenter VPN exit that Google refuses.

**Everything that does not call Google still works locally**, which is most of the pipeline:
PDF parsing, chunking, all four database tables, retrieval SQL, every route's validation and
error path, and all 31 tests.

**Expected to be unaffected in production.** Vercel functions run from AWS US East, a
supported location. To be confirmed at deploy — it is an assumption until then.

**To unblock local work:** switch the VPN to a US exit, or disable it.

## State at last update

**Verified working, live**
- `GET /api/health` → `{"ok":true,"db":1,"pgvector":true,"latencyMs":1821}`
  (that latency is the Neon free-plan cold start — the reason skeletons exist)
- `/` renders with its empty state; `/chat/<unknown-uuid>` correctly 404s
- `POST /api/documents` error paths, all with correct status codes and human-readable messages:
  `.docx` → 415 `UNSUPPORTED_TYPE`, empty file → 422 `EMPTY_DOCUMENT`,
  unknown chat → 404 `CHAT_NOT_FOUND`, provider down → 502 `EMBEDDING_FAILED`
- A failed ingest persists `status='failed'` **and its reason** on the document row, with
  zero partial chunks written — so the explanation survives a reload
- `unpdf` parses correctly inside the Next.js runtime (parse and chunk both completed before
  the embedding call failed), which retires the biggest Phase 2 risk
- `npm run build` succeeds; 31/31 tests, typecheck and lint all clean

**Written, not yet exercised end to end**
- Streaming answers, inline citation chips, evidence cards — all blocked behind the provider

**Next**
- Deploy to Vercel → closes Gate 0, and very likely unblocks the provider
- Pin the function region to `cle1` (Ohio) to co-locate with Neon's us-east-2
- Run the full QA script (docs/06 §13) against the deployed URL

### Environment note

Port 3000 was already in use by an unrelated project on this machine, so `next dev` moved to
**3001**. Worth recording because the first health check hit the *other* app and returned a
404 that looked like ours was broken.

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

### C7 — _(next entry)_

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
