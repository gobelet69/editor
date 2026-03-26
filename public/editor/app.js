const BASE_PATH = location.pathname.startsWith('/editor') ? '/editor' : '';
/* ══════════════════════════════════════════════
   Editor — Iridescence · Auth · Collab
   ══════════════════════════════════════════════ */

mermaid.initialize({ startOnLoad: false, theme: 'default' });

// ── User (injected by server) ──
const currentUser = window.__USER__ || { username: 'Anonymous', role: 'viewer' };

// ── State ──
let ownedProjects = [];
let sharedProjects = [];
let currentProject = null;
let folders = [];
let files = [];
let currentFileId = null;
let openTabs = [];
let ws = null;
let isRemoteChange = false;
let collabUsers = [];
let currentView = 'split';

// Random color for presence
const userColor = localStorage.getItem('editorUserColor') || randomColor();
localStorage.setItem('editorUserColor', userColor);

// ── DOM refs ──
const homeScreen = document.getElementById('home-screen');
const editorApp = document.getElementById('editor-app');
const myProjectsGrid = document.getElementById('my-projects-grid');
const sharedProjectsGrid = document.getElementById('shared-projects-grid');
const sharedSection = document.getElementById('shared-section');
const previewEl = document.getElementById('preview-content');
const collabStatus = document.getElementById('collab-status');
const collabUsersEl = document.getElementById('collab-users');
const saveStatusEl = document.getElementById('save-status');
const fileNameEl = document.getElementById('current-file-name');
const tabBar = document.getElementById('tab-bar');
const cursorInfoEl = document.getElementById('cursor-info');
const wordCountEl = document.getElementById('word-count');
const charCountEl = document.getElementById('char-count');
const workspace = document.getElementById('workspace');

// ── CodeMirror ──
const editor = CodeMirror.fromTextArea(document.getElementById('code-editor'), {
  mode: 'markdown',
  theme: 'dracula',
  lineNumbers: true,
  lineWrapping: true,
  tabSize: 2,
  indentWithTabs: false,
});

editor.on('cursorActivity', () => {
  const p = editor.getCursor();
  cursorInfoEl.textContent = `Ln ${p.line + 1}, Col ${p.ch + 1}`;
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'cursor', pos: p }));
  }
});

editor.on('change', (inst, changeObj) => {
  const content = inst.getValue();
  renderPreview(content);
  updateStats(content);
  if (!isRemoteChange && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'change', content }));
  }
  if (!isRemoteChange) {
    saveStatusEl.textContent = 'Saving...';
    debouncedSave(content);
  }
});

// ── Toast ──
function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Stats ──
function updateStats(content) {
  const w = content.trim() ? content.trim().split(/\s+/).length : 0;
  wordCountEl.textContent = `${w} word${w !== 1 ? 's' : ''}`;
  charCountEl.textContent = `${content.length} char${content.length !== 1 ? 's' : ''}`;
}

