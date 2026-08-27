import 'server-only';

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { UIMessage } from 'ai';

import { db } from './index';
import { chats, chunks, documents, messages } from './schema';
import type { Document, NewChunk } from './schema';

/* ------------------------------------------------------------------ chats */

export async function createChat(title?: string): Promise<string> {
  const [row] = await db
    .insert(chats)
    .values({ title: title ?? null })
    .returning({ id: chats.id });

  if (!row) throw new Error('Failed to create chat');
  return row.id;
}

export async function getChat(chatId: string) {
  const [row] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
  return row ?? null;
}

export async function listChats(limit = 50) {
  return db.select().from(chats).orderBy(desc(chats.updatedAt)).limit(limit);
}

/** Set the title once, from the first user message. Never overwrites an existing title. */
export async function setChatTitleIfEmpty(chatId: string, title: string): Promise<void> {
  await db
    .update(chats)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(chats.id, chatId), sql`${chats.title} IS NULL`));
}

export async function touchChat(chatId: string): Promise<void> {
  await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chatId));
}

/* --------------------------------------------------------------- messages */

export async function getMessages(chatId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.createdAt));
}

/**
 * Persist a full message list for a chat.
 *
 * Upserts on the AI SDK's own message id, so re-saving a stream (a retry, a reconnect)
 * updates in place instead of duplicating. See docs/04-decisions.md D5.
 */
export async function saveMessages(args: {
  chatId: string;
  messages: readonly UIMessage[];
}): Promise<void> {
  const { chatId, messages: list } = args;
  if (list.length === 0) return;

  const rows = list.map((m) => ({
    id: m.id,
    chatId,
    role: m.role as 'user' | 'assistant' | 'system',
    parts: m.parts,
  }));

  await db
    .insert(messages)
    .values(rows)
    .onConflictDoUpdate({
      target: messages.id,
      set: { parts: sql`excluded.parts` },
    });

  await touchChat(chatId);
}

/* -------------------------------------------------------------- documents */

export async function createDocument(args: {
  chatId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  kind: Document['kind'];
}): Promise<string> {
  const [row] = await db
    .insert(documents)
    .values({ ...args, status: 'processing' })
    .returning({ id: documents.id });

  if (!row) throw new Error('Failed to create document');
  return row.id;
}

export async function getDocument(documentId: string) {
  const [row] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  return row ?? null;
}

export async function listDocuments(chatId: string) {
  return db
    .select()
    .from(documents)
    .where(eq(documents.chatId, chatId))
    .orderBy(asc(documents.createdAt));
}

export async function setDocumentStatus(args: {
  documentId: string;
  status: Document['status'];
  pageCount?: number | null;
  error?: string | null;
}): Promise<void> {
  const { documentId, status, pageCount, error } = args;
  await db
    .update(documents)
    .set({
      status,
      ...(pageCount !== undefined ? { pageCount } : {}),
      // Clear a stale error when a document transitions back to a healthy state.
      error: status === 'failed' ? (error ?? 'Unknown error') : null,
    })
    .where(eq(documents.id, documentId));
}

export async function countChunks(documentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chunks)
    .where(eq(chunks.documentId, documentId));
  return row?.count ?? 0;
}

/* ----------------------------------------------------------------- chunks */

/**
 * Insert chunks in batches.
 *
 * Neon's HTTP driver sends one statement per round-trip, and a 1536-float vector is a large
 * parameter, so a single insert of several hundred chunks can exceed the statement size.
 * 50 keeps each request comfortably small.
 */
export async function insertChunks(rows: NewChunk[], batchSize = 50): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    await db.insert(chunks).values(rows.slice(i, i + batchSize));
  }
}
