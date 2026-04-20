// ═══════════════════════════════════════════════
// Editor Worker — Iridescence · Auth · Collab
// ═══════════════════════════════════════════════

import type { AuthUser } from './auth';
import { normalizeRole, isGlobalOwner, getUser, getProjectAccess, getFileProjectId, getFolderProjectId } from './auth';

// ── Role helpers (same as vault/hub) ──
function isOwner(u: any): boolean { return isGlobalOwner(u); }

const ROLE_META: Record<string, any> = {
  owner:  { label: 'Owner',  color: '#f43f5e', bg: 'rgba(244,63,94,0.15)',  border: 'rgba(244,63,94,0.3)',  icon: '🔑' },
  member: { label: 'Member', color: '#A855F7', bg: 'rgba(168,85,247,0.15)', border: 'rgba(168,85,247,0.3)', icon: '📁' },
  viewer: { label: 'Viewer', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)',  border: 'rgba(148,163,184,0.2)', icon: '👁' },
};
const ROLE_PERMS: Record<string, string[]> = {
  owner:  ['Upload any file type', 'Delete any file', 'Share files', 'Manage users & roles', 'Access admin panel'],
  member: ['Upload any file type', 'Delete own files', 'Share files'],
  viewer: ['Upload PDF files only', 'Delete own files'],
};

// ── CollabRoom Durable Object ──
export { CollabRoom } from './collab-room';

// ── Types ──
export interface Env {
  DB: D1Database;
  AUTH_DB: D1Database;
  COLLAB_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

// ── Worker entry ──
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Find logical path cleanly
    const isWs = url.pathname.startsWith('/editor/ws/') || url.pathname.startsWith('/ws/');
    if (url.pathname.startsWith('/editor')) {
      url.pathname = url.pathname.replace(/^\/editor/, '') || '/';
      // DO NOT clone request for WebSockets, it strips the Upgrade: websocket header!
      if (!isWs) {
        request = new Request(url.toString(), request);
      }
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // Temporary debug endpoint to verify env binding
    if (url.pathname === '/editor/debug-env') {
      return Response.json({ keys: Object.keys(env) });
    }

    // API routes and GitHub Auth — require user session
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/github/')) {
      const user = await getUser(request, env);
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const res = await handleApi(request, env, user);
      for (const [k, v] of Object.entries(corsHeaders())) res.headers.set(k, v);
      return res;
    }

    // WebSocket — pass through (auth via cookie checked by client)
    if (url.pathname.startsWith('/ws/')) {
      const fileId = url.pathname.replace('/ws/', '');
      if (!fileId) return new Response("Missing fileId", { status: 400 });
      const id = env.COLLAB_ROOM.idFromName(fileId);
      const stub = env.COLLAB_ROOM.get(id);
      // Forward the request but ensure ?fileId= is always present for the DO.
      const forward = new URL(request.url);
      forward.searchParams.set('fileId', fileId);
      return stub.fetch(new Request(forward.toString(), request));
    }

    // Main page — server-render with auth state
    if (url.pathname === '/' || url.pathname === '/editor' || url.pathname === '/editor/') {
      const user = await getUser(request, env);
      if (!user) {
        const redir = encodeURIComponent(url.pathname);
        return new Response(null, { status: 302, headers: { Location: `/auth/login?redirect=${redir}` } });
      }
      // Serve index.html with injected user data
      const assetRes = await env.ASSETS.fetch(new Request(new URL('/', url.origin)));
      let html = await assetRes.text();
      // Inject user + header before </head>
      const inject = `<script>window.__USER__=${JSON.stringify({ username: user.username, role: normalizeRole(user.role) })};</script>`;
      html = html.replace('</head>', `${inject}\n</head>`);
      // Inject iridescence header after <body>
      html = html.replace('<body>', `<body>\n${renderIridescenceHeader(user)}`);
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // Static assets
    return env.ASSETS.fetch(request);
  },
};

