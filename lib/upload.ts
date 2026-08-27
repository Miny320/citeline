import { AppError } from './errors';
import type { DocumentKind } from './rag/types';

/**
 * Maximum upload size.
 *
 * Vercel caps a function's request body at 4.5 MB — a platform limit, not a preference.
 * Exceeding it returns an opaque 413 FUNCTION_PAYLOAD_TOO_LARGE that reads as a broken app,
 * so we reject at 4 MB with an explanation instead. See docs/04-decisions.md D8.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = ['.pdf', '.txt', '.md'] as const;

/** For the file input's `accept` attribute. */
export const ACCEPT_ATTRIBUTE = '.pdf,.txt,.md,application/pdf,text/plain,text/markdown';

const EXTENSION_TO_KIND: Record<string, DocumentKind> = {
  '.pdf': 'pdf',
  '.txt': 'txt',
  '.md': 'md',
  '.markdown': 'md',
};

/**
 * Decide a document's kind from its filename, cross-checked against its MIME type.
 *
 * The extension is authoritative: browsers report Markdown inconsistently (`text/markdown`,
 * `text/x-markdown`, `application/octet-stream`, or empty), so trusting MIME alone would
 * reject valid files. MIME is used only to catch an obvious contradiction — a `.txt` name on
 * a PDF payload.
 */
export function resolveKind(filename: string, mimeType: string): DocumentKind {
  const dot = filename.lastIndexOf('.');
  const extension = dot === -1 ? '' : filename.slice(dot).toLowerCase();
  const kind = EXTENSION_TO_KIND[extension];

  if (!kind) throw new AppError('UNSUPPORTED_TYPE', `extension "${extension || 'none'}"`);

  const claimsPdf = mimeType === 'application/pdf';
  if (kind === 'pdf' && mimeType && !claimsPdf && !mimeType.startsWith('application/octet-stream')) {
    throw new AppError('UNSUPPORTED_TYPE', `.pdf named file sent as "${mimeType}"`);
  }
  if (kind !== 'pdf' && claimsPdf) {
    throw new AppError('UNSUPPORTED_TYPE', `PDF payload named "${filename}"`);
  }

  return kind;
}

/** Shared by the client-side guard and the server, so the two can never disagree. */
export function assertUploadSize(byteSize: number): void {
  if (byteSize === 0) throw new AppError('EMPTY_DOCUMENT');
  if (byteSize > MAX_UPLOAD_BYTES) {
    throw new AppError('FILE_TOO_LARGE', `${byteSize} bytes`);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
