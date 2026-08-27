/**
 * End-to-end RAG verification against the real database and the real embedding API.
 *
 * Ingests the sample PDF, runs realistic questions through hybrid retrieval, and asserts the
 * top result comes from the page the answer was actually written to. Cleans up after itself.
 *
 * This is the check that proves the pipeline end to end: chunking, embedding, normalisation,
 * the HNSW index, the lexical arm and RRF fusion all have to be right for it to pass.
 *
 * Run:  node --env-file=.env.local --import tsx scripts/verify-rag.mts
 */

import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';

import { db } from '../lib/db';
import { chunkBlocks } from '../lib/rag/chunk';
import { embedChunks, embedQuery } from '../lib/rag/embed';
import { parseDocument } from '../lib/rag/parse';
import { retrieve } from '../lib/rag/retrieve';
import { formatSource } from '../lib/rag/prompt';
import { createChat, createDocument, insertChunks, setDocumentStatus } from '../lib/db/queries';

let failures = 0;
const pass = (m: string) => console.log(`  PASS  ${m}`);
const fail = (m: string) => {
  console.error(`  FAIL  ${m}`);
  failures++;
};

const chatId = await createChat('__verify_rag__');
console.log(`\nTemp chat ${chatId}`);

try {
  /* ---------------------------------------------------------------- ingest */

  console.log('\n1. Ingest fixtures/acme-handbook.pdf');
  const bytes = new Uint8Array(readFileSync('fixtures/acme-handbook.pdf'));

  const documentId = await createDocument({
    chatId,
    filename: 'acme-handbook.pdf',
    mimeType: 'application/pdf',
    byteSize: bytes.byteLength,
    kind: 'pdf',
  });

  const started = Date.now();
  const { blocks, pageCount } = await parseDocument('pdf', bytes);
  const pending = chunkBlocks(blocks);
  const embeddings = await embedChunks(pending.map((c) => c.content));

  await insertChunks(
    pending.map((chunk, i) => ({
      documentId,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      pageFrom: chunk.pageFrom ?? null,
      pageTo: chunk.pageTo ?? null,
      section: chunk.section ?? null,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      embedding: embeddings[i]!,
    })),
  );
  await setDocumentStatus({ documentId, status: 'ready', pageCount });

  pass(`${pending.length} chunks from ${pageCount} pages in ${Date.now() - started}ms`);

  /* ------------------------------------------------------------- retrieval */

  console.log('\n2. Hybrid retrieval — does the top hit come from the right page?');

  const CASES = [
    { q: 'What is the refund window for enterprise customers?', page: 2 },
    { q: 'How quickly does support respond for enterprise?', page: 3 },
    { q: 'How long does onboarding take?', page: 4 },
    { q: 'What does ERR_2043 mean?', page: 5 },
  ];

  for (const { q, page } of CASES) {
    const results = await retrieve({ chatId, query: q });
    const top = results[0];

    if (!top) {
      fail(`"${q}" returned nothing`);
      continue;
    }

    const label = `"${q}"\n          top: ${formatSource(top)} (score ${top.score.toFixed(5)})`;
    if (top.pageFrom === page) pass(`${label}\n          expected p.${page} ✓`);
    else fail(`${label}\n          expected p.${page}, got p.${top.pageFrom}`);
  }

  /* ------------------------------------- does the lexical arm earn its keep? */

  console.log('\n3. Exact-token query: hybrid vs vector-only');
  const exact = 'ERR_2043';

  const hybrid = await retrieve({ chatId, query: exact });
  const embedding = await embedQuery(exact);
  const vectorOnly = await db.execute<{ page_from: number | null; content: string }>(sql`
    SELECT c.page_from, c.content
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE d.chat_id = ${chatId}::uuid AND d.status = 'ready'
    ORDER BY c.embedding <=> ${`[${embedding.join(',')}]`}::vector
    LIMIT 3
  `);

  const hybridTop = hybrid[0];
  const vectorTop = vectorOnly.rows[0];

  console.log(`     hybrid      top page: ${hybridTop?.pageFrom}`);
  console.log(`     vector-only top page: ${vectorTop?.page_from}`);

  if (hybridTop?.pageFrom === 5) pass('hybrid finds the error-code page');
  else fail(`hybrid returned p.${hybridTop?.pageFrom}, expected p.5`);

  const hybridRank = hybrid.findIndex((c) => c.content.includes(exact));
  const vectorRank = vectorOnly.rows.findIndex((r) => String(r.content).includes(exact));
  console.log(
    `     rank of the chunk literally containing "${exact}":  hybrid=${hybridRank}  vector-only=${vectorRank}`,
  );

  /* --------------------------------------------------- out-of-scope question */

  console.log('\n4. Out-of-scope question still returns something (no threshold by design)');
  const offTopic = await retrieve({ chatId, query: 'What is the capital of Peru?' });
  console.log(`     returned ${offTopic.length} chunks; top score ${offTopic[0]?.score.toFixed(5)}`);
  console.log('     -> grounding is enforced by the system prompt, not by a score cutoff (D12).');
  if (offTopic.length > 0) pass('retrieval degrades to "best available" rather than erroring');
  else fail('expected chunks to still be returned');
} finally {
  await db.execute(sql`DELETE FROM chats WHERE id = ${chatId}::uuid`);
  console.log(`\nCleaned up chat ${chatId}`);
}

console.log(failures === 0 ? '\nAll RAG checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