// ── Auto-save ──
let saveTimeout = null;
function debouncedSave(content) {
  if (!currentFileId) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await fetch(`${BASE_PATH}/api/files/${currentFileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      saveStatusEl.textContent = 'Saved';
      setTimeout(() => { if (saveStatusEl.textContent === 'Saved') saveStatusEl.textContent = ''; }, 2000);
    } catch (e) {
      saveStatusEl.textContent = 'Save failed';
    }
  }, 600);
}

// ══════════ RENDERING ══════════

function renderLatex(text) {
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
    try { return katex.renderToString(latex.trim(), { displayMode: true, throwOnError: false }); }
    catch (e) { return `<span style="color:red">${e.message}</span>`; }
  });
  text = text.replace(/(?<!\$)\$([^\$\n]+?)\$(?!\$)/g, (_, latex) => {
    try { return katex.renderToString(latex.trim(), { displayMode: false, throwOnError: false }); }
    catch (e) { return `<span style="color:red">${e.message}</span>`; }
  });
  return text;
}

const markedRenderer = new marked.Renderer();
const origCode = markedRenderer.code.bind(markedRenderer);
markedRenderer.code = function(codeOrToken, langOrUndef) {
  const code = typeof codeOrToken === 'string' ? codeOrToken : codeOrToken.text;
  const lang = typeof codeOrToken === 'string' ? langOrUndef : codeOrToken.lang;

  if (lang === 'mermaid') return `<div class="mermaid">${code}</div>`;
  if (lang === 'latex' || lang === 'tex') {
    try { return katex.renderToString(code.trim(), { displayMode: true, throwOnError: false }); }
    catch (e) { return `<pre style="color:red">${e.message}</pre>`; }
  }
  
  const langColorDef = { javascript: '#f1e05a', typescript: '#2b7489', python: '#3572A5', html: '#e34c26', css: '#563d7c', bash: '#89e051', json: '#89e051', sql: '#e38c00', go: '#00ADD8', rust: '#00ADD8' };
  
  let highlightedCode = esc(code);
  try {
    if (lang && window.hljs && window.hljs.getLanguage(lang)) {
      highlightedCode = window.hljs.highlight(code, { language: lang }).value;
    } else if (window.hljs) {
      highlightedCode = window.hljs.highlightAuto(code).value;
    }
  } catch(e) {}
  
  const rawHtml = `<pre><code class="hljs ${lang ? 'language-' + lang : ''}">${highlightedCode}</code></pre>`;
  
  const encodedCode = encodeURIComponent(code).replace(/'/g, "%27").replace(/"/g, "%22");
  const copyBtn = `<button class="btn-copy-code" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodedCode}')).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)})" style="position:absolute; top:8px; right:8px; background:rgba(255,255,255,0.1); color:var(--text); border:1px solid var(--border); border-radius:4px; padding:4px 8px; font-size:12px; cursor:pointer; z-index:10; backdrop-filter:blur(4px); transition: background 0.2s;">Copy</button>`;
  const badgeColor = langColorDef[lang?.toLowerCase()] || 'var(--muted)';
  const langBadge = lang ? `<span style="position:absolute; top:12px; right:60px; font-size:11px; font-family:monospace; color:${badgeColor}; font-weight:800; text-transform:uppercase; z-index:10; pointer-events:none;">${lang}</span>` : '';
  
  return `<div style="position:relative;">${langBadge}${copyBtn}${rawHtml}</div>`;
};
marked.setOptions({ renderer: markedRenderer, breaks: true });

let renderCount = 0;
let currentFileExt = ''; // Track file type for renderer selection

async function renderPreview(content) {
  renderCount++;
  const rc = renderCount;

  // ── Native LaTeX Document Rendering ──
  if (['tex', 'latex'].includes(currentFileExt)) {
    previewEl.innerHTML = `
      <div style="padding:20px; text-align:center; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text); background: var(--bg-surface);">
        <h2 style="margin-bottom:15px; font-weight:600;">LaTeX Document</h2>
        <p style="margin-bottom:25px; color:var(--muted); max-width:400px; line-height:1.5;">Click compile to send this document to an external LaTeX engine. The full PDF will be securely streamed back here.</p>
        <button class="btn-primary" onclick="compileLatexAPI()" style="padding:10px 24px; font-size:1.05em; border-radius:8px; display:flex; align-items:center; gap:8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Compile to PDF
        </button>
      </div>
    `;
    return;
  }

  // ── Standard Markdown Rendering ──
  const html = marked.parse(renderLatex(content));
  previewEl.innerHTML = html;
  try {
    const nodes = previewEl.querySelectorAll('.mermaid');
    if (nodes.length > 0) {
      nodes.forEach((n, i) => { n.removeAttribute('data-processed'); n.id = `m-${rc}-${i}`; });
      await mermaid.run({ nodes });
    }
  } catch (e) { console.warn("Mermaid error:", e); }
}

