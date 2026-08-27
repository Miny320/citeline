import { validateUIMessages } from 'ai';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { Chat } from '@/components/chat/chat';
import type { ChatMessage, ClientDocument } from '@/lib/chat-types';
import { countChunks, getChat, getMessages, listDocuments } from '@/lib/db/queries';
import { buildTools } from '@/lib/rag/tools';

export const dynamic = 'force-dynamic';

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const chat = await getChat(id);
  if (!chat) notFound();

  const [rows, documents] = await Promise.all([getMessages(id), listDocuments(id)]);

  // Validate persisted messages against the current tool definitions. Without this, a later
  // change to a tool's schema would crash the whole conversation on rows written before it;
  // instead the mismatched parts are dropped and the rest of the history still loads.
  let messages: ChatMessage[] = [];
  try {
    messages = (await validateUIMessages({
      messages: rows.map((row) => ({ id: row.id, role: row.role, parts: row.parts })),
      tools: buildTools([]),
    })) as ChatMessage[];
  } catch {
    messages = [];
  }

  const clientDocuments: ClientDocument[] = await Promise.all(
    documents.map(async (document) => ({
      id: document.id,
      filename: document.filename,
      kind: document.kind,
      status: document.status,
      pageCount: document.pageCount,
      error: document.error,
      chunkCount: document.status === 'ready' ? await countChunks(document.id) : 0,
    })),
  );

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-2.5">
          <Link href="/" className="text-sm font-medium text-foreground no-underline">
            Citeline
          </Link>
          <p className="m-0 max-w-[60%] truncate text-[0.8rem] text-muted">
            {chat.title ?? 'New conversation'}
          </p>
        </div>
      </header>

      <Chat chatId={id} initialMessages={messages} initialDocuments={clientDocuments} />
    </div>
  );
}
