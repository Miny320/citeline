import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createChat, listChats } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

async function startChat() {
  'use server';
  const id = await createChat();
  redirect(`/chat/${id}`);
}

export default async function HomePage() {
  const chats = await listChats(20);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <div className="mb-8 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-[0.85rem] font-bold text-accent-foreground">
          C
        </span>
        <span className="text-base font-semibold text-foreground">Citeline</span>
      </div>

      <h1 className="m-0 text-2xl leading-tight font-medium tracking-tight text-foreground">
        Chat with your documents,
        <br />
        <span className="text-muted">with citations you can actually check.</span>
      </h1>

      <p className="mt-4 max-w-md text-[0.88rem] leading-relaxed text-muted">
        Upload a PDF, TXT or Markdown file and ask questions about it. Every factual claim links
        back to the page or section it came from — and the quoted excerpt is read straight from
        the stored document, so it always matches the source.
      </p>

      <form action={startChat} className="mt-7">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[0.85rem] font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          New conversation
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
            <path
              d="M3 8h10M9 4l4 4-4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>

      <section className="mt-12 border-t border-border pt-6">
        <h2 className="m-0 text-[0.68rem] font-medium tracking-wide text-subtle uppercase">
          Recent conversations
        </h2>

        {chats.length === 0 ? (
          <p className="mt-3 text-[0.83rem] text-subtle">
            None yet. Start one above and attach a document.
          </p>
        ) : (
          <ul className="mt-2 list-none space-y-0.5 p-0">
            {chats.map((chat) => (
              <li key={chat.id}>
                <Link
                  href={`/chat/${chat.id}`}
                  className="flex items-baseline justify-between gap-4 rounded-lg px-3 py-2 text-[0.85rem] text-foreground no-underline transition-colors hover:bg-surface-muted"
                >
                  <span className="truncate">{chat.title ?? 'New conversation'}</span>
                  {/* ISO date rather than a locale format: the server and the browser can
                      disagree on locale, which shows up as a hydration mismatch. */}
                  <time
                    dateTime={chat.updatedAt.toISOString()}
                    className="shrink-0 font-mono text-[0.7rem] text-subtle"
                  >
                    {chat.updatedAt.toISOString().slice(0, 10)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
