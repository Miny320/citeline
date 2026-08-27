/**
 * Core contracts for the RAG pipeline.
 *
 * These four types are the spine of the ingestion and retrieval paths. Every module
 * boundary in `lib/rag/` speaks one of them, so a change here is a change to the
 * pipeline's shape — not an implementation detail.
 *
 * See docs/06-implementation-spec.md §2.
 */

/** The kinds of document we can ingest. Mirrors `documents.kind` in the schema. */
export type DocumentKind = 'pdf' | 'txt' | 'md';

/**
 * Output of every parser.
 *
 * One block is one page (PDF), one section (Markdown), or one paragraph run (TXT).
 * Locator fields are captured here, at parse time, because they cannot be recovered
 * accurately once the document is flattened into a single string. See docs/04-decisions.md D3.
 */
export interface LocatedBlock {
  text: string;
  /** 1-indexed page number. PDF only. */
  page?: number;
  /** Heading path, Markdown only, e.g. "Setup > Environment". */
  section?: string;
  /** Offsets into the full reconstructed document text. */
  charStart: number;
  charEnd: number;
}

/**
 * A chunk ready to be embedded and stored.
 *
 * Locator fields are carried straight through from the `LocatedBlock` that produced it —
 * never recomputed, never inferred.
 */
export interface PendingChunk {
  chunkIndex: number;
  content: string;
  pageFrom?: number;
  pageTo?: number;
  section?: string;
  charStart: number;
  charEnd: number;
}

/** A chunk retrieved for a query, joined with the document it came from. */
export interface RetrievedChunk {
  id: string;
  content: string;
  filename: string;
  kind: DocumentKind;
  pageFrom: number | null;
  pageTo: number | null;
  section: string | null;
  charStart: number;
  charEnd: number;
  /** Fused RRF score. Higher is better. Not a probability. */
  score: number;
}

/**
 * A citation as rendered to the user.
 *
 * Built server-side from database rows only. The model supplies an *index* into the
 * retrieval set and nothing else, so neither `excerpt` nor `locator` can be fabricated.
 * See docs/04-decisions.md D4.
 */
export interface Citation {
  chunkId: string;
  /** The 1-based marker the model used, e.g. 1 for "[1]". */
  index: number;
  filename: string;
  /** Human-readable locator: "p. 12" | "Setup › Environment" | "lines 340–388" | null. */
  locator: string | null;
  /** Verbatim chunk content, read from Postgres. */
  excerpt: string;
}
