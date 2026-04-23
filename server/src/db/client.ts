import { Pool, types } from 'pg';
import { config } from '../config';

// Parse BIGINT (OID 20) as JavaScript number.
// Safe for our use case — file sizes won't exceed 2^53.
types.setTypeParser(20, (value) => parseInt(value, 10));

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres error:', err.message);
});

export async function testConnection(): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const result = await pool.query('SELECT version()');
    return { ok: true, version: result.rows[0].version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function checkExtensions(): Promise<string[]> {
  const result = await pool.query(
    `SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')`
  );
  return result.rows.map((r) => r.extname);
}