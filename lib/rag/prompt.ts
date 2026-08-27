import type { RetrievedChunk } from './types';

/**
 * Human-readable locator for a chunk.
 *
 * Degrades honestly rather than inventing precision:
 *   PDF → "p. 12"
 *   MD  → "Setup › Environment"
 *   TXT → null (filename and excerpt only)
 *
 * TXT line ranges are a deliberate cut — they would need line numbers captured at parse time
 * and two more columns. Showing a made-up locator would be worse than showing none.
 * See docs/05-worklog.md cut list.
 */
export function formatLocator(chunk: RetrievedChunk): string | null {
  if (chunk.kind === 'pdf' && chunk.pageFrom !== null) {
    return chunk.pageFrom === chunk.pageTo || chunk.pageTo === null
      ? `p. ${chunk.pageFrom}`
      : `pp. ${chunk.pageFrom}–${chunk.pageTo}`;
  }

  if (chunk.section) return chunk.section.replace(/\s*>\s*/g, ' › ');

  return null;
}

/** "report.pdf · p. 12" — what a citation chip shows. */
export function formatSource(chunk: RetrievedChunk): string {
  const locator = formatLocator(chunk);
  return locator ? `${chunk.filename} · ${locator}` : chunk.filename;
}

/**
 * Build the numbered context block.
 *
 * Chunk ids are deliberately absent: the model only ever sees `[1]`..`[n]` and therefore
 * cannot reference anything outside the set the server retrieved for this request. Its only
 * freedom is which real passage to point at. See docs/04-decisions.md D4.
 */
export function buildContextBlock(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk, index) => `[${index + 1}] (${formatSource(chunk)})\n${chunk.content}`)
    .join('\n\n---\n\n');
}

export function buildSystemPrompt(chunks: RetrievedChunk[]): string {
  return `You answer questions about documents the user has uploaded. You have been given numbered excerpts from those documents as context.

RULES
1. Answer ONLY from the numbered context below. Do not use outside knowledge, and do not infer facts the context does not state.
2. Every factual claim must carry a citation marker naming the excerpt it came from, like [1] or [2][4]. Place the marker at the end of the sentence it supports.
3. If the context does not contain the answer, say so plainly: "The document doesn't cover that." Then, if useful, name what the document does discuss nearby. Never fill a gap with a guess, and never apologise at length.
4. If excerpts conflict, say so and cite both.
5. Cite only numbers that appear in the context. Never invent a number, a page, a filename, or a quotation.
6. When the answer rests on specific passages, call the showEvidence tool so the user can inspect the supporting text. Prefer it for multi-part or comparative answers.
7. Be concise. Match the document's own terminology rather than paraphrasing it away.

CONTEXT
${buildContextBlock(chunks)}`;
}

/**
 * Shown when retrieval returns nothing.
 *
 * The model is not called at all in that case — there is no context to ground an answer in,
 * so inventing one is the only thing it could do. Skipping the call is faster, cheaper, and
 * removes the failure mode entirely.
 */
export function buildNoResultsReply(filenames: string[]): string {
  if (filenames.length === 0) {
    return "You haven't uploaded a document yet. Attach a PDF, TXT or Markdown file and I'll answer questions about it.";
  }

  const list =
    filenames.length === 1
      ? filenames[0]
      : `${filenames.slice(0, -1).join(', ')} or ${filenames[filenames.length - 1]}`;

  return `I couldn't find anything relevant in ${list}. Try rephrasing the question, or use wording closer to the document's own.`;
}
