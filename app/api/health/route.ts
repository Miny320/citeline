import { sql } from 'drizzle-orm';

import { db } from '@/lib/db';

/** A health check must never be served from cache. */
export const dynamic = 'force-dynamic';

/**
 * Phase 0 gate.
 *
 * Confirms two things the whole app depends on, and which behave differently in a
 * serverless deployment than they do locally:
 *   1. Neon is reachable from the Vercel function.
 *   2. The `vector` extension exists — without it the chunks table cannot be created,
 *      and the failure would otherwise surface much later as a confusing migration error.
 *
 * `latencyMs` is worth watching: on the Neon free plan the first request after a
 * five-minute idle wakes a suspended compute, so a cold call can take seconds. That is
 * the cold start the loading skeletons exist for, not a bug.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    const result = await db.execute<{ db: number; has_vector: boolean }>(
      sql`SELECT 1 AS db,
                 EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_vector`,
    );

    const row = result.rows[0];

    return Response.json({
      ok: true,
      db: row?.db ?? null,
      pgvector: row?.has_vector ?? false,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    // Never leak a connection string or a stack trace to the client.
    console.error('[health] database check failed:', error);

    return Response.json(
      {
        ok: false,
        error: 'DB_UNAVAILABLE',
        message: 'Could not reach the database.',
        latencyMs: Date.now() - startedAt,
      },
      { status: 503 },
    );
  }
}
