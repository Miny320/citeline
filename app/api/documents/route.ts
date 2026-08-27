import { AppError, errorResponse } from '@/lib/errors';
import { assertUploadSize, resolveKind } from '@/lib/upload';
import { chunkBlocks } from '@/lib/rag/chunk';
import { embedChunks } from '@/lib/rag/embed';
import { parseDocument } from '@/lib/rag/parse';
import {
  countChunks,
  createChat,
  createDocument,
  getChat,
  insertChunks,
  listDocuments,
  setDocumentStatus,
} from '@/lib/db/queries';

/**
 * Ingestion runs inline rather than on a queue.
 *
 * Vercel Hobby allows 300s, and a file of 4 MB or less parses and embeds well inside that,
 * so a queue would add a service and a class of failure modes to solve a problem this app
 * does not have. See docs/04-decisions.md D7.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  let documentId: string | null = null;

  try {
    const form = await request.formData().catch(() => {
      throw new AppError('BAD_REQUEST', 'expected multipart/form-data');
    });

    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError('BAD_REQUEST', 'missing "file" field');

    // Validate before any expensive work, so a bad upload costs nothing.
    assertUploadSize(file.size);
    const kind = resolveKind(file.name, file.type);

    // Resolve the chat first: a document must never be orphaned by a failed chat insert.
    const requestedChatId = form.get('chatId');
    let chatId: string;

    if (typeof requestedChatId === 'string' && requestedChatId.length > 0) {
      const chat = await getChat(requestedChatId);
      if (!chat) throw new AppError('CHAT_NOT_FOUND');
      chatId = chat.id;
    } else {
      chatId = await createChat();
    }

    // The row exists as `processing` before parsing starts, so a failure has somewhere to
    // record itself and a reload can still show what happened.
    const id = await createDocument({
      chatId,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      byteSize: file.size,
      kind,
    });
    documentId = id;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { blocks, pageCount } = await parseDocument(kind, bytes);

    const pending = chunkBlocks(blocks);
    if (pending.length === 0) throw new AppError('EMPTY_DOCUMENT', 'no chunks produced');

    const embeddings = await embedChunks(pending.map((chunk) => chunk.content));

    await insertChunks(
      pending.map((chunk, index) => {
        const embedding = embeddings[index];
        if (!embedding) throw new AppError('EMBEDDING_FAILED', `missing vector for chunk ${index}`);

        return {
          documentId: id,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          pageFrom: chunk.pageFrom ?? null,
          pageTo: chunk.pageTo ?? null,
          section: chunk.section ?? null,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          embedding,
        };
      }),
    );

    await setDocumentStatus({ documentId: id, status: 'ready', pageCount });

    return Response.json(
      {
        id,
        chatId,
        filename: file.name,
        kind,
        status: 'ready' as const,
        pageCount,
        chunkCount: pending.length,
      },
      { status: 201 },
    );
  } catch (error) {
    // Record the failure against the document so it survives a reload, rather than existing
    // only as a toast the user can dismiss and never see again.
    if (documentId) {
      const message = error instanceof AppError ? error.userMessage : 'Processing failed.';
      await setDocumentStatus({ documentId, status: 'failed', error: message }).catch(() => {
        // The database is already unreachable; the response below still reports the failure.
      });
    }

    return errorResponse(error, 'PARSE_FAILED');
  }
}

/** Status for a single document, used while ingesting and after a reload. */
export async function GET(request: Request) {
  try {
    const chatId = new URL(request.url).searchParams.get('chatId');
    if (!chatId) throw new AppError('BAD_REQUEST', 'chatId is required');

    const documents = await listDocuments(chatId);

    return Response.json({
      documents: await Promise.all(
        documents.map(async (document) => ({
          id: document.id,
          filename: document.filename,
          kind: document.kind,
          status: document.status,
          pageCount: document.pageCount,
          error: document.error,
          chunkCount: document.status === 'ready' ? await countChunks(document.id) : 0,
        })),
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
