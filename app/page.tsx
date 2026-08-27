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
    <main className="mx-auto w-full max-w-2xl px-5 py-16">
      <h1 className="m-0 text-xl font-medium text-foreground">Citeline</h1>
      <p className="mt-2 mb-8 text-sm leading-relaxed text-muted">
        Chat with your documents, with citations you can actually check. Upload a PDF, TXT or
        Markdown file and ask questions about it — every factual claim links back to the page
        or section it came from.
      </p>

      <form action={startChat}>
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          New conversation
        </button>
      </form>

      <section className="mt-10">
        <h2 className="m-0 text-[0.7rem] font-medium tracking-wide text-subtle uppercase">
          Recent
        </h2>

        {chats.length === 0 ? (
          <p className="mt-3 text-sm text-subtle">
            No conversations yet. Start one above and attach a document.
          </p>
        ) : (
          <ul className="mt-3 list-none space-y-1 p-0">
            {chats.map((chat) => (
              <li key={chat.id}>
                <Link
                  href={`/chat/${chat.id}`}
                  className="flex items-baseline justify-between gap-4 rounded-lg px-3 py-2 text-sm text-foreground no-underline transition-colors hover:bg-surface-muted"
                >
                  <span className="truncate">{chat.title ?? 'New conversation'}</span>
                  {/* ISO date rather than a locale format: the server and the browser can
                      disagree on locale, which shows up as a hydration mismatch. */}
                  <time
                    dateTime={chat.updatedAt.toISOString()}
                    className="shrink-0 text-[0.72rem] text-subtle"
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
