import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatLocator, formatSource, buildContextBlock } from '../lib/rag/prompt';
import { buildSources, resolveCitations } from '../lib/rag/tools';
import type { RetrievedChunk } from '../lib/rag/types';

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: 'chunk-1',
    content: 'Enterprise customers may request a full refund within 45 days.',
    filename: 'handbook.pdf',
    kind: 'pdf',
    pageFrom: 2,
    pageTo: 2,
    section: null,
    charStart: 0,
    charEnd: 60,
    score: 0.5,
    ...overrides,
  };
}

const RETRIEVED: RetrievedChunk[] = [
  chunk({ id: 'a', content: 'Alpha passage.' }),
  chunk({ id: 'b', content: 'Beta passage.', pageFrom: 3, pageTo: 3 }),
  chunk({ id: 'c', content: 'Gamma passage.', pageFrom: 5, pageTo: 5 }),
];

describe('resolveCitations — a fabricated citation must be impossible', () => {
  it('maps 1-based indexes to the right chunks', () => {
    const citations = resolveCitations([1, 3], RETRIEVED);

    assert.equal(citations.length, 2);
    assert.equal(citations[0]?.chunkId, 'a');
    assert.equal(citations[1]?.chunkId, 'c');
  });

  it('drops an index beyond the retrieval set', () => {
    // The model inventing "[9]" must produce nothing, not a broken or guessed citation.
    const citations = resolveCitations([1, 9, 42], RETRIEVED);

    assert.equal(citations.length, 1);
    assert.equal(citations[0]?.chunkId, 'a');
  });

  it('drops zero and negative indexes', () => {
    assert.equal(resolveCitations([0, -1], RETRIEVED).length, 0);
  });

  it('returns nothing when there is no retrieval set at all', () => {
    assert.equal(resolveCitations([1, 2, 3], []).length, 0);
  });

  it('de-duplicates repeated indexes', () => {
    const citations = resolveCitations([2, 2, 2], RETRIEVED);
    assert.equal(citations.length, 1);
    assert.equal(citations[0]?.chunkId, 'b');
  });

  it('takes the excerpt from the chunk, never from anywhere else', () => {
    const citations = resolveCitations([2], RETRIEVED);
    assert.equal(citations[0]?.excerpt, 'Beta passage.');
  });

  it('buildSources numbers every retrieved chunk in context order', () => {
    const sources = buildSources(RETRIEVED);

    assert.deepEqual(
      sources.map((source) => source.index),
      [1, 2, 3],
    );
    assert.deepEqual(
      sources.map((source) => source.chunkId),
      ['a', 'b', 'c'],
    );
  });
});

describe('formatLocator — degrade honestly', () => {
  it('shows a page for a PDF', () => {
    assert.equal(formatLocator(chunk({ pageFrom: 12, pageTo: 12 })), 'p. 12');
  });

  it('shows a heading path for Markdown', () => {
    const locator = formatLocator(
      chunk({ kind: 'md', pageFrom: null, pageTo: null, section: 'Setup > Environment' }),
    );
    assert.equal(locator, 'Setup › Environment');
  });

  it('returns null for plain text rather than inventing a page', () => {
    const locator = formatLocator(
      chunk({ kind: 'txt', pageFrom: null, pageTo: null, section: null }),
    );
    assert.equal(locator, null);
  });

  it('falls back to the filename alone when there is no locator', () => {
    const source = formatSource(
      chunk({ kind: 'txt', filename: 'notes.txt', pageFrom: null, pageTo: null, section: null }),
    );
    assert.equal(source, 'notes.txt');
  });
});

describe('buildContextBlock', () => {
  it('numbers blocks from 1 and labels each with its source', () => {
    const block = buildContextBlock(RETRIEVED);

    assert.match(block, /^\[1\] \(handbook\.pdf · p\. 2\)/);
    assert.ok(block.includes('[2] (handbook.pdf · p. 3)'));
    assert.ok(block.includes('[3] (handbook.pdf · p. 5)'));
  });

  it('never leaks chunk ids to the model', () => {
    // The model must only be able to reference [n]. If it could see an id, it could invent one.
    const block = buildContextBlock(RETRIEVED);

    for (const id of ['a', 'b', 'c']) {
      assert.ok(!block.includes(`id: ${id}`), 'context block must not contain chunk ids');
    }
    assert.ok(!block.includes('chunkId'));
  });
});