window.compileLatexAPI = async function() {
  const content = editor.getValue();
  previewEl.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted); display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; background: var(--bg-surface);">
    <div style="font-size:3em; margin-bottom:20px; animation: spin 2s linear infinite;">⚙️</div>
    <div style="font-size:1.1em; margin-bottom:8px; color:var(--text);">Compiling on Remote Engine...</div>
    <div style="font-size:0.9em; opacity:0.8;">This usually takes 2-5 seconds.</div>
  </div>`;
  
  try {
    const fd = new FormData();
    fd.append('text', content);
    
    const res = await fetch(BASE_PATH + '/api/compile-latex', {
      method: 'POST',
      body: fd
    });
    
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText);
    }
    
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    previewEl.innerHTML = `<iframe src="${url}#toolbar=0" style="width:100%; height:100%; border:none; background:#525659; border-radius:var(--radius);"></iframe>`;
  } catch(e) {
    previewEl.innerHTML = `
      <div style="padding:30px; color:var(--text); overflow:auto; height:100%; background:var(--bg-surface);">
        <h3 style="color:var(--error); margin-bottom:15px; display:flex; align-items:center; gap:10px;"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Compilation Failed</h3>
        <p style="color:var(--muted); margin-bottom:20px;">The LaTeX compiler encountered an error while parsing your document.</p>
        <pre style="white-space:pre-wrap; margin-top:15px; background:rgba(244,63,94,0.1); border: 1px solid rgba(244,63,94,0.3); padding:20px; border-radius:8px; font-family:monospace; line-height:1.4; color:var(--error); overflow-x:auto;">${esc(e.message)}</pre>
        <button class="btn-secondary" onclick="renderPreview(editor.getValue())" style="margin-top:25px;">Back to Preview</button>
      </div>`;
  }
};

// ══════════ HOME / PROJECTS ══════════

async function loadProjects() {
  const res = await fetch(BASE_PATH + '/api/projects');
  if (res.status === 401) { window.location.href = BASE_PATH + '/auth/login?redirect=/editor'; return; }
  const data = await res.json();
  ownedProjects = data.owned || [];
  sharedProjects = data.shared || [];
  renderProjects();
}

function renderProjects() {
  myProjectsGrid.innerHTML = '';
  if (ownedProjects.length === 0) {
    myProjectsGrid.innerHTML = '<p class="empty-message">No projects yet. Create one or import from GitHub!</p>';
  } else {
    ownedProjects.forEach(p => myProjectsGrid.appendChild(makeProjectCard(p, true)));
  }

  if (sharedProjects.length > 0) {
    sharedSection.style.display = '';
    sharedProjectsGrid.innerHTML = '';
    sharedProjects.forEach(p => sharedProjectsGrid.appendChild(makeProjectCard(p, false)));
  } else {
    sharedSection.style.display = 'none';
  }
}

function makeProjectCard(p, isOwned) {
  const card = document.createElement('div');
  card.className = 'project-card';
  card.innerHTML = `
    <h3>📁 ${esc(p.name)}</h3>
    <p>${esc(p.description || 'No description')}</p>
    <div class="meta">
      ${p.git_repo ? `<span>🔗 ${esc(p.git_repo)}</span>` : ''}
      ${!isOwned ? `<span>👤 ${esc(p.owner || '')}</span>` : ''}
      <span>${p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</span>
    </div>
    ${isOwned ? '<button class="delete-project" title="Delete project">×</button>' : ''}
  `;
  card.onclick = (e) => {
    if (e.target.classList.contains('delete-project')) {
      e.stopPropagation();
      if (confirm(`Delete project "${p.name}" and all its files?`)) {
        fetch(`${BASE_PATH}/api/projects/${p.id}`, { method: 'DELETE' }).then(() => {
          toast(`Deleted "${p.name}"`, 'info');
          loadProjects();
        });
      }
      return;
    }
    openProject(p);
  };
  return card;
}

async function openProject(project) {
  currentProject = project;
  document.getElementById('project-name-display').textContent = project.name;
  history.replaceState(null, '', `#p=${project.id}`);
  homeScreen.classList.add('hidden');
  editorApp.classList.remove('hidden');

  openTabs = [];
  currentFileId = null;
  fileNameEl.textContent = 'No file open';
  editor.setValue('');
  previewEl.innerHTML = '';
  if (ws) ws.close();

  await loadProjectData();
  updateGitButtons();
  setTimeout(() => editor.refresh(), 50);
}

function goHome() {
  homeScreen.classList.remove('hidden');
  editorApp.classList.add('hidden');
  currentProject = null;
  if (ws) ws.close();
  history.replaceState(null, '', location.pathname);
  loadProjects();
}

async function loadProjectData() {
  if (!currentProject) return;
  const [fRes, filesRes] = await Promise.all([
    fetch(`${BASE_PATH}/api/folders?project_id=${currentProject.id}`),
    fetch(`${BASE_PATH}/api/files?project_id=${currentProject.id}`)
  ]);
  folders = await fRes.json();
  files = await filesRes.json();
  renderTree();
  renderTabs();
}

// ══════════ FILE TREE ══════════

function renderTree() {
  const tree = document.getElementById('file-tree');
  tree.innerHTML = '';
  const rootFolders = folders.filter(f => !f.parent_id);
  const rootFiles = files.filter(f => !f.folder_id);
  rootFolders.forEach(f => tree.appendChild(mkFolder(f)));
  rootFiles.forEach(f => tree.appendChild(mkFile(f)));
}

