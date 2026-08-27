'use client';

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES, formatBytes } from '@/lib/upload';

export interface UploadState {
  status: 'idle' | 'uploading' | 'failed';
  filename?: string;
  error?: string;
}

interface ComposerProps {
  onSend: (text: string) => void;
  onUpload: (file: File) => void;
  disabled: boolean;
  busy: boolean;
  upload: UploadState;
  hasDocument: boolean;
}

/**
 * The message input, with file upload attached.
 *
 * Upload lives in the composer rather than on a separate screen because the brief asks for
 * it "from inside the conversation" — attaching a document is part of the conversation, not
 * a detour out of it.
 */
export function Composer({ onSend, onUpload, disabled, busy, upload, hasDocument }: ComposerProps) {
  const [value, setValue] = useState('');
  const [sizeError, setSizeError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = value.trim();
    if (!text || disabled) return;
    setValue('');
    onSend(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter breaks the line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    setSizeError(null);

    // Check the size before uploading: the server enforces the same limit, but sending 40 MB
    // just to be told no is a poor use of the user's connection. Vercel would also reject the
    // body with an opaque 413 before our handler ever ran.
    if (file.size > MAX_UPLOAD_BYTES) {
      setSizeError(
        `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      );
      return;
    }

    onUpload(file);
  };

  const notice = sizeError ?? (upload.status === 'failed' ? upload.error : null);

  return (
    <div className="border-t border-border bg-surface/80 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-4 py-3">
        {notice ? (
          <p
            role="alert"
            className="mb-2 rounded-md bg-danger-soft px-3 py-2 text-[0.8rem] text-danger"
          >
            {notice}
          </p>
        ) : null}

        {upload.status === 'uploading' ? (
          <p className="mb-2 flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-[0.8rem] text-muted">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse-soft rounded-full bg-accent" />
            Reading {upload.filename}… extracting text, splitting it and building embeddings.
          </p>
        ) : null}

        <form onSubmit={submit} className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            onChange={(event) => {
              pickFile(event.target.files?.[0]);
              // Reset so re-picking the same file fires change again.
              event.target.value = '';
            }}
          />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={upload.status === 'uploading'}
            title="Attach a PDF, TXT or Markdown file"
            aria-label="Attach a document"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
              <path
                d="M13.5 7.5l-5 5a2.12 2.12 0 003 3l5-5a4.24 4.24 0 00-6-6l-5 5a6.36 6.36 0 009 9l4.5-4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              hasDocument ? 'Ask about the document…' : 'Attach a document to get started…'
            }
            className="max-h-40 min-h-9 flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-border-strong focus:outline-none"
          />

          <button
            type="submit"
            disabled={disabled || value.trim().length === 0}
            className="flex h-9 shrink-0 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? 'Thinking…' : 'Send'}
          </button>
        </form>

        <p className="mt-1.5 text-[0.7rem] text-subtle">
          PDF, TXT or Markdown · up to {formatBytes(MAX_UPLOAD_BYTES)}
        </p>
      </div>
    </div>
  );
}
