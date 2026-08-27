import { sql, type SQL } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import type { UIMessage } from 'ai';

/**
 * Drizzle ships a first-class `vector` type for pgvector, but not `tsvector`,
 * so the full-text column is declared here.
 */
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/**
 * Embedding width.
 *
 * `gemini-embedding-001` emits 3072 dimensions by default, but pgvector's HNSW index
 * supports a maximum of 2000 — so the native output cannot be indexed at all. We request
 * 1536 via `outputDimensionality` and L2-normalise before storing, because Gemini vectors
 * truncated below their native size are no longer unit-length and cosine distance on
 * non-normalised vectors is subtly wrong.
 *
 * See docs/04-decisions.md D2. Changing this requires a migration and a full re-embed.
 */
export const EMBEDDING_DIMENSIONS = 1536;

export const chats = pgTable('chats', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Derived from the first user message; null until then. */
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    kind: text('kind', { enum: ['pdf', 'txt', 'md'] }).notNull(),
    /** Null for txt/md — they have no pages. */
    pageCount: integer('page_count'),
    status: text('status', { enum: ['processing', 'ready', 'failed'] })
      .notNull()
      .default('processing'),
    /** User-facing failure reason. Persisted so the error survives a reload, not just a toast. */
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('documents_chat_id_idx').on(t.chatId)],
);

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    /** PDF only. A chunk never spans pages, so pageFrom === pageTo for PDFs. */
    pageFrom: integer('page_from'),
    pageTo: integer('page_to'),
    /** Markdown heading path, e.g. "Setup > Environment". */
    section: text('section'),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    contentTsv: tsvector('content_tsv').generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', ${chunks.content})`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Cosine ops — queries must use the `<=>` operator. Using `<->` (L2) would silently
    // bypass this index and fall back to a sequential scan.
    index('chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('chunks_tsv_idx').using('gin', t.contentTsv),
    index('chunks_document_id_idx').on(t.documentId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    /**
     * The AI SDK's own message id, not a fresh uuid — this makes re-saving a stream
     * idempotent (upsert) rather than duplicating rows.
     */
    id: text('id').primaryKey(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    /**
     * The full `UIMessage.parts` array.
     *
     * Stored wholesale rather than flattened to text so that tool calls and their results —
     * the evidence cards — survive a reload. Flattening would make the structured UI work in
     * a live demo and vanish on refresh. See docs/04-decisions.md D5.
     */
    parts: jsonb('parts').notNull().$type<UIMessage['parts']>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_chat_created_idx').on(t.chatId, t.createdAt)],
);

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
