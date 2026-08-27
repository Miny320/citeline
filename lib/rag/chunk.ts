import type { LocatedBlock, PendingChunk } from './types';

export interface ChunkOptions {
  targetChars?: number;
  overlapChars?: number;
  minChars?: number;
}

const DEFAULTS = { targetChars: 1000, overlapChars: 150, minChars: 200 } as const;

/**
 * One contiguous stretch of text sharing a single locator.
 *
 * Adjacent blocks are merged into a run only when their page AND section match, so a chunk
 * can never straddle a page boundary — a chunk spanning pages 3 and 4 cannot be cited
 * unambiguously. See docs/04-decisions.md D3.
 */
interface Run {
  text: string;
  page?: number;
  section?: string;
  /** Maps positions in `text` back to absolute offsets in the source document. */
  segments: Array<{ localStart: number; absoluteStart: number; length: number }>;
}

const SEPARATOR = '\n\n';

export function chunkBlocks(blocks: LocatedBlock[], options: ChunkOptions = {}): PendingChunk[] {
  const { targetChars, overlapChars, minChars } = { ...DEFAULTS, ...options };

  const chunks: PendingChunk[] = [];
  let chunkIndex = 0;

  for (const run of buildRuns(blocks)) {
    for (const piece of splitRun(run.text, targetChars, overlapChars, minChars)) {
      const content = piece.text.trim();
      if (content.length === 0) continue;

      // Trimming can shift the start; re-anchor so offsets stay truthful.
      const leadingTrim = piece.text.length - piece.text.trimStart().length;
      const start = piece.start + leadingTrim;

      chunks.push({
        chunkIndex: chunkIndex++,
        content,
        ...(run.page !== undefined ? { pageFrom: run.page, pageTo: run.page } : {}),
        ...(run.section !== undefined ? { section: run.section } : {}),
        charStart: mapOffset(run, start),
        charEnd: mapOffset(run, start + content.length - 1) + 1,
      });
    }
  }

  return chunks;
}

function buildRuns(blocks: LocatedBlock[]): Run[] {
  const runs: Run[] = [];

  for (const block of blocks) {
    const previous = runs[runs.length - 1];
    const sameLocator =
      previous !== undefined && previous.page === block.page && previous.section === block.section;

    if (previous && sameLocator) {
      const localStart = previous.text.length + SEPARATOR.length;
      previous.text += SEPARATOR + block.text;
      previous.segments.push({
        localStart,
        absoluteStart: block.charStart,
        length: block.text.length,
      });
      continue;
    }

    runs.push({
      text: block.text,
      ...(block.page !== undefined ? { page: block.page } : {}),
      ...(block.section !== undefined ? { section: block.section } : {}),
      segments: [{ localStart: 0, absoluteStart: block.charStart, length: block.text.length }],
    });
  }

  return runs;
}

/** Translate a position in a run's text back to an absolute document offset. */
function mapOffset(run: Run, local: number): number {
  let candidate = run.segments[0];

  for (const segment of run.segments) {
    if (local >= segment.localStart) candidate = segment;
    else break;
  }
  if (!candidate) return local;

  const delta = Math.min(local - candidate.localStart, candidate.length);
  return candidate.absoluteStart + Math.max(0, delta);
}

interface Piece {
  text: string;
  start: number;
}

/**
 * Split one run into overlapping pieces.
 *
 * Breaks are pulled back to a sentence boundary where possible, then a word boundary, then
 * a hard cut — so a citation excerpt rarely begins or ends mid-sentence.
 */
function splitRun(text: string, target: number, overlap: number, min: number): Piece[] {
  if (text.length <= target) return [{ text, start: 0 }];

  const pieces: Piece[] = [];
  let position = 0;

  while (position < text.length) {
    const hardEnd = Math.min(position + target, text.length);
    const end = hardEnd >= text.length ? text.length : findBreak(text, position, hardEnd);

    pieces.push({ text: text.slice(position, end), start: position });

    if (end >= text.length) break;

    // Step back by the overlap, then forward to the next word boundary so a chunk does not
    // begin mid-word. Guard against a zero-width step, which would loop forever.
    let next = Math.max(end - overlap, position + 1);
    const boundary = text.indexOf(' ', next);
    if (boundary !== -1 && boundary < end) next = boundary + 1;
    position = Math.max(next, position + 1);
  }

  // A short tail reads badly and embeds poorly; fold it back into its predecessor. Safe
  // because everything in this run shares one locator.
  const last = pieces[pieces.length - 1];
  const previous = pieces[pieces.length - 2];
  if (pieces.length > 1 && last && previous && last.text.trim().length < min) {
    pieces.splice(pieces.length - 2, 2, {
      text: text.slice(previous.start),
      start: previous.start,
    });
  }

  return pieces;
}

function findBreak(text: string, from: number, hardEnd: number): number {
  // Look for a sentence end in the last fifth of the window.
  const window = text.slice(from, hardEnd);
  const lookback = Math.max(0, window.length - 200);

  const sentence = /[.!?](?=[\s"')\]]|$)/g;
  let best = -1;
  let match: RegExpExecArray | null;
  while ((match = sentence.exec(window)) !== null) {
    if (match.index >= lookback) best = match.index + 1;
  }
  if (best > 0) return from + best;

  const space = window.lastIndexOf(' ');
  if (space > lookback) return from + space;

  return hardEnd;
}
