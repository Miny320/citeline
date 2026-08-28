'use client';

import Link from 'next/link';
import { useState } from 'react';

export interface SidebarChat {
  id: string;
  title: string | null;
  updatedAt: string;
}

/**
 * Conversation list.
 *
 * Grouped by recency rather than shown as a flat list, because "which conversation was that"
 * is a time-based question far more often than an alphabetical one.
 */
export function Sidebar({ chats, currentId }: { chats: SidebarChat[]; currentId: string }) {
  const [open, setOpen] = useState(false);
  const groups = groupByRecency(chats);

  return (
    <>
      {/* Mobile trigger. Fixed rather than in flow, so it overlays the header instead of
          becoming a column in the top-level layout row. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open conversations"
        className="fixed top-2.5 left-3 z-20 flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-muted hover:text-foreground lg:hidden"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
          <path d="M2 4h12M2 8h12M2 12h12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <button
          type="button"
          aria-label="Close conversations"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/25 lg:hidden"
        />
      ) : null}

      <nav
        aria-label="Conversations"
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-border bg-surface transition-transform lg:static lg:z-auto lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-foreground no-underline">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[0.7rem] font-bold text-accent-foreground">
              C
            </span>
            Citeline
          </Link>
        </div>

        <div className="px-3 pb-3">
          <Link
            href="/"
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[0.8rem] font-medium text-foreground no-underline transition-colors hover:border-border-strong hover:bg-surface-muted"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
              <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            New conversation
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {chats.length === 0 ? (
            <p className="px-2 py-3 text-[0.78rem] text-subtle">No conversations yet.</p>
          ) : (
            groups.map(({ label, items }) => (
              <section key={label} className="mb-3">
                <h2 className="px-2 py-1 text-[0.65rem] font-medium tracking-wide text-subtle uppercase">
                  {label}
                </h2>
                <ul className="m-0 list-none p-0">
                  {items.map((chat) => {
                    const isCurrent = chat.id === currentId;
                    return (
                      <li key={chat.id}>
                        <Link
                          href={`/chat/${chat.id}`}
                          aria-current={isCurrent ? 'page' : undefined}
                          onClick={() => setOpen(false)}
                          className={`block truncate rounded-md px-2 py-1.5 text-[0.8rem] no-underline transition-colors ${
                            isCurrent
                              ? 'bg-accent-soft font-medium text-accent'
                              : 'text-muted hover:bg-surface-muted hover:text-foreground'
                          }`}
                        >
                          {chat.title ?? 'New conversation'}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </nav>
    </>
  );
}

function groupByRecency(chats: SidebarChat[]) {
  const now = Date.now();
  const day = 86_400_000;
  const buckets: Record<string, SidebarChat[]> = { Today: [], 'Previous 7 days': [], Earlier: [] };

  for (const chat of chats) {
    const age = now - new Date(chat.updatedAt).getTime();
    const key = age < day ? 'Today' : age < 7 * day ? 'Previous 7 days' : 'Earlier';
    buckets[key]?.push(chat);
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}