function mkFolder(folder) {
  const c = document.createElement('div');
  c.dataset.folderId = folder.id;
  const h = document.createElement('div');
  h.className = 'tree-folder-header';
  h.innerHTML = `<span class="chevron open">▶</span><span>📁</span><span>${esc(folder.name)}</span>`;
  const ch = document.createElement('div');
  ch.className = 'tree-folder-children';
  h.onclick = (e) => { e.stopPropagation(); h.querySelector('.chevron').classList.toggle('open'); ch.classList.toggle('collapsed'); };
  h.oncontextmenu = (e) => { e.preventDefault(); showCtx(e, 'folder', folder); };
  folders.filter(f => f.parent_id === folder.id).forEach(f => ch.appendChild(mkFolder(f)));
  files.filter(f => f.folder_id === folder.id).forEach(f => ch.appendChild(mkFile(f)));
  c.appendChild(h); c.appendChild(ch);
  return c;
}

function mkFile(file) {
  const d = document.createElement('div');
  d.className = `tree-item ${file.id === currentFileId ? 'active' : ''}`;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let icon = '📄';
  if (['md','markdown'].includes(ext)) icon = '📝';
  if (['tex','latex'].includes(ext)) icon = '📐';
  if (['mmd','mermaid'].includes(ext)) icon = '📊';
  d.innerHTML = `<span>${icon}</span><span>${esc(file.name)}</span>`;
  d.onclick = () => openFile(file);
  d.oncontextmenu = (e) => { e.preventDefault(); showCtx(e, 'file', file); };
  return d;
}

// ══════════ TABS ══════════

function renderTabs() {
  tabBar.innerHTML = '';
  openTabs.forEach(id => {
    const file = files.find(f => f.id === id);
    if (!file) return;
    const t = document.createElement('div');
    t.className = `tab ${id === currentFileId ? 'active' : ''}`;
    t.innerHTML = `<span>${esc(file.name)}</span><span class="close-tab">×</span>`;
    t.onclick = (e) => e.target.classList.contains('close-tab') ? closeTab(id) : switchTab(id);
    tabBar.appendChild(t);
  });
}

function closeTab(id) {
  openTabs = openTabs.filter(x => x !== id);
  if (currentFileId === id) {
    if (openTabs.length > 0) { switchTab(openTabs[openTabs.length - 1]); }
    else { currentFileId = null; fileNameEl.textContent = 'No file open'; editor.setValue(''); previewEl.innerHTML = ''; if (ws) ws.close(); }
  }
  renderTabs();
}

async function switchTab(id) {
  if (currentFileId === id) return;
  currentFileId = id;
  const file = files.find(f => f.id === id);
  if (!file) return;
  
  currentFileExt = (file.name.split('.').pop() || '').toLowerCase();
  
  fileNameEl.textContent = file.name;
  renderTree(); renderTabs();
  const res = await fetch(`${BASE_PATH}/api/files/${file.id}`);
  const data = await res.json();
  isRemoteChange = true;
  editor.setValue(data.content || '');
  isRemoteChange = false;
  updateStats(data.content || '');
  connectWS(file.id);
}

async function openFile(file) {
  if (!openTabs.includes(file.id)) openTabs.push(file.id);
  await switchTab(file.id);
}

// ── Remote Cursors ──
const remoteCursors = new Map(); // { username: CodeMirror.TextMarker }

function clearCursors() {
  remoteCursors.forEach(marker => marker.clear());
  remoteCursors.clear();
}

function updateRemoteCursor(name, color, pos) {
  if (!name || name === currentUser.username || !pos) return;
  
  if (remoteCursors.has(name)) {
    remoteCursors.get(name).clear();
  }

  const cursorEl = document.createElement('div');
  cursorEl.className = 'remote-cursor';
  cursorEl.style.borderColor = color;
  
  const labelEl = document.createElement('div');
  labelEl.className = 'remote-cursor-label';
  labelEl.style.backgroundColor = color;
  labelEl.textContent = name;
  cursorEl.appendChild(labelEl);

  const marker = editor.setBookmark(pos, { widget: cursorEl, insertLeft: true });
  remoteCursors.set(name, marker);
  
  // Auto-hide label after 2 seconds of inactivity
  setTimeout(() => {
    if (remoteCursors.get(name) === marker) {
      labelEl.style.opacity = '0';
    }
  }, 2000);
}

// ══════════ WEBSOCKET + PRESENCE ══════════

