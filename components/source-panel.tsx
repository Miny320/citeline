'use client';

import { useEffect } from 'react';

import type { Citation } from '@/lib/rag/types';

interface SourcePanelProps {
  active: Citation | null;
  /** Every passage retrieved for the answer the active citation belongs to. */
  siblings: Citation[];
  onSelect: (citation: Citation) => void;
  onClose: () => void;
}

/**
 * The right-hand panel showing the passage behind a citation.
 *
 * This is the payoff of the citation design: because excerpts are resolved server-side from
 * the database rather than quoted by the model, what appears here is guaranteed to be the
 * document's own words. Being able to put it on screen next to the answer is the point.
 */
export function SourcePanel({ active, siblings, onSelect, onClose }: SourcePanelProps) {
  // Escape closes, matching the rest of the app's dismissal behaviour.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, onClose]);

  if (!active) return null;

  return (
    <>
      {/* Below lg the panel is an overlay sheet, so the conversation is never squeezed. */}
      <button
        type="button"
        aria-label="Close source"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/25 lg:hidden"
      />

      <aside
        aria-label="Source passage"
        className="fixed inset-y-0 right-0 z-40 flex w-[min(26rem,88vw)] flex-col border-l border-border bg-surface lg:static lg:z-auto lg:w-[24rem] lg:shrink-0"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="m-0 text-[0.68rem] font-medium tracking-wide text-subtle uppercase">
              Source
            </p>
            <p className="m-0 mt-1 truncate text-sm font-medium text-foreground">
              {active.filename}
            </p>
            {active.locator ? (
              <p className="m-0 mt-0.5 text-[0.75rem] text-muted">{active.locator}</p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close source panel"
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
              <path
                d="M4 4l8 8M12 4l-8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <blockquote className="m-0 border-l-2 border-accent pl-3 text-[0.82rem] leading-[1.7] whitespace-pre-wrap text-foreground">
            {active.excerpt}
          </blockquote>

          <p className="mt-4 text-[0.7rem] leading-relaxed text-subtle">
            Quoted verbatim from the stored document. Excerpts are read from the database, not
            generated, so they always match the source.
          </p>
        </div>

        {siblings.length > 1 ? (
          <div className="border-t border-border px-4 py-3">
            <p className="m-0 mb-2 text-[0.68rem] font-medium tracking-wide text-subtle uppercase">
              Other passages used ({siblings.length - 1})
            </p>
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {siblings
                .filter((citation) => citation.chunkId !== active.chunkId)
                .map((citation) => (
                  <li key={citation.chunkId}>
                    <button
                      type="button"
                      onClick={() => onSelect(citation)}
                      className="rounded border border-border px-2 py-1 text-[0.7rem] text-muted transition-colors hover:border-border-strong hover:text-foreground"
                    >
                      {citation.index}. {citation.locator ?? citation.filename}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </>
  );
}
