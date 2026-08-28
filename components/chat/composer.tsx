'use client';

import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES, formatBytes } from '@/lib/upload';

export interface UploadState {
  status: 'idle' | 'uploading' | 'failed';
  filename?: string;
  error?: string;
}

interface ComposerProps {
  onSend: (text: string) => void;
  onUpload: (file: File) => void;
  onStop: () => void;
  disabled: boolean;
  busy: boolean;
  upload: UploadState;
  hasDocument: boolean;
}

const MAX_TEXTAREA_PX = 200;

/**
 * The message input, with file upload attached.
 *
 * Upload lives in the composer rather than on a separate screen because the brief asks for it
 * "from inside the conversation" — attaching a document is part of the conversation, not a
 * detour out of it.
 */
export function Composer({
  onSend,
  onUpload,
  onStop,
  disabled,
  busy,
  upload,
  hasDocument,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the content up to a cap, then scroll. Measured from scrollHeight after a reset,
  // because scrollHeight never shrinks on its own.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [value]);

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

    // Check size before uploading. The server enforces the same limit, but sending 40 MB just
    // to be refused wastes the user's connection — and Vercel would reject the body with an
    // opaque 413 before our handler ever ran.
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
    <div className="shrink-0 border-t border-border bg-background px-4 pt-3 pb-4">
      <div className="mx-auto w-full max-w-[46rem]">
        {notice ? (
          <p
            role="alert"
            className="mb-2 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-[0.78rem] text-danger"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0">
              <path
                d="M8 5v4M8 11v.5M8 1.5L1 14h14L8 1.5z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {notice}
          </p>
        ) : null}

        {upload.status === 'uploading' ? (
          <p className="mb-2 flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-[0.78rem] text-muted">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse-soft rounded-full bg-accent" />
            Reading {upload.filename} — extracting text, splitting it and building embeddings.
          </p>
        ) : null}

        <form
          onSubmit={submit}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pickFile(event.dataTransfer.files?.[0]);
          }}
          className={`flex items-end gap-2 rounded-xl border bg-surface p-2 transition-colors ${
            dragging ? 'border-accent bg-accent-soft/40' : 'border-border focus-within:border-border-strong'
          }`}
        >
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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-40"
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
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={
              dragging
                ? 'Drop the file to attach it…'
                : hasDocument
                  ? 'Ask about the document…'
                  : 'Attach a document, then ask about it…'
            }
            className="flex-1 resize-none self-center bg-transparent px-1 py-1.5 text-[0.88rem] leading-relaxed text-foreground placeholder:text-subtle focus:outline-none"
          />

          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-foreground transition-colors hover:bg-border"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3">
                <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || value.trim().length === 0}
              aria-label="Send message"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
                <path
                  d="M8 13V3M4 7l4-4 4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </form>

        <p className="mt-1.5 text-center text-[0.68rem] text-subtle">
          PDF, TXT or Markdown · up to {formatBytes(MAX_UPLOAD_BYTES)} · answers cite the page
          they came from
        </p>
      </div>
    </div>
  );
}
