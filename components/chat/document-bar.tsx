'use client';

import type { ClientDocument } from '@/lib/chat-types';

const KIND_LABEL: Record<ClientDocument['kind'], string> = {
  pdf: 'PDF',
  txt: 'TXT',
  md: 'MD',
};

/**
 * The documents attached to this conversation, and the state of each.
 *
 * A failed document keeps its reason here rather than only in a toast, so the explanation
 * survives a reload — the failure is a property of the document, not of the session.
 */
export function DocumentBar({ documents }: { documents: ClientDocument[] }) {
  if (documents.length === 0) return null;

  return (
    <div className="border-b border-border bg-surface/80 backdrop-blur">
      <ul className="mx-auto flex w-full max-w-3xl list-none flex-wrap gap-2 px-4 py-2">
        {documents.map((document) => (
          <li
            key={document.id}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5"
          >
            <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[0.65rem] font-medium tracking-wide text-muted">
              {KIND_LABEL[document.kind]}
            </span>

            <span className="max-w-[16rem] truncate text-[0.8rem] text-foreground">
              {document.filename}
            </span>

            {document.status === 'processing' ? (
              <span className="flex items-center gap-1.5 text-[0.72rem] text-muted">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
                Processing
              </span>
            ) : null}

            {document.status === 'ready' ? (
              <span className="text-[0.72rem] text-subtle">
                {document.pageCount ? `${document.pageCount} pages · ` : ''}
                {document.chunkCount} passages
              </span>
            ) : null}

            {document.status === 'failed' ? (
              <span
                title={document.error ?? undefined}
                className="max-w-[18rem] truncate rounded bg-danger-soft px-1.5 py-0.5 text-[0.72rem] text-danger"
              >
                {document.error ?? 'Failed'}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
