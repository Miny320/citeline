'use client';

import { useEffect, useRef, useState } from 'react';

import type { Citation } from '@/lib/rag/types';

interface CitationChipProps {
  citation: Citation;
}

/**
 * An inline `[n]` marker that opens the exact passage it refers to.
 *
 * The excerpt shown here came from Postgres, resolved server-side before streaming — it is
 * not model output, so it is guaranteed to be what the document actually says.
 */
export function CitationChip({ citation }: CitationChipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  // Dismiss on outside click or Escape, so an open citation never traps the reader.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const source = citation.locator
    ? `${citation.filename} · ${citation.locator}`
    : citation.filename;

  return (
    <span ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`Source ${citation.index}: ${source}`}
        title={source}
        className={`mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-[0.3rem] px-1 align-[0.1em] text-[0.7rem] font-medium tabular-nums transition-colors ${
          open
            ? 'bg-accent text-accent-foreground'
            : 'bg-accent-soft text-accent hover:bg-accent hover:text-accent-foreground'
        }`}
      >
        {citation.index}
      </button>

      {open ? (
        <span
          role="dialog"
          aria-label={`Excerpt from ${source}`}
          className="absolute bottom-full left-1/2 z-20 mb-2 block w-[min(28rem,calc(100vw-3rem))] -translate-x-1/2 rounded-lg border border-border-strong bg-surface p-3 text-left shadow-lg"
        >
          <span className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-[0.7rem] font-medium tracking-wide text-muted uppercase">
              {citation.filename}
            </span>
            {citation.locator ? (
              <span className="shrink-0 text-[0.7rem] text-subtle">{citation.locator}</span>
            ) : null}
          </span>
          <span className="block max-h-52 overflow-y-auto border-l-2 border-accent pl-2.5 text-[0.8rem] leading-relaxed whitespace-pre-wrap text-foreground">
            {citation.excerpt}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * Render assistant text, turning `[n]` markers into citation chips.
 *
 * A marker with no matching source is left as plain text rather than rendered as a dead
 * chip — the model can only cite within the retrieved set, so an unmatched number means
 * something went wrong and pretending otherwise would be worse than showing it.
 */
export function CitedText({ text, sources }: { text: string; sources: Citation[] }) {
  if (sources.length === 0) return <>{text}</>;

  // Built per call: a shared /g regex carries mutable lastIndex state, which is unsafe
  // across concurrent renders.
  const marker = /\[(\d{1,2})\]/g;
  const byIndex = new Map(sources.map((source) => [source.index, source]));
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = marker.exec(text)) !== null) {
    const citation = byIndex.get(Number(match[1]));
    if (!citation) continue;

    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    nodes.push(<CitationChip key={`${match.index}-${citation.index}`} citation={citation} />);
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}