function connectWS() {
  if (ws) ws.close();
  clearCursors();
  
  const loc = window.location;
  let wsUrl = loc.protocol === 'https:' ? 'wss://' : 'ws://';
  wsUrl += loc.host + BASE_PATH + '/ws/' + currentFileId + '?name=' + encodeURIComponent(window.__USER__.username) + '&color=' + encodeURIComponent(myColor);
  
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    collabStatus.classList.add('online');
    collabStatus.querySelector('.status-text').textContent = 'Live';
  };
  ws.onclose = () => {
    collabStatus.classList.remove('online');
    collabStatus.querySelector('.status-text').textContent = 'Offline';
    collabUsersEl.innerHTML = '';
    clearCursors();
  };
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'presence') {
        const oldUsers = new Set(collabUsers.map(u => u.name));
        collabUsers = data.users || [];
        const newUsers = new Set(collabUsers.map(u => u.name));
        
        // Remove cursors for users who left
        for (const name of oldUsers) {
          if (!newUsers.has(name) && remoteCursors.has(name)) {
            remoteCursors.get(name).clear();
            remoteCursors.delete(name);
          }
        }
        renderCollabUsers();
        return;
      }
      if (data.type === 'cursor') {
        updateRemoteCursor(data.name, data.color, data.pos);
        return;
      }
      if (data.type === 'change') {
        isRemoteChange = true;
        const cursor = editor.getCursor();
        const scroll = editor.getScrollInfo();
        editor.setValue(data.content);
        editor.setCursor(cursor);
        editor.scrollTo(scroll.left, scroll.top);
        isRemoteChange = false;
      }
    } catch (e) {}
  };
}

function renderCollabUsers() {
  collabUsersEl.innerHTML = '';
  collabUsers.forEach(u => {
    const av = document.createElement('div');
    av.className = 'collab-avatar';
    av.style.background = u.color || '#58a6ff';
    av.textContent = (u.name || '?')[0].toUpperCase();
    av.title = u.name || 'Anonymous';
    collabUsersEl.appendChild(av);
  });
}

// ══════════ CONTEXT MENU ══════════

const ctxMenu = document.getElementById('context-menu');
let ctxTarget = null, ctxType = null;

function showCtx(e, type, target) {
  ctxTarget = target; ctxType = type;
  ctxMenu.style.top = e.clientY + 'px';
  ctxMenu.style.left = e.clientX + 'px';
  ctxMenu.classList.remove('hidden');
  ctxMenu.querySelectorAll('[data-action="new-file-in"],[data-action="new-folder-in"]').forEach(el => {
    el.style.display = type === 'folder' ? '' : 'none';
  });
}
document.addEventListener('click', () => ctxMenu.classList.add('hidden'));

