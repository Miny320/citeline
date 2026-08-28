'use client';

import type { ReactNode } from 'react';

import { CitationChip } from '@/components/evidence/citation-chip';
import type { Citation } from '@/lib/rag/types';

/**
 * A small markdown renderer that keeps citation chips inline.
 *
 * Written rather than pulled in, because the requirement is unusual: `[1]` citation markers
 * have to interleave with inline formatting and be rendered as interactive components, while
 * `[text](url)` links must still work. A general markdown library would either escape the
 * markers or require re-parsing its output to find them.
 *
 * Scope is deliberately what the model actually emits: paragraphs, headings, bullet and
 * numbered lists, bold, italic, inline code, fenced code, and blockquotes.
 */
export function Markdown({
  text,
  sources,
  onCitationClick,
}: {
  text: string;
  sources: Citation[];
  onCitationClick?: (citation: Citation) => void;
}) {
  return <>{renderBlocks(text, sources, onCitationClick)}</>;
}

type Ctx = {
  sources: Citation[];
  onCitationClick: ((citation: Citation) => void) | undefined;
};

function renderBlocks(
  text: string,
  sources: Citation[],
  onCitationClick?: (citation: Citation) => void,
): ReactNode[] {
  const ctx: Ctx = { sources, onCitationClick };
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];

  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Fenced code block
    if (/^\s*```/.test(line)) {
      const language = line.replace(/^\s*```/, '').trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i++;
      }
      i++; // closing fence
      blocks.push(
        <pre
          key={key++}
          className="my-3 overflow-x-auto rounded-lg border border-border bg-surface-muted p-3 text-[0.78rem] leading-relaxed"
        >
          <code data-language={language || undefined}>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Heading
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const depth = heading[1]?.length ?? 1;
      const content = inline(heading[2] ?? '', ctx);
      const className =
        depth <= 2
          ? 'mt-4 mb-2 text-[0.95rem] font-semibold text-foreground first:mt-0'
          : 'mt-3 mb-1.5 text-[0.85rem] font-semibold text-foreground first:mt-0';
      blocks.push(
        depth <= 2 ? (
          <h3 key={key++} className={className}>
            {content}
          </h3>
        ) : (
          <h4 key={key++} className={className}>
            {content}
          </h4>
        ),
      );
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) {
        body.push((lines[i] ?? '').replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-3 border-l-2 border-border-strong pl-3 text-muted italic"
        >
          {inline(body.join(' '), ctx)}
        </blockquote>,
      );
      continue;
    }

    // Lists — consecutive bullet or numbered items
    const isBullet = (value: string) => /^\s*[-*+]\s+/.test(value);
    const isNumbered = (value: string) => /^\s*\d+[.)]\s+/.test(value);

    if (isBullet(line) || isNumbered(line)) {
      const ordered = isNumbered(line);
      const items: ReactNode[] = [];

      while (i < lines.length) {
        const current = lines[i] ?? '';
        const matches = ordered ? isNumbered(current) : isBullet(current);
        if (!matches) break;

        const content = current.replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/, '');
        items.push(
          <li key={items.length} className="pl-1">
            {inline(content, ctx)}
          </li>,
        );
        i++;
      }

      blocks.push(
        ordered ? (
          <ol key={key++} className="my-2 ml-5 list-decimal space-y-1 marker:text-subtle">
            {items}
          </ol>
        ) : (
          <ul key={key++} className="my-2 ml-5 list-disc space-y-1 marker:text-subtle">
            {items}
          </ul>
        ),
      );
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — consume until a blank line or a block-level construct
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i] ?? '';
      if (
        current.trim() === '' ||
        /^\s*```/.test(current) ||
        /^(#{1,4})\s+/.test(current) ||
        /^\s*>\s?/.test(current) ||
        isBullet(current) ||
        isNumbered(current)
      ) {
        break;
      }
      paragraph.push(current);
      i++;
    }

    blocks.push(
      <p key={key++} className="my-2 first:mt-0 last:mb-0">
        {inline(paragraph.join(' '), ctx)}
      </p>,
    );
  }

  return blocks;
}

/**
 * Inline formatting, resolved in one pass.
 *
 * Order matters: code spans are taken first so formatting inside them stays literal, and
 * links are taken before citations so `[label](url)` is never mistaken for a `[1]` marker.
 */
function inline(text: string, ctx: Ctx): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))|(\[(\d{1,2})\])/g;

  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];

    if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key++}
          className="rounded border border-border bg-surface-muted px-1 py-0.5 font-mono text-[0.8em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(
        <strong key={key++} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (match[7] !== undefined) {
      // Citation marker
      const citation = ctx.sources.find((source) => source.index === Number(match?.[7]));
      if (citation) {
        nodes.push(
          <CitationChip
            key={key++}
            citation={citation}
            {...(ctx.onCitationClick ? { onOpen: ctx.onCitationClick } : {})}
          />,
        );
      } else {
        // No matching source: show the raw marker rather than a dead chip. The model can only
        // cite within the retrieved set, so an unmatched number means something went wrong.
        nodes.push(token);
      }
    } else {
      // Link
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a
            key={key++}
            href={link[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2"
          >
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
