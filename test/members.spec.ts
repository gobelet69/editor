import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';

async function seedSession(username: string, role: string) {
  const sid = 'sid-' + username;
  await env.AUTH_DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
  await env.AUTH_DB.prepare("INSERT OR REPLACE INTO users (username, role) VALUES (?, ?)").bind(username, role).run();
  await env.AUTH_DB.prepare("INSERT INTO sessions (id, username, expires) VALUES (?, ?, ?)").bind(sid, username, Date.now() + 60_000).run();
  return `sess=${sid}`;
}

async function seedProject(id: string, owner: string) {
  await env.DB.prepare("INSERT INTO projects (id, name, owner) VALUES (?, 'P', ?)").bind(id, owner).run();
}

describe('members endpoints', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM project_members').run();
    await env.DB.prepare('DELETE FROM projects').run();
    await env.AUTH_DB.prepare('DELETE FROM sessions').run();
    await env.AUTH_DB.prepare('DELETE FROM users').run();
  });

  it('owner can remove a member', async () => {
    await seedProject('pm1', 'alice');
    await env.DB.prepare("INSERT INTO project_members (project_id, username) VALUES ('pm1', 'bob')").run();
    const cookie = await seedSession('alice', 'viewer');
    const res = await SELF.fetch('https://example.com/api/projects/pm1/members/bob', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT 1 FROM project_members WHERE project_id='pm1' AND username='bob'").first();
    expect(row).toBeNull();
  });

  it('non-owner member cannot remove another member', async () => {
    await seedProject('pm2', 'alice');
    await env.DB.prepare("INSERT INTO project_members (project_id, username) VALUES ('pm2', 'bob'), ('pm2', 'carol')").run();
    const cookie = await seedSession('bob', 'viewer');
    const res = await SELF.fetch('https://example.com/api/projects/pm2/members/carol', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(403);
  });

  it('owner cannot be removed', async () => {
    await seedProject('pm3', 'alice');
    const cookie = await seedSession('alice', 'viewer');
    const res = await SELF.fetch('https://example.com/api/projects/pm3/members/alice', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(400);
  });

  it('outsiders cannot list members', async () => {
    await seedProject('pm4', 'alice');
    const cookie = await seedSession('eve', 'viewer');
    const res = await SELF.fetch('https://example.com/api/projects/pm4/members', {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(403);
  });
});
