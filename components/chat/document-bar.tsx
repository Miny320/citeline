'use client';

import type { ClientDocument } from '@/lib/chat-types';

const KIND_LABEL: Record<ClientDocument['kind'], string> = {
  pdf: 'PDF',
  txt: 'TXT',
  md: 'MD',
};

/**
 * Conversation header: what this chat is about, and the state of its documents.
 *
 * A failed document keeps its reason here rather than only in a toast, so the explanation
 * survives a reload — the failure is a property of the document, not of the session.
 */
export function DocumentBar({
  documents,
  title,
}: {
  documents: ClientDocument[];
  title: string | null;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background py-2.5 pr-4 pl-14 lg:pl-4">
      <h1 className="m-0 min-w-0 flex-1 truncate text-[0.82rem] font-medium text-foreground">
        {title ?? 'New conversation'}
      </h1>

      <ul className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
        {documents.map((document) => (
          <li
            key={document.id}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1"
          >
            <span className="rounded bg-surface-muted px-1 py-0.5 text-[0.6rem] font-semibold tracking-wide text-muted">
              {KIND_LABEL[document.kind]}
            </span>

            <span className="max-w-[12rem] truncate text-[0.75rem] text-foreground">
              {document.filename}
            </span>

            {document.status === 'processing' ? (
              <span className="flex items-center gap-1 text-[0.68rem] text-muted">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
                Processing
              </span>
            ) : null}

            {document.status === 'ready' ? (
              <span className="text-[0.68rem] text-subtle">
                {document.pageCount ? `${document.pageCount}pp · ` : ''}
                {document.chunkCount} passages
              </span>
            ) : null}

            {document.status === 'failed' ? (
              <span
                title={document.error ?? undefined}
                className="max-w-[14rem] truncate rounded bg-danger-soft px-1.5 py-0.5 text-[0.68rem] text-danger"
              >
                {document.error ?? 'Failed'}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </header>
  );
}
