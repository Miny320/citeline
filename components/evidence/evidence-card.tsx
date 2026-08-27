'use client';

import { useState } from 'react';

import type { Confidence, EvidenceClaim } from '@/lib/rag/tools';

const CONFIDENCE_STYLES: Record<Confidence, { label: string; className: string }> = {
  high: { label: 'Stated directly', className: 'bg-accent-soft text-accent' },
  medium: { label: 'Implied', className: 'bg-warning-soft text-warning' },
  low: { label: 'Partial support', className: 'bg-surface-muted text-muted' },
};

/**
 * One claim with the passages that support it.
 *
 * Collapsed it reads as a summary; expanded it shows the verbatim excerpts, so a reader can
 * check the answer against the document without leaving the conversation. The excerpts come
 * from the database, never from model output.
 */
export function EvidenceCard({ claim, defaultOpen = false }: { claim: EvidenceClaim; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const confidence = CONFIDENCE_STYLES[claim.confidence];
  const hasCitations = claim.citations.length > 0;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-surface-muted"
      >
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={`mt-1 h-3 w-3 shrink-0 text-subtle transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-snug text-foreground">{claim.claim}</span>

          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[0.68rem] font-medium ${confidence.className}`}>
              {confidence.label}
            </span>

            {hasCitations ? (
              claim.citations.map((citation) => (
                <span
                  key={citation.chunkId}
                  className="rounded bg-surface-muted px-1.5 py-0.5 text-[0.68rem] text-muted"
                >
                  {citation.filename}
                  {citation.locator ? ` · ${citation.locator}` : ''}
                </span>
              ))
            ) : (
              // Never render an empty card silently: a claim whose citations all failed to
              // resolve is a real signal, not something to hide.
              <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[0.68rem] text-danger">
                No matching source
              </span>
            )}
          </span>
        </span>
      </button>

      {open && hasCitations ? (
        <div className="space-y-3 border-t border-border bg-surface-muted/60 p-3">
          {claim.citations.map((citation) => (
            <figure key={citation.chunkId} className="m-0">
              <figcaption className="mb-1 flex items-baseline justify-between gap-3 text-[0.7rem] text-subtle">
                <span className="font-medium text-muted">{citation.filename}</span>
                {citation.locator ? <span className="shrink-0">{citation.locator}</span> : null}
              </figcaption>
              <blockquote className="m-0 border-l-2 border-accent pl-2.5 text-[0.8rem] leading-relaxed whitespace-pre-wrap text-foreground">
                {citation.excerpt}
              </blockquote>
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function EvidenceCards({ claims }: { claims: EvidenceClaim[] }) {
  if (claims.length === 0) return null;

  return (
    <section aria-label="Supporting evidence" className="mt-3 space-y-2">
      <h3 className="text-[0.7rem] font-medium tracking-wide text-subtle uppercase">
        Evidence
      </h3>
      {claims.map((claim, index) => (
        <EvidenceCard key={`${index}-${claim.claim.slice(0, 24)}`} claim={claim} defaultOpen={claims.length === 1} />
      ))}
    </section>
  );
}
