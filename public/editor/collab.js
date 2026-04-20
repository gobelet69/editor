/* public/editor/collab.js
   Exposes window.Collab = { connect(editor, { fileId, username, color, basePath }), disconnect() }.
   Sets up Y.Doc, CodemirrorBinding, Awareness, and a WebSocket client implementing the
   y-protocols/sync + awareness framing used by the server.
*/
(function () {
  let current = null;

  const MSG_SYNC = 0;
  const MSG_AWARENESS = 1;

  function awaitYjs() {
    if (window.__Y__) return Promise.resolve(window.__Y__);
    return new Promise(resolve => window.addEventListener('yjs-ready', () => resolve(window.__Y__), { once: true }));
  }

  async function connect(editor, { fileId, username, color, basePath = '' }) {
    disconnect();
    const Y = await awaitYjs();
    const doc = new Y.Y.Doc();
    const yText = doc.getText('content');
    const binding = new Y.CodemirrorBinding(yText, editor, null);

    const awareness = new Y.Awareness(doc);
    awareness.setLocalStateField('user', { name: username, color });

    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const ws = new WebSocket(`${proto}${location.host}${basePath}/ws/${encodeURIComponent(fileId)}?name=${encodeURIComponent(username)}&color=${encodeURIComponent(color)}&clientId=${doc.clientID}`);
    ws.binaryType = 'arraybuffer';

    const onStatus = (online) => {
      const el = document.getElementById('collab-status');
      if (!el) return;
      el.classList.toggle('online', online);
      el.querySelector('.status-text').textContent = online ? 'Live' : 'Offline';
    };

    ws.addEventListener('open', () => {
      onStatus(true);
      // Send sync step 1
      const enc = Y.encoding.createEncoder();
      Y.encoding.writeVarUint(enc, MSG_SYNC);
      Y.writeSyncStep1(enc, doc);
      ws.send(Y.encoding.toUint8Array(enc));

      // Send local awareness state
      const encA = Y.encoding.createEncoder();
      Y.encoding.writeVarUint(encA, MSG_AWARENESS);
      Y.encoding.writeVarUint8Array(encA, Y.encodeAwarenessUpdate(awareness, [doc.clientID]));
      ws.send(Y.encoding.toUint8Array(encA));
    });

    ws.addEventListener('close', () => onStatus(false));
    ws.addEventListener('error', () => onStatus(false));

    ws.addEventListener('message', (ev) => {
      const data = new Uint8Array(ev.data);
      const dec = Y.decoding.createDecoder(data);
      const kind = Y.decoding.readVarUint(dec);
      if (kind === MSG_SYNC) {
        const enc = Y.encoding.createEncoder();
        Y.encoding.writeVarUint(enc, MSG_SYNC);
        Y.readSyncMessage(dec, enc, doc, null);
        if (Y.encoding.length(enc) > 1) ws.send(Y.encoding.toUint8Array(enc));
      } else if (kind === MSG_AWARENESS) {
        const update = Y.decoding.readVarUint8Array(dec);
        Y.applyAwarenessUpdate(awareness, update, ws);
        renderCollabUsers(awareness);
      }
    });

    doc.on('update', (update, origin) => {
      if (origin === ws) return;
      const enc = Y.encoding.createEncoder();
      Y.encoding.writeVarUint(enc, MSG_SYNC);
      // writeUpdate message kind = 2
      Y.encoding.writeVarUint(enc, 2);
      Y.encoding.writeVarUint8Array(enc, update);
      if (ws.readyState === WebSocket.OPEN) ws.send(Y.encoding.toUint8Array(enc));
    });

    awareness.on('update', ({ added, updated, removed }, origin) => {
      if (origin === ws) { renderCollabUsers(awareness); return; }
      const changed = added.concat(updated).concat(removed);
      const enc = Y.encoding.createEncoder();
      Y.encoding.writeVarUint(enc, MSG_AWARENESS);
      Y.encoding.writeVarUint8Array(enc, Y.encodeAwarenessUpdate(awareness, changed));
      if (ws.readyState === WebSocket.OPEN) ws.send(Y.encoding.toUint8Array(enc));
      renderCollabUsers(awareness);
    });

    current = { doc, ws, binding, awareness };
  }

  function disconnect() {
    if (!current) return;
    try { current.binding.destroy(); } catch {}
    try { current.awareness.destroy(); } catch {}
    try { current.ws.close(); } catch {}
    try { current.doc.destroy(); } catch {}
    current = null;
    const el = document.getElementById('collab-users');
    if (el) el.innerHTML = '';
    const st = document.getElementById('collab-status');
    if (st) { st.classList.remove('online'); st.querySelector('.status-text').textContent = 'Offline'; }
  }

  function renderCollabUsers(awareness) {
    const el = document.getElementById('collab-users');
    if (!el) return;
    el.innerHTML = '';
    for (const [, state] of awareness.getStates()) {
      const u = state?.user;
      if (!u) continue;
      const av = document.createElement('div');
      av.className = 'collab-avatar';
      av.style.background = u.color || '#58a6ff';
      av.textContent = (u.name || '?')[0].toUpperCase();
      av.title = u.name || 'Anonymous';
      el.appendChild(av);
    }
  }

  window.Collab = { connect, disconnect };
})();
