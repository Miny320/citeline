import { defineConfig } from 'drizzle-kit';

/**
 * `drizzle-kit generate` only reads the schema, so it must work before a database exists —
 * that is how the migration gets written in the first place. `push` and `studio` do need a
 * live connection and will fail loudly on an empty URL, which is the correct behaviour.
 */
const url = process.env.DATABASE_URL ?? '';

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
