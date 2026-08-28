import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Markdown } from '../components/markdown';
import type { Citation } from '../lib/rag/types';

const SOURCES: Citation[] = [
  {
    chunkId: 'a',
    index: 1,
    filename: 'handbook.pdf',
    locator: 'p. 2',
    excerpt: 'Enterprise customers may request a full refund within 45 days.',
  },
  {
    chunkId: 'b',
    index: 2,
    filename: 'handbook.pdf',
    locator: 'p. 5',
    excerpt: 'ERR_2043 indicates that the uploaded file exceeded the maximum size.',
  },
];

const render = (text: string, sources: Citation[] = SOURCES) =>
  renderToStaticMarkup(createElement(Markdown, { text, sources }));

describe('Markdown — the syntax must not reach the user', () => {
  it('renders bold instead of literal asterisks', () => {
    const html = render('A refund within **45 days** applies.');

    assert.ok(html.includes('<strong'), 'expected a <strong> element');
    assert.ok(html.includes('45 days'));
    assert.ok(!html.includes('**'), 'literal ** leaked into the output');
  });

  it('renders inline code instead of literal backticks', () => {
    const html = render('The code `ERR_2043` means the file was too large.');

    assert.ok(html.includes('<code'), 'expected a <code> element');
    assert.ok(html.includes('ERR_2043'));
    assert.ok(!html.includes('`'), 'literal backticks leaked into the output');
  });

  it('renders italics', () => {
    const html = render('This is *emphasised* text.');
    assert.ok(html.includes('<em'), 'expected an <em> element');
  });

  it('renders bullet lists', () => {
    const html = render('Terms:\n\n- First item\n- Second item\n');

    assert.ok(html.includes('<ul'), 'expected a <ul>');
    assert.equal((html.match(/<li/g) ?? []).length, 2);
    assert.ok(!/>\s*-\s/.test(html), 'literal dash bullets leaked');
  });

  it('renders numbered lists', () => {
    const html = render('Steps:\n\n1. Do this\n2. Then that\n');

    assert.ok(html.includes('<ol'), 'expected an <ol>');
    assert.equal((html.match(/<li/g) ?? []).length, 2);
  });

  it('renders headings', () => {
    const html = render('## Refunds\n\nBody text.');

    assert.ok(/<h[34]/.test(html), 'expected a heading element');
    assert.ok(!html.includes('## '), 'literal hashes leaked');
  });

  it('renders fenced code blocks without treating their contents as markdown', () => {
    const html = render('Example:\n\n```ts\nconst x = **notBold**;\n```\n');

    assert.ok(html.includes('<pre'), 'expected a <pre>');
    assert.ok(html.includes('**notBold**'), 'code block contents must stay literal');
  });

  it('renders blockquotes', () => {
    const html = render('> Quoted line');
    assert.ok(html.includes('<blockquote'), 'expected a <blockquote>');
  });

  it('keeps paragraphs separate', () => {
    const html = render('First paragraph.\n\nSecond paragraph.');
    assert.equal((html.match(/<p/g) ?? []).length, 2);
  });
});

describe('Markdown — citations inside formatted text', () => {
  it('turns a [n] marker into a chip', () => {
    const html = render('Refunds take 45 days [1].');

    assert.ok(html.includes('<button'), 'expected a citation chip button');
    assert.ok(html.includes('Source 1: handbook.pdf · p. 2'), 'chip must expose its source');
    assert.ok(!html.includes('[1]'), 'the raw marker should be replaced');
  });

  it('resolves several markers in one sentence', () => {
    const html = render('Both apply [1][2].');
    assert.equal((html.match(/<button/g) ?? []).length, 2);
  });

  it('leaves an unmatched marker as plain text rather than a dead chip', () => {
    // The model can only cite within the retrieved set, so [9] means something went wrong.
    // Rendering a chip that resolves to nothing would be worse than showing the raw marker.
    const html = render('Something unsupported [9].');

    assert.ok(html.includes('[9]'), 'unmatched marker should remain visible');
    assert.ok(!html.includes('<button'), 'no chip should be rendered for it');
  });

  it('renders citations inside list items', () => {
    const html = render('- Refund window is 45 days [1]\n- Error code meaning [2]\n');

    assert.ok(html.includes('<ul'));
    assert.equal((html.match(/<button/g) ?? []).length, 2);
  });

  it('does not mistake a markdown link for a citation', () => {
    const html = render('See [the docs](https://example.com) for more.');

    assert.ok(html.includes('<a '), 'expected an anchor');
    assert.ok(html.includes('https://example.com'));
    assert.ok(!html.includes('<button'), 'a link must not become a citation chip');
  });

  it('renders nothing as a chip when there are no sources', () => {
    const html = render('A claim [1].', []);

    assert.ok(html.includes('[1]'));
    assert.ok(!html.includes('<button'));
  });
});
