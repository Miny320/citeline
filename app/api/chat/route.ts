import { google } from '@ai-sdk/google';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import { z } from 'zod';

import { CHAT_MODEL } from '@/lib/ai/models';
import type { ChatMessage } from '@/lib/chat-types';
import { getChat, listDocuments, saveMessages, setChatTitleIfEmpty } from '@/lib/db/queries';
import { AppError, errorResponse, toAppError } from '@/lib/errors';
import { buildNoResultsReply, buildSystemPrompt } from '@/lib/rag/prompt';
import { retrieve } from '@/lib/rag/retrieve';
import { buildSources, buildTools } from '@/lib/rag/tools';

export const maxDuration = 60;

const BodySchema = z.object({
  chatId: z.string().uuid(),
  messages: z.array(z.custom<UIMessage>()).min(1),
});

/** Concatenate the text parts of the most recent user message. */
function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'user') continue;

    return message.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join(' ')
      .trim();
  }
  return '';
}

export async function POST(request: Request) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) throw new AppError('BAD_REQUEST', parsed.error.message);

    const { chatId, messages } = parsed.data;

    const chat = await getChat(chatId);
    if (!chat) throw new AppError('CHAT_NOT_FOUND');

    const question = lastUserText(messages);

    // Title the chat from its first question, so the sidebar is readable.
    if (question) {
      const title = question.length > 60 ? `${question.slice(0, 57)}...` : question;
      await setChatTitleIfEmpty(chatId, title);
    }

    const retrieved = await retrieve({ chatId, query: question });

    // No context means there is nothing to ground an answer in, so calling the model could
    // only produce an ungrounded one. Answer directly instead: faster, cheaper, and it
    // removes the failure mode rather than relying on the prompt to prevent it. See D12.
    if (retrieved.length === 0) {
      const documents = await listDocuments(chatId);
      const reply = buildNoResultsReply(
        documents.filter((d) => d.status === 'ready').map((d) => d.filename),
      );

      return createUIMessageStreamResponse({
        stream: createUIMessageStream({
          originalMessages: messages,
          execute: ({ writer }) => {
            const id = generateId();
            writer.write({ type: 'text-start', id });
            writer.write({ type: 'text-delta', id, delta: reply });
            writer.write({ type: 'text-end', id });
          },
          onEnd: async ({ messages: updated }) => {
            await saveMessages({ chatId, messages: updated });
          },
        }),
      });
    }

    const tools = buildTools(retrieved);
    const sources = buildSources(retrieved);
    const modelMessages = await convertToModelMessages(messages);

    return createUIMessageStreamResponse({
      stream: createUIMessageStream<ChatMessage>({
        originalMessages: messages as ChatMessage[],
        // The SDK masks stream errors as "An error occurred." by default, which is right for
        // leaking server internals and wrong for the user: a rate limit is temporary and the
        // correct action is simply to wait. Map to our taxonomy so the UI can say which it is.
        onError: (error) => {
          const appError = toAppError(error);
          console.error(`[chat] ${appError.code}:`, appError.message);
          return appError.userMessage;
        },
        execute: ({ writer }) => {
          // Emit the retrieval set first, so the client can resolve inline [n] markers as
          // soon as the first token arrives rather than waiting for the answer to finish.
          writer.write({ type: 'data-sources', id: 'sources', data: sources });

          const result = streamText({
            model: google(CHAT_MODEL),
            system: buildSystemPrompt(retrieved),
            messages: modelMessages,
            tools,
            // Allows: call showEvidence -> receive its result -> write the final cited answer.
            stopWhen: stepCountIs(3),
          });

          writer.merge(toUIMessageStream({ stream: result.stream, tools }));
        },
        // Persistence happens on the server. Doing it client-side would lose the reply
        // whenever a stream is interrupted or the tab closes mid-answer — quietly breaking
        // "the conversation survives a reload". See docs/04-decisions.md D5.
        onEnd: async ({ messages: updated }) => {
          await saveMessages({ chatId, messages: updated });
        },
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
