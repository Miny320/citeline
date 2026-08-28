# Citeline — Kleo Take-Home

Planning documents for the "small document-chat application" take-home task.

These docs are written **before** any code, and are updated as the build progresses.
They exist so that every decision is deliberate and defensible in the follow-up live
coding session.

**Live:** https://citeline-henna.vercel.app · **Repo:** https://github.com/Miny320/citeline

## Index

| Doc | Purpose |
|---|---|
| [01-requirements.md](01-requirements.md) | The brief, decomposed into testable acceptance criteria, mapped to the stated assessment axes |
| [02-architecture.md](02-architecture.md) | Stack (version-verified), data flow, database schema, RAG + citation design, platform constraints |
| [03-development-plan.md](03-development-plan.md) | Phased build plan with a 5-hour budget, cut-lines, and definition of done |
| [04-decisions.md](04-decisions.md) | Decision log (ADR-style) — every trade-off with its rationale and rejected alternatives |
| [05-worklog.md](05-worklog.md) | Running log of time spent, AI tools used, and AI output corrected/rejected |
| [06-implementation-spec.md](06-implementation-spec.md) | The buildable detail: type contracts, Drizzle schema, chunking algorithm, retrieval SQL, system prompt, tool definition, API + error contracts, QA script |
| [07-task-checklist.md](07-task-checklist.md) | Granular per-phase tasks with exact commands and a gate before each next phase |

## How these fit together

```
01 requirements   -> what must be true
02 architecture   -> how the system is shaped
03 plan           -> when each part gets built, and what gets cut first
06 spec           -> exactly what to write
07 checklist      -> the order to write it in, with gates
04 decisions      -> why, captured as it happens   ] both feed the
05 worklog        -> what it cost, honestly        ] final README
```

Read **07** while building. Read **06** when writing a specific module. **04** and **05** are
appended to continuously — they are the raw material for the submission README, so
reconstructing them at the end would defeat the point.

## The one rule for this build

The brief says **five hours** and asks me to report time spent and document anything
unfinished. So the goal is not "build everything" — it is:

> Ship a narrow, genuinely reliable slice, make retrieval and citations excellent,
> and be explicit and honest about what was deliberately cut.

A padded 15-hour submission presented as five hours fails the "clarity of your
decisions" axis harder than any missing feature. Cut-lines are pre-declared in
[03-development-plan.md](03-development-plan.md) and outcomes recorded in
[05-worklog.md](05-worklog.md).
