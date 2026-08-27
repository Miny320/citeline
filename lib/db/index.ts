import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and add your Neon connection string.',
  );
}

/**
 * Neon over HTTP rather than WebSocket.
 *
 * Every query in this app is a single round-trip with no transaction spanning requests,
 * which is exactly the case the HTTP driver is cheapest for in a serverless runtime.
 */
export const db = drizzle(neon(process.env.DATABASE_URL), { schema });

export { schema };
