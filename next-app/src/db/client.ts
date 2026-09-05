/**
 * V1 PostgreSQL client — server only.
 *
 * - Reads V1_DATABASE_URL only (no fallback).
 * - Lazy init: missing env must not crash Legacy V0 import/build.
 * - Never log the connection string.
 * - Uses drizzle-orm/node-postgres + pg (provider-portable).
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type V1Db = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;
let db: V1Db | null = null;

function requireV1DatabaseUrl(): string {
  const url = process.env.V1_DATABASE_URL;
  if (!url || !url.trim()) {
    throw new Error(
      "V1_DATABASE_URL is not configured. V1 database access is unavailable."
    );
  }
  return url.trim();
}

/** Returns true when V1_DATABASE_URL is present (does not open a connection). */
export function isV1DbConfigured(): boolean {
  return Boolean(process.env.V1_DATABASE_URL?.trim());
}

/**
 * Lazy Drizzle client. Call only from server-side V1 code paths.
 * Existing Legacy routes must not import this module into user traffic.
 */
export function getV1Db(): V1Db {
  if (db) return db;

  const connectionString = requireV1DatabaseUrl();
  pool = new Pool({
    connectionString,
    // Neon and most hosted Postgres require TLS; rejectUnauthorized left default
    // for portability — providers that need relaxed SSL set it via URL params.
    max: 5,
  });
  db = drizzle(pool, { schema });
  return db;
}

/** Optional cleanup for scripts / tests. */
export async function closeV1Db(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
