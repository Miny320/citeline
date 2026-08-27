import { google } from '@ai-sdk/google';
import { embed, embedMany } from 'ai';

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../ai/models';
import { AppError, toAppError } from '../errors';

/**
 * L2-normalise a vector.
 *
 * Mandatory, not defensive. `gemini-embedding-001` truncated to 1536 dimensions returns
 * vectors with an L2 norm around 0.70 — measured, see docs/04-decisions.md D11 — and cosine
 * distance over non-unit vectors is subtly wrong in a way that never raises an error, it just
 * quietly degrades every ranking.
 */
export function l2normalise(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

const providerOptions = {
  google: { outputDimensionality: EMBEDDING_DIMENSIONS },
} as const;

function assertDimensions(vector: number[]): void {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    // Would otherwise surface as an opaque Postgres error on insert.
    throw new AppError(
      'EMBEDDING_FAILED',
      `expected ${EMBEDDING_DIMENSIONS} dimensions, received ${vector.length}`,
    );
  }
}

/**
 * Embed document chunks.
 *
 * `embedMany` splits oversized requests internally, so no manual batching is needed here.
 * `maxParallelCalls` is deliberately modest to stay inside the free tier's rate limits.
 */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  try {
    const { embeddings } = await embedMany({
      model: google.embedding(EMBEDDING_MODEL),
      values: texts,
      providerOptions,
      maxParallelCalls: 4,
    });

    const first = embeddings[0];
    if (first) assertDimensions(first);

    return embeddings.map(l2normalise);
  } catch (error) {
    throw toAppError(error, 'EMBEDDING_FAILED');
  }
}

/** Embed a single search query. Must use the same model and normalisation as the chunks. */
export async function embedQuery(text: string): Promise<number[]> {
  try {
    const { embedding } = await embed({
      model: google.embedding(EMBEDDING_MODEL),
      value: text,
      providerOptions,
    });

    assertDimensions(embedding);
    return l2normalise(embedding);
  } catch (error) {
    throw toAppError(error, 'EMBEDDING_FAILED');
  }
}
