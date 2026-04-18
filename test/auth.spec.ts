import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { getProjectAccess } from '../src/auth';

async function seedProject(id: string, owner: string) {
  await env.DB.prepare("INSERT INTO projects (id, name, owner) VALUES (?, 'P', ?)").bind(id, owner).run();
}
async function addMember(pid: string, username: string) {
  await env.DB.prepare("INSERT INTO project_members (project_id, username) VALUES (?, ?)").bind(pid, username).run();
}

describe('getProjectAccess', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM project_members').run();
    await env.DB.prepare('DELETE FROM projects').run();
  });

  it('returns 404 for missing project', async () => {
    const res = await getProjectAccess(env, { username: 'alice', role: 'viewer' }, 'nope');
    expect(res).toEqual({ ok: false, status: 404, error: 'Project not found' });
  });

  it('allows the owner', async () => {
    await seedProject('p1', 'alice');
    const res = await getProjectAccess(env, { username: 'alice', role: 'viewer' }, 'p1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.projectRole).toBe('owner');
  });

  it('allows a member', async () => {
    await seedProject('p2', 'alice');
    await addMember('p2', 'bob');
    const res = await getProjectAccess(env, { username: 'bob', role: 'viewer' }, 'p2');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.projectRole).toBe('member');
  });

  it('allows a global owner even without membership', async () => {
    await seedProject('p3', 'alice');
    const res = await getProjectAccess(env, { username: 'root', role: 'admin' }, 'p3');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.projectRole).toBe('owner');
  });

  it('denies outsiders', async () => {
    await seedProject('p4', 'alice');
    const res = await getProjectAccess(env, { username: 'eve', role: 'viewer' }, 'p4');
    expect(res).toEqual({ ok: false, status: 403, error: 'Forbidden' });
  });
});
