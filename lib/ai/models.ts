/**
 * Model selection, in one place.
 *
 * Chosen by measurement, not assumption — see docs/04-decisions.md D11 for the numbers.
 */

/**
 * Chat model.
 *
 * NOT `gemini-2.5-flash`: it is still returned by the models list endpoint but rejects new
 * API keys with "no longer available to new users", and Google's own error message points
 * here instead. `gemini-3.7-flash` was unavailable when tested ("currently experiencing"
 * issues) and `gemini-3.5-flash` answered in 23s versus 4.9s for this one.
 *
 * Pinned deliberately rather than using the `gemini-flash-latest` alias: an alias can change
 * under a submission that gets reviewed days after it is sent.
 */
export const CHAT_MODEL = 'gemini-3.6-flash';

/**
 * Embedding model.
 *
 * `gemini-embedding-001` beat `gemini-embedding-2` on both axes that matter here: a larger
 * margin between a true match and the best distractor (0.1545 vs 0.1226) and less than half
 * the latency (1.3s vs 3.0s).
 *
 * Caveat that makes normalisation mandatory: at a truncated 1536 dims this model returns
 * vectors with an L2 norm of ~0.70, not 1.0. (`gemini-embedding-2` happens to return unit
 * vectors, which is exactly the kind of difference that makes a silent bug when you swap
 * models and forget.) Always normalise — see lib/rag/embed.ts.
 */
export const EMBEDDING_MODEL = 'gemini-embedding-001';

/**
 * Embedding width.
 *
 * The model's native output is 3072, but pgvector's HNSW index supports at most 2000
 * dimensions, so the native width cannot be indexed at all. Must match
 * `EMBEDDING_DIMENSIONS` in lib/db/schema.ts; changing it requires a migration and a
 * full re-embed of every chunk.
 */
export const EMBEDDING_DIMENSIONS = 1536;