ctxMenu.querySelectorAll('.ctx-item').forEach(item => {
  item.onclick = async () => {
    const a = item.dataset.action;
    if (a === 'rename') {
      const ep = ctxType === 'file' ? `${BASE_PATH}/api/files/${ctxTarget.id}` : `${BASE_PATH}/api/folders/${ctxTarget.id}`;
      showPrompt('Rename', ctxTarget.name, async (name) => {
        if (!name) return;
        await fetch(ep, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        toast(`Renamed to "${name}"`, 'success');
        loadProjectData();
      });
    }
    if (a === 'delete') {
      if (!confirm(`Delete "${ctxTarget.name}"?`)) return;
      const ep = ctxType === 'file' ? `${BASE_PATH}/api/files/${ctxTarget.id}` : `${BASE_PATH}/api/folders/${ctxTarget.id}`;
      await fetch(ep, { method: 'DELETE' });
      if (ctxType === 'file') closeTab(ctxTarget.id);
      toast(`Deleted "${ctxTarget.name}"`, 'info');
      loadProjectData();
    }
    if (a === 'new-file-in') {
      showPrompt('New file in ' + ctxTarget.name, '', async (name) => {
        if (!name) return;
        const res = await fetch(BASE_PATH + '/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, folder_id: ctxTarget.id, project_id: currentProject.id, content: '' }) });
        const d = await res.json();
        await loadProjectData();
        const f = files.find(x => x.id === d.id);
        if (f) openFile(f);
      });
    }
    if (a === 'new-folder-in') {
      showPrompt('New folder in ' + ctxTarget.name, '', async (name) => {
        if (!name) return;
        await fetch(BASE_PATH + '/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parent_id: ctxTarget.id, project_id: currentProject.id }) });
        toast(`Created folder "${name}"`, 'success');
        loadProjectData();
      });
    }
    ctxMenu.classList.add('hidden');
  };
});

// ══════════ MODAL ══════════

const modal = document.getElementById('modal-container');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
let modalConfirmCb = null;

function showPrompt(title, defaultVal, cb) {
  modalTitle.textContent = title;
  modalBody.innerHTML = '<input type="text" id="modal-input" class="modal-input" autocomplete="off" />';
  const inp = document.getElementById('modal-input');
  inp.value = defaultVal || '';
  document.getElementById('modal-confirm').style.display = '';
  document.getElementById('modal-confirm').textContent = 'Confirm';
  document.getElementById('modal-cancel').style.display = '';
  modal.classList.remove('hidden');
  setTimeout(() => inp.focus(), 50);
  modalConfirmCb = () => cb(inp.value);
}

// ══════════ GIT / OAUTH ══════════

window.checkAndConnectGitHub = async function() {
  toast('Connecting to GitHub...', 'info');
  try {
    const res = await fetch(BASE_PATH + '/auth/github/login', { redirect: 'manual' });
    if (res.status === 500) {
      toast('GitHub Client ID missing in Secrets. Please configure the OAuth App.', 'error', 6000);
    } else {
      window.location.href = BASE_PATH + '/auth/github/login';
    }
  } catch (e) {
    toast('Connection failed', 'error');
  }
};

async function checkGitAuth() {
  try {
    const res = await fetch(BASE_PATH + '/api/git/repos');
    const data = await res.json();
    return data;
  } catch (e) {
    return { has_token: false };
  }
}

async function showGitSettings() {
  if (!currentProject) return;
  modalTitle.textContent = 'GitHub Connection';
  
  const authStatus = await checkGitAuth();
  
  if (!authStatus.has_token) {
    modalBody.innerHTML = `
      <div style="text-align:center; padding: 20px 0;">
        <p style="margin-bottom: 20px; color: var(--muted);">Connect your GitHub account to sync this project.</p>
        <button class="btn-primary" onclick="checkAndConnectGitHub()" style="width: 100%;">🔗 Connect with GitHub</button>
      </div>
    `;
    document.getElementById('modal-confirm').style.display = 'none';
  } else {
    document.getElementById('modal-confirm').style.display = '';
    const repoOptions = authStatus.repos.map(r => 
      `<option value="${esc(r.full_name)}" ${currentProject.git_repo === r.full_name ? 'selected' : ''}>${esc(r.full_name)}</option>`
    ).join('');
    
    modalBody.innerHTML = `
      <div class="git-form">
        <label>Select Repository
          <select id="git-repo" class="modal-input">
            <option value="">-- Select a repository --</option>
            ${repoOptions}
          </select>
        </label>
        <label>Branch
          <input type="text" id="git-branch" class="modal-input" value="${esc(currentProject.git_branch || 'main')}" placeholder="main" />
        </label>
        <div style="margin-top: 15px; font-size: 0.85em; color: var(--good); text-align: right;">✓ GitHub Connected</div>
      </div>
    `;
    
    modalConfirmCb = async () => {
      const gitRepo = document.getElementById('git-repo').value;
      const gitBranch = document.getElementById('git-branch').value.trim() || 'main';
      await fetch(`${BASE_PATH}/api/projects/${currentProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ git_repo: gitRepo, git_branch: gitBranch })
      });
      currentProject.git_repo = gitRepo;
      currentProject.git_branch = gitBranch;
      updateGitButtons();
      toast('Git settings saved', 'success');
    };
  }
  modal.classList.remove('hidden');
}

async function showImportDialog() {
  modalTitle.textContent = 'Import from GitHub';
  const authStatus = await checkGitAuth();
  
  if (!authStatus.has_token) {
    modalBody.innerHTML = `
      <div style="text-align:center; padding: 20px 0;">
        <p style="margin-bottom: 20px; color: var(--muted);">Connect your GitHub account to import a repository.</p>
        <button class="btn-primary" onclick="checkAndConnectGitHub()" style="width: 100%;">🔗 Connect with GitHub</button>
      </div>
    `;
    document.getElementById('modal-confirm').style.display = 'none';
  } else {
    document.getElementById('modal-confirm').style.display = '';
    const repoOptions = authStatus.repos.map(r => `<option value="${esc(r.full_name)}">${esc(r.full_name)}</option>`).join('');
    
    modalBody.innerHTML = `
      <div class="git-form">
        <label>Project Name
          <input type="text" id="import-name" class="modal-input" placeholder="My Imported Project" />
        </label>
        <label>Select Repository
          <select id="import-repo" class="modal-input">
            <option value="">-- Select a repository --</option>
            ${repoOptions}
          </select>
        </label>
        <label>Branch
          <input type="text" id="import-branch" class="modal-input" value="main" placeholder="main" />
        </label>
      </div>
    `;
    
    modalConfirmCb = async () => {
      const name = document.getElementById('import-name').value.trim() || 'Imported Project';
      const repo = document.getElementById('import-repo').value;
      const branch = document.getElementById('import-branch').value.trim() || 'main';
      
      if (!repo) { toast('Please select a repository', 'error'); return; }
      
      toast('Creating project...', 'info');
      const pRes = await fetch(BASE_PATH + '/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, git_repo: repo, git_branch: branch })
      });
      const project = await pRes.json();
      
      toast('Pulling from GitHub...', 'info');
      const pullRes = await fetch(BASE_PATH + '/api/git/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, branch, project_id: project.id })
      });
      const pullData = await pullRes.json();
      
      if (pullData.success) {
        toast('Imported successfully!', 'success');
        await loadProjects();
        const found = [...ownedProjects, ...sharedProjects].find(x => x.id === project.id);
        if (found) openProject(found);
      } else {
        toast('Import failed: ' + (pullData.error || 'Unknown error'), 'error');
      }
    };
  }
  modal.classList.remove('hidden');
}

document.getElementById('modal-cancel').onclick = () => modal.classList.add('hidden');
document.getElementById('modal-confirm').onclick = () => { if (modalConfirmCb) modalConfirmCb(); modal.classList.add('hidden'); };
document.querySelector('.modal-backdrop')?.addEventListener('click', () => modal.classList.add('hidden'));

// ══════════ GIT PUSH/PULL ══════════

async function updateGitButtons() {
  const hasRepoConfig = currentProject && currentProject.git_repo;
  const authStatus = await checkGitAuth();
  
  const canSync = hasRepoConfig && authStatus.has_token;
  document.getElementById('btn-git-pull').disabled = !canSync;
  document.getElementById('btn-git-push').disabled = !canSync;
}

document.getElementById('btn-git-settings').onclick = showGitSettings;

document.getElementById('btn-git-push').onclick = async () => {
  if (!currentProject?.git_repo) { toast('Configure Git settings first', 'error'); return; }
  const message = prompt('Commit message:', 'Sync from Editor') || 'Sync from Editor';
  toast('Pushing...', 'info');
  try {
    const res = await fetch(BASE_PATH + '/api/git/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: currentProject.git_repo, branch: currentProject.git_branch || 'main', project_id: currentProject.id, message })
    });
    const d = await res.json();
    d.success ? toast(`Pushed! (${d.sha?.substring(0,7)})`, 'success') : toast(d.error || 'Push failed', 'error');
  } catch (e) { toast('Push failed: ' + e.message, 'error'); }
};

document.getElementById('btn-git-pull').onclick = async () => {
  if (!currentProject?.git_repo) { toast('Configure Git settings first', 'error'); return; }
  if (!confirm('Pull will REPLACE all files in this project. Continue?')) return;
  toast('Pulling...', 'info');
  try {
    const res = await fetch(BASE_PATH + '/api/git/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: currentProject.git_repo, branch: currentProject.git_branch || 'main', project_id: currentProject.id })
    });
    const d = await res.json();
    if (d.success) {
      toast('Pulled!', 'success');
      openTabs = []; currentFileId = null; fileNameEl.textContent = 'No file open';
      editor.setValue(''); previewEl.innerHTML = '';
      await loadProjectData();
    } else { toast(d.error || 'Pull failed', 'error'); }
  } catch (e) { toast('Pull failed: ' + e.message, 'error'); }
};

// ══════════ SIDEBAR BUTTONS ══════════

document.getElementById('btn-back-home').onclick = goHome;

document.getElementById('btn-new-file').onclick = () => {
  if (!currentProject) return;
  showPrompt('New File Name', '', async (name) => {
    if (!name) return;
    const res = await fetch(BASE_PATH + '/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, project_id: currentProject.id, content: '' })
    });
    const d = await res.json();
    await loadProjectData();
    const f = files.find(x => x.id === d.id);
    if (f) openFile(f);
    toast(`Created "${name}"`, 'success');
  });
};

document.getElementById('btn-new-folder').onclick = () => {
  if (!currentProject) return;
  showPrompt('New Folder Name', '', async (name) => {
    if (!name) return;
    await fetch(BASE_PATH + '/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, project_id: currentProject.id })
    });
    toast(`Created folder "${name}"`, 'success');
    loadProjectData();
  });
};

document.getElementById('btn-invite').onclick = () => {
  if (!currentProject) return;
  // 1. Copy link to clipboard
  const url = `${location.origin}/editor?project=${currentProject.id}`;
  navigator.clipboard.writeText(url);
  
  // 2. Ask if they want to explicitly invite a username
  showPrompt('Invite User', 'username', async (username) => {
    if (!username) {
      toast('Copied invite link to clipboard', 'info');
      return;
    }
    
    // Attempt explicit invite
    try {
      const res = await fetch(`${BASE_PATH}/api/projects/${currentProject.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const data = await res.json();
      
      if (res.ok && data.success) {
        toast(`Successfully invited ${username} & copied link`, 'success');
      } else {
        toast(data.error || 'Failed to invite user', 'error');
        toast('Copied invite link to clipboard anyway', 'info');
      }
    } catch (e) {
      toast('Error inviting user', 'error');
    }
  });
};

document.getElementById('btn-export-pdf').onclick = () => {
  if (!currentFileId) { toast('Open a file first', 'error'); return; }
  toast('Generating PDF...', 'info');
  html2pdf().from(previewEl).set({
    margin: [15, 15, 15, 15],
    filename: (fileNameEl.textContent || 'export') + '.pdf',
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }).save().then(() => toast('PDF exported!', 'success'));
};

document.getElementById('btn-export-zip').onclick = async () => {
  if (!currentProject) { toast('Open a project first', 'error'); return; }
  toast('Preparing ZIP file...', 'info');
  try {
    const zip = new JSZip();
    const foldersById = {};
    folders.forEach(f => foldersById[f.id] = f);
    
    function getPath(folderId) {
      if (!folderId) return '';
      const f = foldersById[folderId];
      return f ? getPath(f.parent_id) + f.name + '/' : '';
    }

    for (const file of files) {
      const res = await fetch(`${BASE_PATH}/api/files/${file.id}`);
      const data = await res.json();
      zip.file(getPath(file.folder_id) + file.name, data.content || '');
    }
    
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject.name.replace(/\\s+/g, '_')}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Project exported to ZIP!', 'success');
  } catch (e) {
    toast('ZIP export failed: ' + e.message, 'error');
  }
};

document.getElementById('btn-toggle-sidebar').onclick = () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
  setTimeout(() => editor.refresh(), 200);
};

// ══════════ VIEW TOGGLE ══════════

document.querySelectorAll('#view-toggle .view-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('#view-toggle .view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    workspace.className = 'workspace';
    if (currentView === 'editor') workspace.classList.add('view-editor');
    else if (currentView === 'preview') workspace.classList.add('view-preview');
    setTimeout(() => editor.refresh(), 50);
  };
});

