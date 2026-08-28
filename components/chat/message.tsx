'use client';

import { EvidenceCards } from '@/components/evidence/evidence-card';
import { Markdown } from '@/components/markdown';
import type { ChatMessage } from '@/lib/chat-types';
import type { Citation } from '@/lib/rag/types';

interface MessageViewProps {
  message: ChatMessage;
  isStreaming: boolean;
  onCitationClick: (citation: Citation) => void;
}

/**
 * Render one message from its parts.
 *
 * Every tool state is handled explicitly, including `output-error`. Skipping that branch is
 * how a failed tool call renders as a blank message — which only ever shows up in a demo.
 */
export function MessageView({ message, isStreaming, onCitationClick }: MessageViewProps) {
  if (message.role === 'user') return <UserMessage message={message} />;

  // Sources arrive as a data part before the first token, so inline [n] markers resolve as
  // the answer streams, and still resolve after a reload because data parts are persisted.
  const sources: Citation[] = message.parts.flatMap((part) =>
    part.type === 'data-sources' ? part.data : [],
  );

  const hasText = message.parts.some((part) => part.type === 'text' && part.text.trim() !== '');

  return (
    <article className="group flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-[0.65rem] font-bold text-accent"
      >
        C
      </span>

      <div className="min-w-0 flex-1 text-[0.9rem] leading-[1.7] text-foreground">
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            if (part.text.trim() === '') return null;
            return (
              <div key={`text-${index}`}>
                <Markdown text={part.text} sources={sources} onCitationClick={onCitationClick} />
              </div>
            );
          }

          if (part.type === 'tool-showEvidence') {
            switch (part.state) {
              case 'input-streaming':
              case 'input-available':
                return (
                  <p
                    key={`tool-${index}`}
                    className="my-2 flex items-center gap-2 text-[0.8rem] text-subtle"
                  >
                    <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
                    Gathering supporting passages…
                  </p>
                );
              case 'output-available':
                return (
                  <EvidenceCards
                    key={`tool-${index}`}
                    claims={part.output.claims}
                    onCitationClick={onCitationClick}
                  />
                );
              case 'output-error':
                return (
                  <p
                    key={`tool-${index}`}
                    className="my-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-[0.8rem] text-danger"
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

        {isStreaming && !hasText ? (
          <p className="my-2 flex items-center gap-2 text-[0.8rem] text-subtle">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
            Reading the document…
          </p>
        ) : null}

        {sources.length > 0 ? <SourceFooter sources={sources} onSelect={onCitationClick} /> : null}
      </div>
    </article>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n');

  return (
    <article className="flex justify-end">
      <p className="m-0 max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[0.88rem] leading-relaxed whitespace-pre-wrap text-accent-foreground">
        {text}
      </p>
    </article>
  );
}

/** The passages consulted for this answer, whether or not the model cited each one. */
function SourceFooter({
  sources,
  onSelect,
}: {
  sources: Citation[];
  onSelect: (citation: Citation) => void;
}) {
  return (
    <details className="mt-3 border-t border-border pt-2">
      <summary className="cursor-pointer list-none text-[0.72rem] text-subtle transition-colors hover:text-muted">
        Consulted {sources.length} passage{sources.length === 1 ? '' : 's'} ·{' '}
        <span className="underline underline-offset-2">show all</span>
      </summary>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
        {sources.map((citation) => (
          <li key={citation.chunkId}>
            <button
              type="button"
              onClick={() => onSelect(citation)}
              className="rounded border border-border px-2 py-1 text-[0.7rem] text-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              {citation.index}. {citation.locator ?? citation.filename}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
