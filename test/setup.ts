import { env } from "cloudflare:test";

export const SESSION_ID = "sess-alice";
export const OWNER_SESSION_ID = "sess-owner";

export async function seedSchema() {
  // editor DB
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', owner TEXT NOT NULL DEFAULT '', git_repo TEXT DEFAULT '', git_branch TEXT DEFAULT 'main', created_at TEXT DEFAULT (datetime('now')))"
  );
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL, username TEXT NOT NULL, role TEXT DEFAULT 'editor', joined_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (project_id, username))"
  );
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, project_id TEXT NOT NULL)"
  );
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT NOT NULL, folder_id TEXT, project_id TEXT NOT NULL, content TEXT NOT NULL DEFAULT '')"
  );

  // global-auth DB
  await env.AUTH_DB.exec(
    "CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'viewer')"
  );
  await env.AUTH_DB.exec(
    "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL)"
  );
  await env.AUTH_DB.exec(
    "CREATE TABLE IF NOT EXISTS user_integrations (username TEXT PRIMARY KEY, github_token TEXT, updated_at TEXT DEFAULT (datetime('now')))"
  );
  await env.AUTH_DB.exec(
    "CREATE TABLE IF NOT EXISTS server_settings (key TEXT PRIMARY KEY, value TEXT)"
  );
}

export async function clearAll() {
  await env.DB.exec("DELETE FROM files");
  await env.DB.exec("DELETE FROM folders");
  await env.DB.exec("DELETE FROM project_members");
  await env.DB.exec("DELETE FROM projects");
  await env.AUTH_DB.exec("DELETE FROM sessions");
  await env.AUTH_DB.exec("DELETE FROM users");
  await env.AUTH_DB.exec("DELETE FROM user_integrations");
  await env.AUTH_DB.exec("DELETE FROM server_settings");
}

export async function seedUser(username: string, role: string = "member") {
  await env.AUTH_DB.prepare(
    "INSERT OR REPLACE INTO users (username, role) VALUES (?, ?)"
  ).bind(username, role).run();
}

export async function seedSession(sessionId: string, username: string) {
  const expires = Date.now() + 60 * 60 * 1000;
  await env.AUTH_DB.prepare(
    "INSERT OR REPLACE INTO sessions (id, username, expires) VALUES (?, ?, ?)"
  ).bind(sessionId, username, expires).run();
}

/** Bootstrap a default authed user "alice" (member) and an "owner" admin. */
export async function bootstrap() {
  await seedSchema();
  await clearAll();
  await seedUser("alice", "member");
  await seedSession(SESSION_ID, "alice");
  await seedUser("admin", "admin");
  await seedSession(OWNER_SESSION_ID, "admin");
}

export function authHeaders(sessId: string = SESSION_ID): HeadersInit {
  return { Cookie: `sess=${sessId}` };
}

export async function createProject(name = "P1", owner = "alice"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO projects (id, name, description, owner, git_repo, git_branch) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, name, "", owner, "", "main").run();
  return id;
}
