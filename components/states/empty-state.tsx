const SUGGESTIONS = [
  'What are the refund terms?',
  'Summarise the support commitments.',
  'What does ERR_2043 mean?',
];

/** Shown before a document is attached: says what to do, not just that nothing is here. */
export function NoDocumentState() {
  return (
    <div className="mx-auto max-w-sm py-20 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft">
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

      <h2 className="m-0 text-[0.95rem] font-medium text-foreground">Attach a document to begin</h2>
      <p className="mx-auto mt-2 text-[0.83rem] leading-relaxed text-muted">
        Drop a PDF, TXT or Markdown file into the box below, or use the paperclip. Answers come
        only from what you upload, and every claim links back to the page it came from.
      </p>

      <ul className="mx-auto mt-5 flex max-w-[18rem] list-none flex-col gap-1.5 p-0 text-left">
        {[
          'Citations show the exact page or section',
          'Click any citation to read the source passage',
          'Out-of-scope questions get an honest "not covered"',
        ].map((item) => (
          <li key={item} className="flex items-start gap-2 text-[0.78rem] text-subtle">
            <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-[0.2rem] h-3 w-3 shrink-0 text-accent">
              <path
                d="M3 8.5l3.5 3.5L13 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shown once a document is ready but the conversation has not started. */
export function NoMessagesState({ filename }: { filename: string }) {
  return (
    <div className="mx-auto max-w-sm py-20 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft">
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 text-accent">
          <path
            d="M3 8.5l3.5 3.5L13 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h2 className="m-0 text-[0.95rem] font-medium text-foreground">Indexed and ready</h2>
      <p className="mt-1.5 text-[0.83rem] text-muted">
        <span className="text-foreground">{filename}</span> is searchable. Ask anything about it.
      </p>

      <ul className="mt-4 flex list-none flex-col items-center gap-1 p-0">
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion} className="text-[0.8rem] text-subtle italic">
            &ldquo;{suggestion}&rdquo;
          </li>
        ))}
      </ul>
    </div>
  );
}
