import { google } from '@ai-sdk/google';
import { streamText, type TextStreamPart, type ToolSet } from 'ai';

import { toAppError } from '@/lib/errors';

type StreamTextArgs<TOOLS extends ToolSet> = Parameters<typeof streamText<TOOLS>>[0];

export interface FallbackStream<TOOLS extends ToolSet> {
  stream: ReadableStream<TextStreamPart<TOOLS>>;
  /** The model that actually produced the stream. */
  model: string;
}

/**
 * Start a stream, falling back to the next model when the current one is rate-limited.
 *
 * Google meters free-tier quota per model — an exhausted `gemini-3.6-flash` reports
 * "limit: 20, model: gemini-3.6-flash" and says nothing about the others — so falling back
 * keeps the app answering after the primary quota is spent. That matters when the reviewer's
 * session is the one that runs into it.
 *
 * The catch is that a stream cannot be un-sent: once a token reaches the reader, switching
 * models would restart the answer mid-sentence. So the first chunk is read *before* anything
 * is handed back. A provider rejection surfaces on that first read, which is exactly the
 * point where switching is still invisible. After that the model is committed and any later
 * failure propagates normally.
 *
 * Only rate limits trigger a fallback. A malformed request or a bad key fails identically on
 * every model, so retrying would only be slower.
 */
export async function streamTextWithFallback<TOOLS extends ToolSet>(
  models: readonly string[],
  options: Omit<StreamTextArgs<TOOLS>, 'model'>,
): Promise<FallbackStream<TOOLS>> {
  let lastError: unknown;

  for (const [index, model] of models.entries()) {
    const result = streamText<TOOLS>({
      ...options,
      model: google(model),
    } as StreamTextArgs<TOOLS>);

    const reader = result.stream.getReader();

    try {
      // The stream opens with bookkeeping parts before the provider is really committed --
      // a failed request still emits `start` first, and the error only arrives after it.
      // Probing just the first chunk would therefore commit to a model that is about to
      // fail, so read through the prelude until real content or an error appears.
      const prelude: TextStreamPart<TOOLS>[] = [];
      let finished = false;

      for (;;) {
        const chunk = await reader.read();

        if (chunk.done) {
          finished = true;
          break;
        }

        // Failures arrive as an error *part* rather than a rejected read.
        if (chunk.value.type === 'error') {
          throw chunk.value.error ?? new Error('stream error part');
        }

        prelude.push(chunk.value);
        if (chunk.value.type !== 'start' && chunk.value.type !== 'start-step') break;
      }

      if (index > 0) console.warn(`[chat] primary rate-limited; answered with ${model}`);

      // Replay what we consumed, then pass the rest through untouched.
      return {
        model,
        stream: new ReadableStream<TextStreamPart<TOOLS>>({
          start(controller) {
            for (const part of prelude) controller.enqueue(part);
            if (finished) controller.close();
          },
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) controller.close();
              else controller.enqueue(next.value);
            } catch (error) {
              controller.error(error);
            }
          },
          cancel(reason) {
            void reader.cancel(reason).catch(() => {});
          },
        }),
      };
    } catch (error) {
      void reader.cancel().catch(() => {});
      lastError = error;

      if (toAppError(error).code !== 'RATE_LIMITED') throw error;
      console.warn(`[chat] ${model} rate-limited, trying next model`);
    }
  }

  throw lastError ?? new Error('no chat model available');
}
