'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Route-level error boundary.
 *
 * Shows what the user can do, not what went wrong internally. The real error goes to the
 * console for whoever is debugging; the page never renders a stack trace.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[route error]', error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-center px-5 py-24 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-danger-soft">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 text-danger">
          <path
            d="M12 8v5M12 16.5v.5M10.3 3.9L2.6 17.2A2 2 0 004.3 20h15.4a2 2 0 001.7-2.8L13.7 3.9a2 2 0 00-3.4 0z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h1 className="m-0 text-base font-medium text-foreground">Something went wrong</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        This page failed to load. Your conversations and documents are stored in the database,
        so nothing has been lost.
      </p>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-border px-4 py-2 text-sm text-foreground no-underline transition-colors hover:bg-surface-muted"
        >
          Back to conversations
        </Link>
      </div>

      {error.digest ? (
        <p className="mt-6 font-mono text-[0.7rem] text-subtle">Reference: {error.digest}</p>
      ) : null}
    </main>
  );
}
