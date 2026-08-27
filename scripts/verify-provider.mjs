/**
 * Phase 0 gate: prove the provider works before any real code depends on it.
 *
 * Checks four things that are cheap to verify now and expensive to discover at hour four:
 *   1. The Gemini chat model id actually exists and responds.
 *   2. Embeddings come back at exactly 1536 dimensions (pgvector HNSW caps at 2000;
 *      the model's default is 3072).
 *   3. Vectors are unit-length AFTER normalisation.
 *   4. Semantic similarity is real — a paraphrase scores high, an unrelated sentence
 *      scores low. This is the check that catches a silently broken embedding pipeline.
 *
 * Run:  node --env-file=.env.local scripts/verify-provider.mjs
 */

import { google } from '@ai-sdk/google';
import { embedMany, generateText } from 'ai';

const CHAT_MODEL = process.env.CHAT_MODEL ?? 'gemini-3.6-flash';
const EMBEDDING_MODEL = 'gemini-embedding-001';
const DIMS = 1536;

const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  console.error(`  FAIL  ${m}`);
  process.exitCode = 1;
};

function l2normalise(v) {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.error('GOOGLE_GENERATIVE_AI_API_KEY is not set. See .env.example.');
  process.exit(1);
}

console.log(`\n1. Chat model: ${CHAT_MODEL}`);
try {
  const { text } = await generateText({
    model: google(CHAT_MODEL),
    prompt: 'Reply with exactly the word: ready',
  });
  pass(`responded: ${JSON.stringify(text.trim().slice(0, 40))}`);
} catch (err) {
  fail(`${err?.message ?? err}`);
  console.error('\n  -> If this is a 404, the model id is wrong or unavailable on your key.');
  console.error('     List available models at https://aistudio.google.com/\n');
}

console.log(`\n2. Embedding model: ${EMBEDDING_MODEL} at ${DIMS} dims`);
let vectors = null;
try {
  const { embeddings } = await embedMany({
    model: google.embedding(EMBEDDING_MODEL),
    values: [
      'The cat sat on the mat.',
      'A feline rested upon the rug.',
      'Quarterly revenue increased by twelve percent.',
    ],
    providerOptions: { google: { outputDimensionality: DIMS } },
  });
  vectors = embeddings;

  if (embeddings[0].length === DIMS) {
    pass(`dimensionality is ${DIMS}`);
  } else {
    fail(
      `expected ${DIMS} dims, got ${embeddings[0].length}. ` +
        `pgvector HNSW supports max 2000 — the schema will not index this.`,
    );
  }
} catch (err) {
  fail(`${err?.message ?? err}`);
}

if (vectors) {
  console.log('\n3. Normalisation');
  const raw = Math.sqrt(vectors[0].reduce((s, x) => s + x * x, 0));
  const normed = l2normalise(vectors[0]);
  const normedLen = Math.sqrt(normed.reduce((s, x) => s + x * x, 0));
  console.log(`     raw L2 norm:        ${raw.toFixed(4)}`);
  console.log(`     normalised L2 norm: ${normedLen.toFixed(4)}`);
  if (Math.abs(normedLen - 1) < 1e-6) {
    pass('vectors are unit-length after normalisation');
  } else {
    fail('normalisation is not producing unit vectors');
  }
  if (Math.abs(raw - 1) > 0.01) {
    console.log(
      '     NOTE: raw vectors are NOT unit-length (expected for truncated Gemini output).',
    );
    console.log('           This is exactly why embed.ts must normalise before storing.');
  }

  console.log('\n4. Semantic similarity');
  const [a, b, c] = vectors.map(l2normalise);
  const similar = dot(a, b);
  const unrelated = dot(a, c);
  console.log(`     paraphrase pair:  ${similar.toFixed(4)}`);
  console.log(`     unrelated pair:   ${unrelated.toFixed(4)}`);

  if (similar > 0.6) pass('paraphrase similarity is high');
  else fail(`paraphrase similarity ${similar.toFixed(4)} is too low (expected > 0.6)`);

  if (similar - unrelated > 0.15) {
    pass('paraphrase clearly separates from unrelated text');
  } else {
    fail(
      `separation is only ${(similar - unrelated).toFixed(4)}. ` +
        `Retrieval will be near-random — check dimensionality and normalisation.`,
    );
  }
}

console.log(
  process.exitCode === 1
    ? '\nFAILED — do not start Phase 1 until this passes.\n'
    : '\nAll provider checks passed.\n',
);