// ══════════ PROJECT CREATE ══════════

document.getElementById('btn-create-project').onclick = () => {
  showPrompt('Project Name', '', async (name) => {
    if (!name) return;
    await fetch(BASE_PATH + '/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    toast(`Created project "${name}"`, 'success');
    await loadProjects();
  });
};

document.getElementById('btn-import-repo').onclick = showImportDialog;

// ══════════ RESIZE HANDLE ══════════

const resizeHandle = document.getElementById('resize-handle');
const editorPane = document.getElementById('editor-pane');
const previewPane = document.getElementById('preview-pane');
let isResizing = false;

resizeHandle.addEventListener('mousedown', () => {
  isResizing = true;
  resizeHandle.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const rect = workspace.getBoundingClientRect();
  const pct = ((e.clientX - rect.left) / rect.width) * 100;
  const clamped = Math.max(15, Math.min(85, pct));
  editorPane.style.flex = `0 0 ${clamped}%`;
  previewPane.style.flex = `0 0 ${100 - clamped}%`;
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizeHandle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    editor.refresh();
  }
});

// ══════════ KEYBOARD SHORTCUTS ══════════

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (currentFileId) {
      const content = editor.getValue();
      clearTimeout(saveTimeout);
      saveStatusEl.textContent = 'Saving...';
      fetch(`${BASE_PATH}/api/files/${currentFileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      }).then(() => { saveStatusEl.textContent = 'Saved'; toast('Saved', 'success'); });
    }
  }
});

// ══════════ UTILS ══════════

function esc(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }

function randomColor() {
  const colors = ['#58a6ff','#f85149','#3fb950','#d29922','#bc8cff','#f778ba','#79c0ff','#ff7b72','#ffa657','#7ee787'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ══════════ STARTUP ══════════

(async function init() {
  // Check if URL has a project hash (invite link)
  const hash = location.hash;
  const match = hash.match(/#p=(.+)/);
  if (match) {
    const projectId = match[1];
    try {
      // Join as member (persists access)
      await fetch(BASE_PATH + '/api/projects/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId })
      });
      // Load and open the project
      const res = await fetch(`${BASE_PATH}/api/projects/${projectId}`);
      if (res.ok) {
        const project = await res.json();
        openProject(project);
        return;
      }
    } catch (e) {}
  }

  // Default: show home
  loadProjects();
})();
