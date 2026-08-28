'use client';

import type { Citation } from '@/lib/rag/types';

interface CitationChipProps {
  citation: Citation;
  /** Opens the source panel. When absent the chip is inert but still shows its source on hover. */
  onOpen?: (citation: Citation) => void;
  active?: boolean;
}

/**
 * An inline `[n]` marker that opens the exact passage it refers to.
 *
 * The excerpt it reveals came from Postgres, resolved server-side before streaming — it is
 * not model output, so it is guaranteed to be what the document actually says.
 */
export function CitationChip({ citation, onOpen, active = false }: CitationChipProps) {
  const source = citation.locator
    ? `${citation.filename} · ${citation.locator}`
    : citation.filename;

  return (
    <button
      type="button"
      onClick={() => onOpen?.(citation)}
      aria-label={`Source ${citation.index}: ${source}`}
      title={source}
      className={`mx-[0.1em] inline-flex h-[1.1rem] min-w-[1.1rem] translate-y-[-0.1em] items-center justify-center rounded-[0.3rem] px-[0.28rem] text-[0.66rem] font-semibold tabular-nums transition-colors ${
        active
          ? 'bg-accent text-accent-foreground'
          : 'bg-accent-soft text-accent hover:bg-accent hover:text-accent-foreground'
      }`}
    >
      {citation.index}
    </button>
  );
}

/** A source label used in evidence cards and the source panel header. */
export function SourcePill({ citation }: { citation: Citation }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-surface-muted px-1.5 py-0.5 text-[0.68rem] text-muted">
      <span className="font-medium">{citation.filename}</span>
      {citation.locator ? <span className="text-subtle">· {citation.locator}</span> : null}
    </span>
  );
}
