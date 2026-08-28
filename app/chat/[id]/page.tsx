import { validateUIMessages } from 'ai';
import { notFound } from 'next/navigation';

import { Chat } from '@/components/chat/chat';
import type { ChatMessage, ClientDocument } from '@/lib/chat-types';
import { countChunks, getChat, getMessages, listChats, listDocuments } from '@/lib/db/queries';
import { buildTools } from '@/lib/rag/tools';

export const dynamic = 'force-dynamic';

/** Title the browser tab with the conversation, so several open tabs stay distinguishable. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chat = await getChat(id).catch(() => null);
  return { title: chat?.title ?? 'Conversation' };
}

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const chat = await getChat(id);
  if (!chat) notFound();

  const [rows, documents, chats] = await Promise.all([
    getMessages(id),
    listDocuments(id),
    listChats(50),
  ]);

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
    <div className="flex h-dvh overflow-hidden">
      <Chat
        chatId={id}
        chatTitle={chat.title}
        chats={chats.map((row) => ({
          id: row.id,
          title: row.title,
          updatedAt: row.updatedAt.toISOString(),
        }))}
        initialMessages={messages}
        initialDocuments={clientDocuments}
      />
    </div>
  );
}
