import { env } from 'cloudflare:test';
import { inject, beforeAll } from 'vitest';

beforeAll(async () => {
  const sql = inject('schemaSql');
  if (!sql) return;
  const stmts = sql.split(';').map((s: string) => s.trim()).filter(Boolean);
  if (stmts.length === 0) return;
  await env.DB.batch(stmts.map((s: string) => env.DB.prepare(s)));
});
