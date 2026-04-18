import { env } from 'cloudflare:test';
import { inject, beforeAll, beforeEach } from 'vitest';

const AUTH_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, role TEXT DEFAULT 'viewer')",
  "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS user_integrations (username TEXT PRIMARY KEY, github_token TEXT, updated_at TEXT)",
  "CREATE TABLE IF NOT EXISTS server_settings (key TEXT PRIMARY KEY, value TEXT)",
];

beforeAll(async () => {
  const sql = inject('schemaSql');
  if (sql) {
    const stmts = sql.split(';').map((s: string) => s.trim()).filter(Boolean);
    if (stmts.length > 0) {
      await env.DB.batch(stmts.map((s: string) => env.DB.prepare(s)));
    }
  }
  await env.AUTH_DB.batch(AUTH_SCHEMA.map(s => env.AUTH_DB.prepare(s)));
});
