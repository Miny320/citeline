import type { InferUITools, UIMessage } from 'ai';

import type { buildTools } from './rag/tools';
import type { Citation } from './rag/types';

/**
 * The chat's message type, with tool parts typed from the tool definitions themselves.
 *
 * This is what makes `part.type === 'tool-showEvidence'` narrow `part.output` to
 * `EvidenceOutput` in the renderer, instead of leaving it `unknown` and inviting a cast.
 * The single source of truth stays `buildTools`.
 */
export type ChatTools = InferUITools<ReturnType<typeof buildTools>>;

/**
 * Custom data parts carried alongside the assistant's message.
 *
 * `sources` is the retrieval set the server actually used for this answer, resolved to real
 * database rows before streaming. It travels with the message and is persisted in
 * `messages.parts`, which is what lets an inline `[2]` marker still resolve to its filename,
 * page and verbatim excerpt after a reload — rather than only while the tab stays open.
 */
// A type alias, not an interface: interfaces have no implicit index signature, so they do
// not satisfy the UIDataTypes constraint — and adding one back would defeat the narrowing
// that makes `part.type === 'data-sources'` give `part.data` a real type.
export type ChatDataParts = {
  sources: Citation[];
};

export type ChatMessage = UIMessage<never, ChatDataParts, ChatTools>;

/** Document state as the client sees it. */
export interface ClientDocument {
  id: string;
  filename: string;
  kind: 'pdf' | 'txt' | 'md';
  status: 'processing' | 'ready' | 'failed';
  pageCount: number | null;
  error: string | null;
  chunkCount: number;
}

/** Shape of an error body from any of our route handlers. */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = (value as { error?: unknown }).error;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as { message?: unknown }).message === 'string'
  );
}
