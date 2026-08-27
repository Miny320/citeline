import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chunkBlocks } from '../lib/rag/chunk';
import { parseMarkdown, parsePdf, parseText } from '../lib/rag/parse';
import { AppError } from '../lib/errors';

const samplePdf = new Uint8Array(readFileSync('fixtures/acme-handbook.pdf'));

/**
 * Facts written to known pages by scripts/make-sample-pdf.mjs.
 *
 * This is the assertion that matters most in the whole build: a citation is only worth
 * anything if the page number is genuinely the page the text came from.
 */
const PAGE_FACTS: Array<{ needle: string; page: number }> = [
  { needle: 'CUSTOMER HANDBOOK', page: 1 },
  { needle: '45', page: 2 },
  { needle: '2-hour response SLA', page: 3 },
  { needle: 'three weeks', page: 4 },
  { needle: 'ERR_2043', page: 5 },
];

describe('parsePdf', () => {
  it('extracts one block per page with 1-indexed page numbers', async () => {
    const { blocks, pageCount } = await parsePdf(samplePdf);

    assert.equal(pageCount, 5);
    assert.equal(blocks.length, 5);
    assert.deepEqual(
      blocks.map((b) => b.page),
      [1, 2, 3, 4, 5],
    );
  });

  it('puts each known fact on the page it was written to', async () => {
    const { blocks } = await parsePdf(samplePdf);

    for (const { needle, page } of PAGE_FACTS) {
      const matches = blocks.filter((b) => b.text.includes(needle));
      assert.ok(matches.length > 0, `"${needle}" was not found in any page`);
      assert.equal(
        matches[0]?.page,
        page,
        `"${needle}" should be on page ${page}, found on page ${matches[0]?.page}`,
      );
    }
  });

  it('produces ascending, non-overlapping char offsets', async () => {
    const { blocks } = await parsePdf(samplePdf);

    let previousEnd = -1;
    for (const block of blocks) {
      assert.ok(block.charEnd > block.charStart, 'charEnd must exceed charStart');
      assert.ok(block.charStart >= previousEnd, 'blocks must not overlap');
      previousEnd = block.charEnd;
    }
  });

  it('rejects a file that is not a PDF', async () => {
    await assert.rejects(
      () => parsePdf(new TextEncoder().encode('this is plainly not a pdf')),
      (error: unknown) => error instanceof AppError && error.code === 'PARSE_FAILED',
    );
  });
});

describe('chunkBlocks over a real PDF', () => {
  it('never lets a chunk span two pages', async () => {
    const { blocks } = await parsePdf(samplePdf);
    const chunks = chunkBlocks(blocks);

    assert.ok(chunks.length > 0);
    for (const chunk of chunks) {
      assert.equal(
        chunk.pageFrom,
        chunk.pageTo,
        `chunk ${chunk.chunkIndex} spans pages ${chunk.pageFrom}-${chunk.pageTo}`,
      );
      assert.ok(chunk.pageFrom !== undefined, 'PDF chunks must carry a page');
    }
  });

  it('keeps chunkIndex dense and ascending', async () => {
    const { blocks } = await parsePdf(samplePdf);
    const chunks = chunkBlocks(blocks);

    chunks.forEach((chunk, i) => assert.equal(chunk.chunkIndex, i));
  });

  it('preserves page attribution through chunking', async () => {
    const { blocks } = await parsePdf(samplePdf);
    const chunks = chunkBlocks(blocks);

    for (const { needle, page } of PAGE_FACTS) {
      const hit = chunks.find((c) => c.content.includes(needle));
      assert.ok(hit, `"${needle}" survived parsing but was lost in chunking`);
      assert.equal(hit.pageFrom, page, `"${needle}" cited as page ${hit.pageFrom}, expected ${page}`);
    }
  });

  it('produces offsets that are truthful', async () => {
    const { blocks } = await parsePdf(samplePdf);
    const chunks = chunkBlocks(blocks);

    for (const chunk of chunks) {
      assert.ok(chunk.charEnd > chunk.charStart, `chunk ${chunk.chunkIndex} has an empty span`);
    }
  });
});

describe('chunkBlocks splitting behaviour', () => {
  const longBlock = (text: string) => [{ text, charStart: 0, charEnd: text.length }];

  it('returns a single chunk when the text fits', () => {
    const chunks = chunkBlocks(longBlock('Short enough to stay whole.'));
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.content, 'Short enough to stay whole.');
  });

  it('splits long text into overlapping chunks', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const chunks = chunkBlocks(longBlock(sentence.repeat(120)));

    assert.ok(chunks.length > 1, 'long text should split');
    for (const chunk of chunks) {
      assert.ok(chunk.content.length <= 1400, `chunk ${chunk.chunkIndex} is oversized`);
    }
  });

  it('terminates on text with no whitespace at all', () => {
    // A pathological input: no sentence ends, no spaces to break on. The loop must still
    // make progress rather than hang.
    const chunks = chunkBlocks(longBlock('x'.repeat(5000)));
    assert.ok(chunks.length > 1);
    chunks.forEach((chunk, i) => assert.equal(chunk.chunkIndex, i));
  });

  it('does not emit a tiny trailing fragment', () => {
    const sentence = 'Alpha beta gamma delta epsilon zeta eta theta. ';
    const chunks = chunkBlocks(longBlock(sentence.repeat(60)));
    const last = chunks[chunks.length - 1];

    assert.ok(last);
    assert.ok(
      chunks.length === 1 || last.content.length >= 200,
      `trailing chunk is only ${last.content.length} chars`,
    );
  });
});

describe('parseMarkdown', () => {
  const source = [
    '# Setup',
    '',
    'Intro paragraph under the top heading.',
    '',
    '## Environment',
    '',
    'Set the variables before running.',
    '',
    '### Secrets',
    '',
    'Never commit a key.',
    '',
    '## Deployment',
    '',
    'Push to main.',
  ].join('\n');

  it('builds a full heading path', () => {
    const blocks = parseMarkdown(source);
    const secrets = blocks.find((b) => b.text.includes('Never commit'));

    assert.equal(secrets?.section, 'Setup > Environment > Secrets');
  });

  it('pops the heading stack when depth decreases', () => {
    const blocks = parseMarkdown(source);
    const deployment = blocks.find((b) => b.text.includes('Push to main'));

    // Must be "Setup > Deployment", NOT "Setup > Environment > Secrets > Deployment".
    assert.equal(deployment?.section, 'Setup > Deployment');
  });

  it('ignores hashes inside fenced code blocks', () => {
    const withFence = ['# Real', '', '```bash', '# not a heading', 'echo hi', '```', '', 'Body.'].join(
      '\n',
    );
    const blocks = parseMarkdown(withFence);

    assert.ok(blocks.every((b) => b.section === 'Real'));
  });

  it('rejects an empty document', () => {
    assert.throws(
      () => parseMarkdown('   \n\n  '),
      (error: unknown) => error instanceof AppError && error.code === 'EMPTY_DOCUMENT',
    );
  });
});

describe('parseText', () => {
  it('splits on blank lines and records offsets', () => {
    const source = 'First paragraph.\n\nSecond paragraph.\n\nThird.';
    const blocks = parseText(source);

    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]?.charStart, 0);
    for (const block of blocks) {
      assert.equal(block.page, undefined, 'plain text has no page');
      assert.equal(block.section, undefined, 'plain text has no section');
    }
  });

  it('rejects an empty document', () => {
    assert.throws(
      () => parseText('\n\n   \n'),
      (error: unknown) => error instanceof AppError && error.code === 'EMPTY_DOCUMENT',
    );
  });
});
