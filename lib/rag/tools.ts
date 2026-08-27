import { tool } from 'ai';
import { z } from 'zod';

import { formatLocator } from './prompt';
import type { Citation, RetrievedChunk } from './types';

export const CONFIDENCE = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export interface EvidenceClaim {
  claim: string;
  confidence: Confidence;
  citations: Citation[];
}

export interface EvidenceOutput {
  claims: EvidenceClaim[];
}

/**
 * Resolve the model's 1-based context markers back to real chunks.
 *
 * The model never supplies an id, a filename, a page or an excerpt — only an index into the
 * array this request retrieved. Anything out of range is dropped rather than rendered, so a
 * fabricated citation is structurally impossible rather than merely unlikely.
 * See docs/04-decisions.md D4.
 */
export function resolveCitations(indexes: number[], retrieved: RetrievedChunk[]): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];

  for (const index of indexes) {
    const chunk = retrieved[index - 1];
    if (!chunk || seen.has(chunk.id)) continue;
    seen.add(chunk.id);

    citations.push({
      chunkId: chunk.id,
      index,
      filename: chunk.filename,
      locator: formatLocator(chunk),
      // Read from the retrieval set, which came from Postgres — never from model output,
      // so the quoted text is guaranteed to be what the document actually says.
      excerpt: chunk.content,
    });
  }

  return citations;
}

/**
 * The full retrieval set as citations, in context-block order.
 *
 * Streamed to the client as a data part so an inline `[2]` in the answer can be resolved to
 * its filename, locator and verbatim excerpt — including after a reload, since data parts are
 * persisted with the message.
 */
export function buildSources(retrieved: RetrievedChunk[]): Citation[] {
  return resolveCitations(
    retrieved.map((_, index) => index + 1),
    retrieved,
  );
}

/**
 * Tools for one chat request.
 *
 * Built per-request as a closure over that request's retrieval set, which is what keeps
 * citation resolution scoped and unforgeable.
 */
export function buildTools(retrieved: RetrievedChunk[]) {
  return {
    showEvidence: tool({
      description:
        'Present the supporting evidence for a factual answer as inspectable cards. ' +
        'Call this whenever the answer rests on specific passages in the document, and ' +
        'always for multi-part or comparative answers.',
      inputSchema: z.object({
        claims: z
          .array(
            z.object({
              claim: z
                .string()
                .min(1)
                .describe('One factual assertion, stated in your own words.'),
              citationIndexes: z
                .array(z.number().int().min(1))
                .min(1)
                .describe('1-based indexes of the context blocks that support it, e.g. [1, 3].'),
              confidence: z
                .enum(CONFIDENCE)
                .describe(
                  'high = stated outright in the excerpts; medium = strongly implied; ' +
                    'low = partial or indirect support.',
                ),
            }),
          )
          .min(1)
          .max(6),
      }),
      execute: async ({ claims }): Promise<EvidenceOutput> => ({
        claims: claims.map((claim) => ({
          claim: claim.claim,
          confidence: claim.confidence,
          citations: resolveCitations(claim.citationIndexes, retrieved),
        })),
      }),
    }),
  };
}

export type ChatTools = ReturnType<typeof buildTools>;
