// src/auth.ts — session + project access helpers

export interface AuthUser {
  username: string;
  role: string; // global role
}

export function normalizeRole(r: string | null | undefined): string {
  if (r === 'admin') return 'owner';
  if (r === 'guest+') return 'member';
  if (r === 'guest') return 'viewer';
  return r || 'viewer';
}

export function isGlobalOwner(u: AuthUser | null | undefined): boolean {
  return normalizeRole(u?.role) === 'owner';
}

export async function getUser(request: Request, env: { AUTH_DB: D1Database }): Promise<AuthUser | null> {
  const cookie = request.headers.get('Cookie') || '';
  const sessId = cookie.split(';').find(c => c.trim().startsWith('sess='))?.split('=')[1];
  if (!sessId) return null;
  try {
    const sess = await env.AUTH_DB
      .prepare('SELECT * FROM sessions WHERE id = ? AND expires > ?')
      .bind(sessId, Date.now())
      .first() as any;
    if (!sess) return null;
    const du = await env.AUTH_DB
      .prepare('SELECT role FROM users WHERE username = ?')
      .bind(sess.username)
      .first() as any;
    return { username: sess.username, role: du?.role || 'viewer' };
  } catch { return null; }
}

export type ProjectAccess =
  | { ok: true; project: any; projectRole: 'owner' | 'member' }
  | { ok: false; status: number; error: string };

export async function getProjectAccess(
  env: { DB: D1Database },
  user: AuthUser,
  projectId: string,
): Promise<ProjectAccess> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first() as any;
  if (!project) return { ok: false, status: 404, error: 'Project not found' };

  if (project.owner === user.username || isGlobalOwner(user)) {
    return { ok: true, project, projectRole: 'owner' };
  }
  const member = await env.DB
    .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND username = ?')
    .bind(projectId, user.username)
    .first();
  if (member) return { ok: true, project, projectRole: 'member' };

  return { ok: false, status: 403, error: 'Forbidden' };
}

export async function getFileProjectId(env: { DB: D1Database }, fileId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT project_id FROM files WHERE id = ?').bind(fileId).first() as any;
  return row?.project_id ?? null;
}

export async function getFolderProjectId(env: { DB: D1Database }, folderId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT project_id FROM folders WHERE id = ?').bind(folderId).first() as any;
  return row?.project_id ?? null;
}
