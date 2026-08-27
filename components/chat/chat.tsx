'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Composer, type UploadState } from './composer';
import { DocumentBar } from './document-bar';
import { MessageView } from './message';
import { NoDocumentState, NoMessagesState } from '@/components/states/empty-state';
import { isApiErrorBody, type ChatMessage, type ClientDocument } from '@/lib/chat-types';

interface ChatProps {
  chatId: string;
  initialMessages: ChatMessage[];
  initialDocuments: ClientDocument[];
}

export function Chat({ chatId, initialMessages, initialDocuments }: ChatProps) {
  const [documents, setDocuments] = useState<ClientDocument[]>(initialDocuments);
  const [upload, setUpload] = useState<UploadState>({ status: 'idle' });
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error, clearError } = useChat<ChatMessage>({
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
      // A failed refresh is not worth surfacing: the next poll or upload will correct it.
    }
  }, [chatId]);

  // Only poll while something is actually processing. A document can be left in that state
  // if the ingest function died mid-run, and a reload should still converge.
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(refreshDocuments, 1500);
    return () => clearInterval(timer);
  }, [processing, refreshDocuments]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

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
          // Refresh anyway: the server records the failure on the document row, so the
          // reason stays visible after a reload rather than living only in this banner.
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
    <div className="flex min-h-full flex-1 flex-col">
      <DocumentBar documents={documents} />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
          {showNoDocument ? <NoDocumentState /> : null}
          {showNoMessages ? <NoMessagesState filename={ready[0]?.filename ?? 'Your document'} /> : null}

          {messages.map((message, index) => (
            <MessageView
              key={message.id}
              message={message}
              isStreaming={status === 'streaming' && index === messages.length - 1}
            />
          ))}

          {status === 'submitted' ? (
            <p className="text-[0.8rem] text-subtle animate-pulse-soft">
              Searching the document…
            </p>
          ) : null}

          {error ? (
            <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-[0.85rem] text-danger">
              <p className="m-0">
                Something went wrong generating that answer.{' '}
                <button
                  type="button"
                  onClick={clearError}
                  className="underline underline-offset-2 hover:no-underline"
                >
                  Dismiss
                </button>
              </p>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </div>

      <Composer
        onSend={(text) => sendMessage({ text })}
        onUpload={handleUpload}
        disabled={busy}
        busy={busy}
        upload={upload}
        hasDocument={ready.length > 0}
      />
    </div>
  );
}
