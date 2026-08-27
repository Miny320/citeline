const SUGGESTIONS = [
  'What are the refund terms?',
  'Summarise the support commitments.',
  'What does ERR_2043 mean?',
];

/** Shown before a document is attached: says what to do, not just that nothing is here. */
export function NoDocumentState() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 text-accent">
          <path
            d="M14 3v5h5M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM9 13h6M9 17h4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h2 className="m-0 text-base font-medium text-foreground">Attach a document to begin</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
        Use the paperclip below to add a PDF, TXT or Markdown file. Answers are drawn only from
        what you upload, and every factual claim links back to the passage it came from.
      </p>
    </div>
  );
}

/** Shown once a document is ready but the conversation has not started. */
export function NoMessagesState({ filename }: { filename: string }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h2 className="m-0 text-base font-medium text-foreground">Ready to answer</h2>
      <p className="mt-2 text-sm text-muted">
        <span className="text-foreground">{filename}</span> is indexed. Ask anything about it.
      </p>

      <ul className="mt-4 flex list-none flex-col items-center gap-1.5 p-0">
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion} className="text-[0.8rem] text-subtle">
            &ldquo;{suggestion}&rdquo;
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Neon's free plan suspends after five minutes idle, so a cold load is genuinely slow. */
export function ChatSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8" aria-label="Loading conversation">
      <div className="flex justify-end">
        <div className="h-9 w-52 animate-pulse-soft rounded-2xl bg-surface-muted" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse-soft rounded bg-surface-muted" />
        <div className="h-4 w-11/12 animate-pulse-soft rounded bg-surface-muted" />
        <div className="h-4 w-3/5 animate-pulse-soft rounded bg-surface-muted" />
      </div>
      <div className="h-16 w-full animate-pulse-soft rounded-lg bg-surface-muted" />
    </div>
  );
}
