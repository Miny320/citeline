import { sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { toAppError } from '@/lib/errors';
import { embedQuery } from './embed';
import type { RetrievedChunk } from './types';

/** Candidates pulled from each arm before fusion. */
const CANDIDATES_PER_ARM = 20;

/** How many fused results reach the model. */
export const DEFAULT_TOP_K = 8;

/**
 * Reciprocal Rank Fusion constant.
 *
 * 60 is the value from the original RRF paper. It damps the influence of the very top ranks
 * just enough that one arm cannot dominate the other.
 */
const RRF_K = 60;

interface RetrievedRow {
  // `db.execute<T>` constrains T to Record<string, unknown>; the named fields below stay typed.
  [key: string]: unknown;
  id: string;
  content: string;
  filename: string;
  kind: 'pdf' | 'txt' | 'md';
  page_from: number | null;
  page_to: number | null;
  section: string | null;
  char_start: number;
  char_end: number;
  score: number;
}

export interface RetrieveArgs {
  chatId: string;
  query: string;
  limit?: number;
}

/**
 * Hybrid retrieval over the documents belonging to one chat.
 *
 * Two independent rankings — dense vector similarity and Postgres full-text — are fused by
 * Reciprocal Rank Fusion. Pure vector search reliably misses exact tokens (error codes,
 * product names, acronyms), which is exactly what people ask a document chat about.
 *
 * Deliberately there is NO absolute similarity threshold. Measured on these embeddings, an
 * unrelated passage from the same document still scores ~0.72, so the `gt(similarity, 0.5)`
 * filter from the standard pgvector examples matches everything and silently does nothing.
 * Only the ordering is meaningful, and RRF consumes ranks rather than scores.
 * See docs/04-decisions.md D6 and D12.
 */
export async function retrieve({
  chatId,
  query,
  limit = DEFAULT_TOP_K,
}: RetrieveArgs): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  try {
    const embedding = await embedQuery(trimmed);

    // pgvector's text input format. Passed as a bound parameter, then cast.
    const vector = `[${embedding.join(',')}]`;

    const result = await db.execute<RetrievedRow>(sql`
      WITH vec AS (
        SELECT c.id,
               ROW_NUMBER() OVER (ORDER BY c.embedding <=> ${vector}::vector) AS rank
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE d.chat_id = ${chatId}::uuid AND d.status = 'ready'
        ORDER BY c.embedding <=> ${vector}::vector
        LIMIT ${CANDIDATES_PER_ARM}
      ),
      lex AS (
        SELECT c.id,
               ROW_NUMBER() OVER (
                 ORDER BY ts_rank_cd(c.content_tsv, plainto_tsquery('english', ${trimmed})) DESC
               ) AS rank
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE d.chat_id = ${chatId}::uuid
          AND d.status = 'ready'
          AND c.content_tsv @@ plainto_tsquery('english', ${trimmed})
        ORDER BY ts_rank_cd(c.content_tsv, plainto_tsquery('english', ${trimmed})) DESC
        LIMIT ${CANDIDATES_PER_ARM}
      ),
      fused AS (
        SELECT id, SUM(weight) AS score
        FROM (
          SELECT id, 1.0 / (${RRF_K} + rank) AS weight FROM vec
          UNION ALL
          SELECT id, 1.0 / (${RRF_K} + rank) AS weight FROM lex
        ) contributions
        GROUP BY id
      )
      SELECT c.id, c.content, c.page_from, c.page_to, c.section,
             c.char_start, c.char_end, d.filename, d.kind, f.score
      FROM fused f
      JOIN chunks c ON c.id = f.id
      JOIN documents d ON d.id = c.document_id
      ORDER BY f.score DESC
      LIMIT ${limit}
    `);

    return result.rows.map(toRetrievedChunk);
  } catch (error) {
    throw toAppError(error);
  }
}

function toRetrievedChunk(row: RetrievedRow): RetrievedChunk {
  return {
    id: row.id,
    content: row.content,
    filename: row.filename,
    kind: row.kind,
    pageFrom: row.page_from,
    pageTo: row.page_to,
    section: row.section,
    charStart: row.char_start,
    charEnd: row.char_end,
    // Postgres returns NUMERIC as a string over the wire.
    score: Number(row.score),
  };
}
