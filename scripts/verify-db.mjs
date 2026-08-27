/**
 * Phase 1 gate: verify what actually landed in Neon.
 *
 * Checks the things that fail *silently* rather than loudly:
 *   - the `vector` extension exists (drizzle-kit does not emit it)
 *   - the embedding index is really HNSW, not a btree fallback
 *   - the full-text index is really GIN
 *   - content_tsv is a STORED generated column, not a plain nullable column
 *   - the vector column is 1536 dims (pgvector's HNSW limit is 2000)
 *
 * Run:  node --env-file=.env.local scripts/verify-db.mjs
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  console.error(`  FAIL  ${m}`);
  process.exitCode = 1;
};

console.log('\n1. pgvector extension');
const ext = await sql`SELECT extversion FROM pg_extension WHERE extname = 'vector'`;
if (ext.length > 0) pass(`installed, version ${ext[0].extversion}`);
else fail('the `vector` extension is missing — the migration did not create it');

console.log('\n2. Tables');
const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name`;
const names = tables.map((t) => t.table_name);
for (const expected of ['chats', 'chunks', 'documents', 'messages']) {
  if (names.includes(expected)) pass(expected);
  else fail(`${expected} is missing`);
}

console.log('\n3. Indexes on chunks');
const idx = await sql`
  SELECT i.relname AS name, am.amname AS method
  FROM pg_class t
  JOIN pg_index ix ON t.oid = ix.indrelid
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_am am ON i.relam = am.oid
  WHERE t.relname = 'chunks'
  ORDER BY i.relname`;
for (const row of idx) console.log(`     ${row.name}  ->  ${row.method}`);

const embeddingIdx = idx.find((r) => r.name === 'chunks_embedding_idx');
if (embeddingIdx?.method === 'hnsw') {
  pass('chunks_embedding_idx is hnsw');
} else {
  fail(
    `chunks_embedding_idx is "${embeddingIdx?.method ?? 'missing'}", expected hnsw. ` +
      `Vector search would fall back to a sequential scan.`,
  );
}

const tsvIdx = idx.find((r) => r.name === 'chunks_tsv_idx');
if (tsvIdx?.method === 'gin') pass('chunks_tsv_idx is gin');
else fail(`chunks_tsv_idx is "${tsvIdx?.method ?? 'missing'}", expected gin`);

console.log('\n4. chunks.content_tsv is a stored generated column');
const gen = await sql`
  SELECT is_generated, generation_expression
  FROM information_schema.columns
  WHERE table_name = 'chunks' AND column_name = 'content_tsv'`;
if (gen[0]?.is_generated === 'ALWAYS') {
  pass('generated ALWAYS ... STORED');
  console.log(`     expression: ${gen[0].generation_expression}`);
} else {
  fail('content_tsv is not a generated column — full-text search will index nothing');
}

console.log('\n5. Embedding dimensions');
const dims = await sql`
  SELECT format_type(a.atttypmod, NULL) AS raw, a.atttypmod
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  WHERE c.relname = 'chunks' AND a.attname = 'embedding'`;
if (dims[0]?.atttypmod === 1536) {
  pass('vector(1536)');
} else {
  fail(`expected 1536 dims, got ${dims[0]?.atttypmod}`);
}

console.log('\n6. Round-trip write/read');
try {
  const [chat] = await sql`INSERT INTO chats (title) VALUES ('__verify__') RETURNING id`;
  await sql`
    INSERT INTO messages (id, chat_id, role, parts)
    VALUES ('__verify_msg__', ${chat.id}, 'user',
            ${JSON.stringify([{ type: 'text', text: 'hello' }])}::jsonb)`;
  const [back] = await sql`SELECT parts FROM messages WHERE id = '__verify_msg__'`;
  const ok = back?.parts?.[0]?.text === 'hello';

  // Cascade should remove the message with the chat.
  await sql`DELETE FROM chats WHERE id = ${chat.id}`;
  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM messages WHERE id = '__verify_msg__'`;

  if (ok) pass('jsonb parts round-tripped intact');
  else fail('jsonb parts did not round-trip');

  if (count === 0) pass('ON DELETE CASCADE removed the child message');
  else fail('cascade delete did not fire — orphaned messages will accumulate');
} catch (err) {
  fail(`round-trip failed: ${err?.message ?? err}`);
}

console.log(
  process.exitCode === 1
    ? '\nFAILED — schema is not correct.\n'
    : '\nAll database checks passed.\n',
);
