import { extractText } from 'unpdf';

import { AppError } from '../errors';
import type { DocumentKind, LocatedBlock } from './types';

export interface ParseResult {
  blocks: LocatedBlock[];
  /** Null for txt/md, which have no pages. */
  pageCount: number | null;
}

/**
 * Parse an uploaded file into located blocks.
 *
 * The locator metadata (page, section, offsets) is assigned HERE, while the document's
 * structure is still visible. Once text is flattened into one string, page attribution can
 * only be guessed at — which is how document-chat demos end up citing page 7 for content on
 * page 9. See docs/04-decisions.md D3.
 */
export async function parseDocument(kind: DocumentKind, bytes: Uint8Array): Promise<ParseResult> {
  switch (kind) {
    case 'pdf':
      return parsePdf(bytes);
    case 'md':
      return { blocks: parseMarkdown(decode(bytes)), pageCount: null };
    case 'txt':
      return { blocks: parseText(decode(bytes)), pageCount: null };
  }
}

function decode(bytes: Uint8Array): string {
  // `fatal: false` so a stray invalid byte degrades to U+FFFD instead of failing the upload.
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (text.trim().length === 0) throw new AppError('EMPTY_DOCUMENT');
  return text;
}

/* -------------------------------------------------------------------- PDF */

export async function parsePdf(bytes: Uint8Array): Promise<ParseResult> {
  let totalPages: number;
  let pages: string[];

  try {
    // pdf.js TRANSFERS the underlying ArrayBuffer to its worker, which detaches the caller's
    // view — a second read of `bytes` then throws "Cannot transfer object of unsupported
    // type". Hand it a copy so parsing never destroys the caller's data.
    const owned = new Uint8Array(bytes);

    // mergePages:false returns one string per page — the whole reason for choosing unpdf.
    const result = await extractText(owned, { mergePages: false });
    totalPages = result.totalPages;
    pages = result.text;
  } catch (error) {
    throw new AppError('PARSE_FAILED', error instanceof Error ? error.message : String(error));
  }

  const blocks: LocatedBlock[] = [];
  let cursor = 0;

  for (const [index, rawPage] of pages.entries()) {
    const text = normaliseWhitespace(rawPage);

    // Blank pages still advance the cursor and the page number: dropping them silently would
    // desynchronise every subsequent page citation.
    if (text.length === 0) {
      cursor += 2; // the separator we would have added
      continue;
    }

    blocks.push({
      text,
      page: index + 1,
      charStart: cursor,
      charEnd: cursor + text.length,
    });
    cursor += text.length + 2;
  }

  if (blocks.length === 0) {
    // A PDF that parses fine but yields no text is a scan. Failing loudly here is important:
    // storing zero chunks and reporting "ready" produces a document that answers nothing
    // while claiming success.
    throw new AppError('NO_EXTRACTABLE_TEXT', `${totalPages} pages, no text layer`);
  }

  return { blocks, pageCount: totalPages };
}

/* --------------------------------------------------------------- Markdown */

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * Split Markdown on headings, carrying the full heading path as the section locator.
 *
 * A citation reading "Setup > Environment > Secrets" is far more useful than "Secrets",
 * because heading names repeat across a document.
 */
export function parseMarkdown(source: string): LocatedBlock[] {
  const lines = source.split(/\r?\n/);
  const blocks: LocatedBlock[] = [];

  /** Heading text by depth, 1-indexed. */
  const headingStack: string[] = [];
  let buffer: string[] = [];
  let bufferStart = 0;
  let cursor = 0;
  let inFence = false;

  const flush = (end: number) => {
    const text = normaliseWhitespace(buffer.join('\n'));
    if (text.length > 0) {
      const section = headingStack.filter(Boolean).join(' > ');
      blocks.push({
        text,
        ...(section ? { section } : {}),
        charStart: bufferStart,
        charEnd: end,
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const lineStart = cursor;
    cursor += line.length + 1;

    // Never treat a "#" inside a fenced code block as a heading.
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;

    const heading = inFence ? null : ATX_HEADING.exec(line);

    if (heading) {
      flush(lineStart);
      const depth = heading[1]?.length ?? 1;
      const title = heading[2] ?? '';
      headingStack.length = depth - 1;
      headingStack[depth - 1] = title;
      bufferStart = cursor;
      continue;
    }

    if (buffer.length === 0) bufferStart = lineStart;
    buffer.push(line);
  }

  flush(cursor);

  if (blocks.length === 0) throw new AppError('EMPTY_DOCUMENT');
  return blocks;
}

/* -------------------------------------------------------------- Plain text */

/**
 * Split plain text on blank lines into paragraph runs.
 *
 * There is no page or section to cite, so offsets are the locator — later rendered as a
 * line range. Degrading to "lines 340-388" is honest; inventing a page number is not.
 */
export function parseText(source: string): LocatedBlock[] {
  const blocks: LocatedBlock[] = [];
  const paragraphRegex = /\n\s*\n/g;

  let start = 0;
  let match: RegExpExecArray | null;

  const push = (from: number, to: number) => {
    const text = normaliseWhitespace(source.slice(from, to));
    if (text.length > 0) blocks.push({ text, charStart: from, charEnd: to });
  };

  while ((match = paragraphRegex.exec(source)) !== null) {
    push(start, match.index);
    start = match.index + match[0].length;
  }
  push(start, source.length);

  if (blocks.length === 0) throw new AppError('EMPTY_DOCUMENT');
  return blocks;
}

/* ------------------------------------------------------------------ shared */

/**
 * Collapse the whitespace noise PDF extraction produces, without destroying paragraph breaks.
 *
 * Blank lines are meaningful to the chunker, so they survive; runs of spaces and stray
 * carriage returns do not.
 */
function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