// ── Iridescence header (same as vault/hub) ──
function renderIridescenceHeader(user: AuthUser): string {
  const role = normalizeRole(user.role);
  const rm = ROLE_META[role] || ROLE_META.viewer;
  const perms = ROLE_PERMS[role] || [];
  const all = ['Upload any file type', 'Delete any file', 'Share files', 'Manage users & roles', 'Access admin panel'];
  const id = 'edUW';

  return `<header class="iri-header">
  <a href="/" style="text-decoration:none;display:flex;align-items:center;gap:10px;flex-shrink:0">
    <span style="width:36px;height:36px;background:linear-gradient(135deg,#A855F7,#EC4899);border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.05em;color:#fff;text-shadow:0 0 12px rgba(255,255,255,.7),0 0 4px rgba(255,255,255,.95);flex-shrink:0;box-shadow:0 2px 8px rgba(168,85,247,.35),0 0 20px rgba(168,85,247,.45)">111</span>
    <div style="display:flex;flex-direction:column;line-height:1.25">
      <span style="font-weight:700;font-size:1.1em;color:#fff;letter-spacing:-.02em">111<span style="color:#A855F7;text-shadow:0 0 20px rgba(168,85,247,.5)">iridescence</span></span>
      <span style="font-size:.72em;color:#94a3b8;font-weight:500;letter-spacing:.03em">Editor</span>
    </div>
  </a>
  <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
    <div class="user-wrap" id="${id}">
      <button class="user-btn" onclick="document.getElementById('${id}').classList.toggle('open')">
        ${user.username}<svg class="caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="dd">
        <div class="dd-hdr">
          <div class="dd-name">${user.username}</div>
          <span class="role-badge" style="background:${rm.bg};color:${rm.color};border:1px solid ${rm.border}">${rm.icon} ${rm.label}</span>
          <ul class="perm-list">${all.map(p => { const h = perms.includes(p); return `<li class="${h ? 'ok' : ''}"><span class="pcheck ${h ? 'y' : 'n'}">${h ? '✓' : '✕'}</span>${p}</li>`; }).join('')}</ul>
        </div>
        <a href="/auth/account" class="ddl"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>Account Preferences</a>
        ${isOwner(user) ? `<a href="/auth/admin" class="ddl"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>Admin Panel</a>` : ''}
        <div class="dd-sep"></div>
        <a href="/auth/logout" class="ddl out"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>Sign Out</a>
      </div>
    </div>
    <script>document.addEventListener('click',e=>{const w=document.getElementById('${id}');if(w&&!w.contains(e.target))w.classList.remove('open');});<\/script>
  </div>
</header>`;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ── API handler ──
async function handleApi(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;

  // ──── PROJECTS ────
  if (url.pathname === '/api/projects') {
    if (method === 'GET') {
      // My projects + projects shared with me
      const { results: owned } = await env.DB.prepare("SELECT * FROM projects WHERE owner = ? ORDER BY created_at DESC").bind(user.username).all();
      const { results: memberRows } = await env.DB.prepare(
        "SELECT p.* FROM projects p JOIN project_members pm ON p.id = pm.project_id WHERE pm.username = ? AND p.owner != ? ORDER BY p.created_at DESC"
      ).bind(user.username, user.username).all();
      return Response.json({ owned, shared: memberRows });
    }
    if (method === 'POST') {
      const body = await request.json() as any;
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO projects (id, name, description, owner, git_repo, git_branch) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, body.name || 'Untitled', body.description || '', user.username, body.git_repo || '', body.git_branch || 'main').run();
      return Response.json({ id, name: body.name || 'Untitled', owner: user.username });
    }
  }

  if (url.pathname.match(/^\/api\/projects\/[^/]+$/)) {
    const id = url.pathname.split('/api/projects/')[1];
    const access = await getProjectAccess(env, user, id);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

    if (method === 'GET') {
      return Response.json(access.project);
    }
    if (method === 'PUT') {
      const body = await request.json() as any;
      const sets: string[] = [];
      const vals: any[] = [];
      if (body.name !== undefined) { sets.push("name = ?"); vals.push(body.name); }
      if (body.description !== undefined) { sets.push("description = ?"); vals.push(body.description); }
      if (body.git_repo !== undefined) { sets.push("git_repo = ?"); vals.push(body.git_repo); }
      if (body.git_branch !== undefined) { sets.push("git_branch = ?"); vals.push(body.git_branch); }
      if (sets.length > 0) {
        vals.push(id);
        await env.DB.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
      }
      return Response.json({ success: true });
    }
    if (method === 'DELETE') {
      if (access.projectRole !== 'owner') {
        return Response.json({ error: 'Only the project owner can delete' }, { status: 403 });
      }
      await env.DB.prepare("DELETE FROM files WHERE project_id = ?").bind(id).run();
      await env.DB.prepare("DELETE FROM folders WHERE project_id = ?").bind(id).run();
      await env.DB.prepare("DELETE FROM project_members WHERE project_id = ?").bind(id).run();
      await env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
      return Response.json({ success: true });
    }
  }

  // ──── JOIN PROJECT (via invite link) ────
  if (url.pathname === '/api/projects/join' && method === 'POST') {
    const body = await request.json() as any;
    const projectId = body.project_id;
    if (!projectId) return Response.json({ error: 'Missing project_id' }, { status: 400 });
    const project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first();
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });
    // Add as member (ignore if already member/owner)
    await env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, username) VALUES (?, ?)").bind(projectId, user.username).run();
    return Response.json({ success: true, project });
  }

  // ──── PROJECT MEMBERS ────
  if (url.pathname.match(/^\/api\/projects\/[^/]+\/members$/)) {
    const projectId = url.pathname.split('/api/projects/')[1].replace('/members', '');
    const access = await getProjectAccess(env, user, projectId);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

    if (method === 'GET') {
      const { results } = await env.DB.prepare("SELECT * FROM project_members WHERE project_id = ?").bind(projectId).all();
      return Response.json(results);
    }
  }

  // ──── FOLDERS (scoped to project) ────
  if (url.pathname === '/api/folders') {
    const projectId = url.searchParams.get('project_id') || ((await request.clone().json().catch(() => ({}))) as any).project_id;
    if (!projectId) return Response.json({ error: 'Missing project_id' }, { status: 400 });
    const access = await getProjectAccess(env, user, projectId);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

    if (method === 'GET') {
      const { results } = await env.DB.prepare("SELECT * FROM folders WHERE project_id = ? ORDER BY name").bind(projectId).all();
      return Response.json(results);
    }
    if (method === 'POST') {
      const body = await request.json() as any;
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO folders (id, name, parent_id, project_id) VALUES (?, ?, ?, ?)")
        .bind(id, body.name, body.parent_id || null, projectId).run();
      return Response.json({ id, name: body.name, parent_id: body.parent_id || null, project_id: projectId });
    }
  }

  if (url.pathname.match(/^\/api\/folders\/[^/]+$/)) {
    const id = url.pathname.split('/api/folders/')[1];
    const pid = await getFolderProjectId(env, id);
    if (!pid) return Response.json({ error: 'Folder not found' }, { status: 404 });
    const access = await getProjectAccess(env, user, pid);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

    if (method === 'PUT') {
      const body = await request.json() as any;
      if (body.name) await env.DB.prepare("UPDATE folders SET name = ? WHERE id = ?").bind(body.name, id).run();
      return Response.json({ success: true });
    }
    if (method === 'DELETE') {
      await deleteFolderRecursive(env, id);
      return Response.json({ success: true });
    }
  }

  // ──── FILES (scoped to project) ────
  if (url.pathname === '/api/files') {
    const projectId = url.searchParams.get('project_id') || ((await request.clone().json().catch(() => ({}))) as any).project_id;
    if (!projectId) return Response.json({ error: 'Missing project_id' }, { status: 400 });
    const access = await getProjectAccess(env, user, projectId);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

    if (method === 'GET') {
      const { results } = await env.DB.prepare("SELECT id, name, folder_id, project_id FROM files WHERE project_id = ? ORDER BY name").bind(projectId).all();
      return Response.json(results);
    }
    if (method === 'POST') {
      const body = await request.json() as any;
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO files (id, name, folder_id, project_id, content) VALUES (?, ?, ?, ?, ?)")
        .bind(id, body.name, body.folder_id || null, projectId, body.content || '').run();
      return Response.json({ id, name: body.name, folder_id: body.folder_id || null, project_id: projectId });
    }
  }

  if (url.pathname.match(/^\/api\/files\/[^/]+$/)) {
    const id = url.pathname.split('/api/files/')[1];
    const pid = await getFileProjectId(env, id);
    if (!pid) return Response.json({ error: 'File not found' }, { status: 404 });
    const access = await getProjectAccess(env, user, pid);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

    if (method === 'GET') {
      const file = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(id).first();
      return file ? Response.json(file) : new Response("Not found", { status: 404 });
    }
    if (method === 'PUT') {
      const body = await request.json() as any;
      if (body.content !== undefined) await env.DB.prepare("UPDATE files SET content = ? WHERE id = ?").bind(body.content, id).run();
      if (body.name !== undefined) await env.DB.prepare("UPDATE files SET name = ? WHERE id = ?").bind(body.name, id).run();
      if (body.folder_id !== undefined) await env.DB.prepare("UPDATE files SET folder_id = ? WHERE id = ?").bind(body.folder_id, id).run();
      return Response.json({ success: true });
    }
    if (method === 'DELETE') {
      await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(id).run();
      return Response.json({ success: true });
    }
  }

  async function getServerSetting(key: string): Promise<string | undefined> {
    try {
      const res = await env.AUTH_DB.prepare("SELECT value FROM server_settings WHERE key = ?").bind(key).first();
      return res ? (res as any).value : undefined;
    } catch { return undefined; }
  }

  // ──── GITHUB OAUTH ────
  if (url.pathname === '/auth/github/login') {
    const clientId = (await getServerSetting('GITHUB_CLIENT_ID')) || env.GITHUB_CLIENT_ID;
    if (!clientId) return new Response("GITHUB_CLIENT_ID missing", { status: 500 });
    // IMPORTANT: Always route back to production branch or the GitHub OAuth security strictly drops the user
    const redirectUri = 'https://111iridescence.org/editor/auth/github/callback';
    const redirectUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo&redirect_uri=${encodeURIComponent(redirectUri)}`;
    return Response.redirect(redirectUrl, 302);
  }

  if (url.pathname === '/auth/github/callback') {
    const code = url.searchParams.get('code');
    const clientId = (await getServerSetting('GITHUB_CLIENT_ID')) || env.GITHUB_CLIENT_ID;
    const clientSecret = (await getServerSetting('GITHUB_CLIENT_SECRET')) || env.GITHUB_CLIENT_SECRET;
    if (!code || !clientId || !clientSecret) return new Response("Missing params", { status: 400 });

    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
      });
      const data = await tokenRes.json() as any;
      if (data.error) throw new Error(data.error_description || data.error);

      const token = data.access_token;
      // Store in global-auth DB for this user
      await env.AUTH_DB.prepare("INSERT INTO user_integrations (username, github_token) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET github_token = excluded.github_token, updated_at = datetime('now')").bind(user.username, token).run();
      
      return new Response(null, { status: 302, headers: { Location: '/editor' } });
    } catch (e: any) {
      return new Response("OAuth failed: " + e.message, { status: 500 });
    }
  }

  // ──── LATEX COMPILER PROXY ────
  if (url.pathname === '/api/compile-latex' && method === 'POST') {
    try {
      const fdForm = await request.formData();
      const text = fdForm.get('text') as string;
      if (!text) return new Response("Missing LaTeX source", { status: 400 });

      // latexonline seamlessly handles massive URL encoded GET queries without breaking its express route
      const compileUrl = new URL('https://latexonline.cc/compile');
      compileUrl.searchParams.set('text', text);
      
      const compileRes = await fetch(compileUrl.toString(), { 
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
      });
      
      if (!compileRes.ok) {
        return new Response(await compileRes.text(), { status: 400 });
      }
      return new Response(compileRes.body, { headers: { 'Content-Type': 'application/pdf' } });
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  }

  // ──── GITHUB API HELPERS ────
  async function getGithubToken(): Promise<string | null> {
    const res = await env.AUTH_DB.prepare("SELECT github_token FROM user_integrations WHERE username = ?").bind(user.username).first() as any;
    return res ? res.github_token : null;
  }

  if (url.pathname === '/api/git/repos' && method === 'GET') {
    const token = await getGithubToken();
    if (!token) return Response.json({ has_token: false });
    
    try {
      // Fetch user repos (up to 100)
      const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=pushed', {
        headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'CloudflareEditor', 'Accept': 'application/vnd.github.v3+json' }
      });
      if (!res.ok) {
        if (res.status === 401) {
          // Token revoked/expired, clear it
          await env.AUTH_DB.prepare("UPDATE user_integrations SET github_token = NULL WHERE username = ?").bind(user.username).run();
          return Response.json({ has_token: false });
        }
        throw new Error("GitHub API error");
      }
      const repos = await res.json() as any[];
      return Response.json({ 
        has_token: true, 
        repos: repos.map(r => ({ full_name: r.full_name, default_branch: r.default_branch, private: r.private })) 
      });
    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  // ──── GIT PUSH ────
  if (url.pathname === '/api/git/push' && method === 'POST') {
    const body = await request.json() as any;
    const { repo, branch, project_id, message } = body;
    if (!repo || !project_id) return Response.json({ error: "Missing params" }, { status: 400 });

    const access = await getProjectAccess(env, user, project_id);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

    const token = await getGithubToken();
    if (!token) return Response.json({ error: "No GitHub token found. Please connect to GitHub." }, { status: 401 });

    const { results: allFiles } = await env.DB.prepare("SELECT * FROM files WHERE project_id = ?").bind(project_id).all() as any;
    const { results: allFolders } = await env.DB.prepare("SELECT * FROM folders WHERE project_id = ?").bind(project_id).all() as any;

    // Flush each file's DO so its latest Y.Doc text is written to D1 before we read it.
    await Promise.all((allFiles as any[]).map(async (f) => {
      try {
        const id = env.COLLAB_ROOM.idFromName(f.id);
        const stub = env.COLLAB_ROOM.get(id);
        await stub.fetch(`https://do.internal/flush?fileId=${encodeURIComponent(f.id)}`);
      } catch {}
    }));

    // Re-read files to pick up any freshly flushed content.
    const { results: freshFiles } = await env.DB.prepare("SELECT * FROM files WHERE project_id = ?").bind(project_id).all() as any;

    const folderMap: Record<string, any> = {};
    for (const f of allFolders) folderMap[f.id] = f;

    function getFolderPath(folderId: string | null): string {
      if (!folderId || !folderMap[folderId]) return '';
      const parent = getFolderPath(folderMap[folderId].parent_id);
      return parent ? `${parent}/${folderMap[folderId].name}` : folderMap[folderId].name;
    }

    const gh = (path: string, opts: any = {}) => fetch(`https://api.github.com${path}`, {
      ...opts,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'CloudflareEditor', ...(opts.headers || {}) }
    });

    const treeEntries: any[] = [];
    for (const file of freshFiles) {
      const folderPath = getFolderPath(file.folder_id);
      const fullPath = folderPath ? `${folderPath}/${file.name}` : file.name;
      const blobRes = await gh(`/repos/${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: file.content, encoding: 'utf-8' }) });
      const blob = await blobRes.json() as any;
      treeEntries.push({ path: fullPath, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const branchName = branch || 'main';
    const refRes = await gh(`/repos/${repo}/git/ref/heads/${branchName}`);
    let parentSha: string | null = null;
    let baseTreeSha: string | null = null;
    if (refRes.ok) {
      const refData = await refRes.json() as any;
      parentSha = refData.object.sha;
      const commitRes = await gh(`/repos/${repo}/git/commits/${parentSha}`);
      const commitData = await commitRes.json() as any;
      baseTreeSha = commitData.tree.sha;
    }

    const treeBody: any = { tree: treeEntries };
    if (baseTreeSha) treeBody.base_tree = baseTreeSha;
    const treeRes = await gh(`/repos/${repo}/git/trees`, { method: 'POST', body: JSON.stringify(treeBody) });
    const treeData = await treeRes.json() as any;

    const commitBody: any = { message: message || 'Sync from Editor', tree: treeData.sha };
    if (parentSha) commitBody.parents = [parentSha];
    const commitRes2 = await gh(`/repos/${repo}/git/commits`, { method: 'POST', body: JSON.stringify(commitBody) });
    const newCommit = await commitRes2.json() as any;

    if (parentSha) {
      await gh(`/repos/${repo}/git/refs/heads/${branchName}`, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha, force: true }) });
    } else {
      await gh(`/repos/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: newCommit.sha }) });
    }

    return Response.json({ success: true, sha: newCommit.sha });
  }

  // ──── GIT PULL / IMPORT ────
  if (url.pathname === '/api/git/pull' && method === 'POST') {
    const body = await request.json() as any;
    const { repo, branch, project_id } = body;
    if (!repo || !project_id) return Response.json({ error: "Missing params" }, { status: 400 });

    const access = await getProjectAccess(env, user, project_id);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

    const token = await getGithubToken();
    if (!token) return Response.json({ error: "No GitHub token found. Please connect to GitHub." }, { status: 401 });

    const branchName = branch || 'main';
    const gh = (path: string, opts: any = {}) => fetch(`https://api.github.com${path}`, {
      ...opts,
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'CloudflareEditor', ...(opts.headers || {}) }
    });

    const treeRes = await gh(`/repos/${repo}/git/trees/${branchName}?recursive=1`);
    if (!treeRes.ok) return Response.json({ error: "Failed to fetch repo tree" }, { status: 400 });
    const treeData = await treeRes.json() as any;

    await env.DB.prepare("DELETE FROM files WHERE project_id = ?").bind(project_id).run();
    await env.DB.prepare("DELETE FROM folders WHERE project_id = ?").bind(project_id).run();

    const folderIds: Record<string, string> = {};

    async function ensureFolder(folderPath: string): Promise<string | null> {
      if (!folderPath) return null;
      if (folderIds[folderPath]) return folderIds[folderPath];
      const parts = folderPath.split('/');
      const name = parts.pop()!;
      const parentPath = parts.join('/');
      const parentId = parentPath ? await ensureFolder(parentPath) : null;
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO folders (id, name, parent_id, project_id) VALUES (?, ?, ?, ?)")
        .bind(id, name, parentId, project_id).run();
      folderIds[folderPath] = id;
      return id;
    }

    for (const item of treeData.tree) {
      if (item.type !== 'blob') continue;
      const parts = item.path.split('/');
      const fileName = parts.pop()!;
      const folderPath = parts.join('/');
      const folderId = folderPath ? await ensureFolder(folderPath) : null;

      const blobRes = await gh(`/repos/${repo}/git/blobs/${item.sha}`, {
        headers: { 'Accept': 'application/vnd.github.v3.raw' }
      });
      const content = await blobRes.text();

      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO files (id, name, folder_id, project_id, content) VALUES (?, ?, ?, ?, ?)")
        .bind(id, fileName, folderId, project_id, content).run();
    }

    return Response.json({ success: true });
  }

  // ──── INVITE BY USERNAME ────
  if (url.pathname.match(/^\/api\/projects\/[^/]+\/invite$/) && method === 'POST') {
    const projectId = url.pathname.split('/api/projects/')[1].replace('/invite', '');
    const access = await getProjectAccess(env, user, projectId);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
    if (access.projectRole !== 'owner') {
      return Response.json({ error: 'Only the project owner can invite people' }, { status: 403 });
    }

    const body = await request.json() as any;
    const { username } = body;
    if (!username) return Response.json({ error: "Missing username" }, { status: 400 });

    const targetUser = await env.AUTH_DB.prepare("SELECT username FROM users WHERE username = ?").bind(username).first();
    if (!targetUser) return Response.json({ error: "User not found" }, { status: 404 });

    await env.DB.prepare("INSERT OR IGNORE INTO project_members (project_id, username) VALUES (?, ?)").bind(projectId, username).run();
    return Response.json({ success: true, username });
  }

  // Member management — remove
  {
    const m = url.pathname.match(/^\/api\/projects\/([^/]+)\/members\/([^/]+)$/);
    if (m && method === 'DELETE') {
      const [, projectId, target] = m;
      const access = await getProjectAccess(env, user, projectId);
      if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
      if (access.projectRole !== 'owner') {
        return Response.json({ error: 'Only the project owner can remove members' }, { status: 403 });
      }
      if (target === (access.project as any).owner) {
        return Response.json({ error: 'Cannot remove the project owner' }, { status: 400 });
      }
      await env.DB.prepare("DELETE FROM project_members WHERE project_id = ? AND username = ?").bind(projectId, target).run();
      return Response.json({ success: true });
    }
    if (m && method === 'PUT') {
      const [, projectId, target] = m;
      const access = await getProjectAccess(env, user, projectId);
      if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
      if (access.projectRole !== 'owner') {
        return Response.json({ error: 'Only the project owner can change roles' }, { status: 403 });
      }
      const body = await request.json() as any;
      const role = body.role || 'editor';
      await env.DB.prepare("UPDATE project_members SET role = ? WHERE project_id = ? AND username = ?").bind(role, projectId, target).run();
      return Response.json({ success: true });
    }
  }

  return new Response("Not found", { status: 404 });
}

async function deleteFolderRecursive(env: Env, folderId: string) {
  const { results: children } = await env.DB.prepare("SELECT id FROM folders WHERE parent_id = ?").bind(folderId).all();
  for (const child of children as any[]) {
    await deleteFolderRecursive(env, child.id);
  }
  await env.DB.prepare("DELETE FROM files WHERE folder_id = ?").bind(folderId).run();
  await env.DB.prepare("DELETE FROM folders WHERE id = ?").bind(folderId).run();
}
