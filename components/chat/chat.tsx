'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Composer, type UploadState } from './composer';
import { DocumentBar } from './document-bar';
import { MessageView } from './message';
import { Sidebar, type SidebarChat } from './sidebar';
import { SourcePanel } from '@/components/source-panel';
import { NoDocumentState, NoMessagesState } from '@/components/states/empty-state';
import { isApiErrorBody, type ChatMessage, type ClientDocument } from '@/lib/chat-types';
import type { Citation } from '@/lib/rag/types';

interface ChatProps {
  chatId: string;
  chatTitle: string | null;
  chats: SidebarChat[];
  initialMessages: ChatMessage[];
  initialDocuments: ClientDocument[];
}

export function Chat({ chatId, chatTitle, chats, initialMessages, initialDocuments }: ChatProps) {
  const [documents, setDocuments] = useState<ClientDocument[]>(initialDocuments);
  const [upload, setUpload] = useState<UploadState>({ status: 'idle' });
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error, clearError, stop } = useChat<ChatMessage>({
    id: chatId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: '/api/chat', body: { chatId } }),
  });

  const busy = status === 'submitted' || status === 'streaming';
  const ready = documents.filter((document) => document.status === 'ready');
  const processing = documents.some((document) => document.status === 'processing');

  const refreshDocuments = useCallback(async () => {
    try {
      const response = await fetch(`/api/documents?chatId=${chatId}`);
      if (!response.ok) return;
      const body: { documents: ClientDocument[] } = await response.json();
      setDocuments(body.documents);
    } catch {
      // A failed refresh is not worth surfacing: the next poll or upload corrects it.
    }
  }, [chatId]);

  // Only poll while something is actually processing. A document can be left in that state if
  // the ingest function died mid-run, and a reload should still converge.
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(refreshDocuments, 1500);
    return () => clearInterval(timer);
  }, [processing, refreshDocuments]);

  // Follow the stream, but only when the reader is already near the bottom — yanking the view
  // away from someone reading an earlier answer is worse than not auto-scrolling.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distance < 240) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  /** All passages for the answer the active citation belongs to, for the panel's footer. */
  const siblingsOf = useCallback(
    (citation: Citation): Citation[] => {
      for (const message of messages) {
        const sources = message.parts.flatMap((part) =>
          part.type === 'data-sources' ? part.data : [],
        );
        if (sources.some((source) => source.chunkId === citation.chunkId)) return sources;
      }
      return [citation];
    },
    [messages],
  );

  const handleUpload = useCallback(
    async (file: File) => {
      setUpload({ status: 'uploading', filename: file.name });

      try {
        const form = new FormData();
        form.append('file', file);
        form.append('chatId', chatId);

        const response = await fetch('/api/documents', { method: 'POST', body: form });
        const body: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          const message = isApiErrorBody(body)
            ? body.error.message
            : 'That upload failed. Please try again.';
          setUpload({ status: 'failed', filename: file.name, error: message });
          // Refresh anyway: the server records the failure on the document row, so the reason
          // stays visible after a reload rather than living only in this banner.
          await refreshDocuments();
          return;
        }

        setUpload({ status: 'idle' });
        await refreshDocuments();
      } catch {
        setUpload({
          status: 'failed',
          filename: file.name,
          error: 'Could not reach the server. Check your connection and try again.',
        });
      }
    },
    [chatId, refreshDocuments],
  );

  const showNoDocument = documents.length === 0 && messages.length === 0;
  const showNoMessages = ready.length > 0 && messages.length === 0;

  return (
    <>
      <Sidebar chats={chats} currentId={chatId} />

      <main className="flex min-w-0 flex-1 flex-col">
        <DocumentBar documents={documents} title={chatTitle} />

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[46rem] space-y-6 px-4 py-6">
            {showNoDocument ? <NoDocumentState /> : null}
            {showNoMessages ? (
              <NoMessagesState filename={ready[0]?.filename ?? 'Your document'} />
            ) : null}

            {messages.map((message, index) => (
              <MessageView
                key={message.id}
                message={message}
                isStreaming={busy && index === messages.length - 1}
                onCitationClick={setActiveCitation}
              />
            ))}

            {status === 'submitted' ? (
              <p className="flex items-center gap-2 text-[0.8rem] text-subtle">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
                Searching the document…
              </p>
            ) : null}

            {error ? (
              <div
                role="alert"
                className="rounded-lg bg-danger-soft px-3 py-2.5 text-[0.82rem] text-danger"
              >
                Something went wrong generating that answer.{' '}
                <button
                  type="button"
                  onClick={clearError}
                  className="underline underline-offset-2 hover:no-underline"
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            <div ref={bottomRef} />
          </div>
        </div>

        <Composer
          onSend={(text) => sendMessage({ text })}
          onUpload={handleUpload}
          onStop={stop}
          disabled={busy}
          busy={busy}
          upload={upload}
          hasDocument={ready.length > 0}
        />
      </main>

      <SourcePanel
        active={activeCitation}
        siblings={activeCitation ? siblingsOf(activeCitation) : []}
        onSelect={setActiveCitation}
        onClose={() => setActiveCitation(null)}
      />
    </>
  );
}
