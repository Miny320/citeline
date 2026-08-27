'use client';

import { CitedText } from '@/components/evidence/citation-chip';
import { EvidenceCards } from '@/components/evidence/evidence-card';
import type { ChatMessage } from '@/lib/chat-types';
import type { Citation } from '@/lib/rag/types';

/**
 * Render one message from its parts.
 *
 * Every tool state is handled explicitly, including `output-error`. Skipping that branch is
 * how a failed tool call renders as a blank message — which only ever shows up in a demo.
 */
export function MessageView({ message, isStreaming }: { message: ChatMessage; isStreaming: boolean }) {
  const isUser = message.role === 'user';

  // Sources arrive as a data part before the first token, so inline [n] markers resolve as
  // the answer streams, and still resolve after a reload because data parts are persisted.
  const sources: Citation[] = message.parts.flatMap((part) =>
    part.type === 'data-sources' ? part.data : [],
  );

  const textParts = message.parts.filter((part) => part.type === 'text');
  const lastTextIndex = textParts.length - 1;

  return (
    <article className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={isUser ? 'max-w-[85%]' : 'w-full max-w-none'}>
        <div
          className={
            isUser
              ? 'rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap text-accent-foreground'
              : 'text-[0.9rem] leading-relaxed text-foreground'
          }
        >
          {message.parts.map((part, index) => {
            if (part.type === 'text') {
              const isLastText = textParts.indexOf(part) === lastTextIndex;
              return (
                <p
                  key={`text-${index}`}
                  className={`m-0 whitespace-pre-wrap ${index > 0 ? 'mt-3' : ''} ${
                    isStreaming && isLastText && !isUser ? 'streaming-caret' : ''
                  }`}
                >
                  {isUser ? part.text : <CitedText text={part.text} sources={sources} />}
                </p>
              );
            }

            if (part.type === 'tool-showEvidence') {
              switch (part.state) {
                case 'input-streaming':
                case 'input-available':
                  return (
                    <p key={`tool-${index}`} className="mt-3 text-[0.8rem] text-subtle animate-pulse-soft">
                      Gathering supporting passages…
                    </p>
                  );
                case 'output-available':
                  return <EvidenceCards key={`tool-${index}`} claims={part.output.claims} />;
                case 'output-error':
                  return (
                    <p
                      key={`tool-${index}`}
                      className="mt-3 rounded-md bg-danger-soft px-2.5 py-1.5 text-[0.8rem] text-danger"
                    >
                      Couldn&apos;t assemble the evidence cards. The answer above still stands.
                    </p>
                  );
                default:
                  return null;
              }
            }

            return null;
          })}
        </div>

        {!isUser && sources.length > 0 ? <SourceFooter sources={sources} /> : null}
      </div>
    </article>
  );
}

/** The passages consulted for this answer, whether or not the model cited each one. */
function SourceFooter({ sources }: { sources: Citation[] }) {
  const files = [...new Set(sources.map((source) => source.filename))];

  return (
    <p className="mt-2 text-[0.7rem] text-subtle">
      Answered from {sources.length} passage{sources.length === 1 ? '' : 's'} in {files.join(', ')}
    </p>
  );
}
