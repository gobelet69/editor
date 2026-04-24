// src/collab-room.ts — CRDT sync server (one Y.Doc per file)
import * as Y from 'yjs';
import { readSyncMessage, writeSyncStep1, messageYjsSyncStep2 } from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const STORAGE_KEY = 'ydoc';
const PERSIST_DEBOUNCE_MS = 500;

type Attachment = { username: string; color: string; clientId: number };

interface Env {
  DB: D1Database;
}

export class CollabRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private doc: Y.Doc | null = null;
  private loadingPromise: Promise<void> | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;
  private persistTimer: any = null;
  private fileId: string | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/flush') {
      this.fileId = this.fileId || url.searchParams.get('fileId');
      await this.ensureLoaded();
      await this.persistNow();
      return Response.json({ ok: true });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const username = url.searchParams.get('name') || 'Anonymous';
    const color = url.searchParams.get('color') || '#58a6ff';
    this.fileId = url.searchParams.get('fileId') || this.fileId;

    await this.ensureLoaded();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernatable WebSocket: let the runtime own the connection.
    const clientIdRaw = url.searchParams.get('clientId');
    const clientId = clientIdRaw ? parseInt(clientIdRaw, 10) : this.doc!.clientID;
    const attachment: Attachment = { username, color, clientId };
    server.serializeAttachment(attachment);
    this.state.acceptWebSocket(server);

    // Send sync step 1 so the client can catch up.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    writeSyncStep1(enc, this.doc!);
    server.send(encoding.toUint8Array(enc));

    // Send current awareness snapshot.
    const aw = this.awareness!;
    const states = Array.from(aw.getStates().keys());
    if (states.length > 0) {
      const encA = encoding.createEncoder();
      encoding.writeVarUint(encA, MSG_AWARENESS);
      encoding.writeVarUint8Array(encA, awarenessProtocol.encodeAwarenessUpdate(aw, states));
      server.send(encoding.toUint8Array(encA));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, msg: ArrayBuffer | string) {
    if (typeof msg === 'string') return;
    await this.ensureLoaded();
    const bytes = new Uint8Array(msg);
    const dec = decoding.createDecoder(bytes);
    const kind = decoding.readVarUint(dec);

    if (kind === MSG_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      const syncKind = readSyncMessage(dec, enc, this.doc!, null);
      // If there is a reply (step 2 or update), send it back to the sender.
      if (encoding.length(enc) > 1) {
        ws.send(encoding.toUint8Array(enc));
      }
      // Broadcast updates to every other client.
      if (syncKind === messageYjsSyncStep2 || syncKind === 2 /* update */) {
        const rebroadcast = new Uint8Array(bytes);
        for (const other of this.state.getWebSockets()) {
          if (other !== ws) {
            try { other.send(rebroadcast); } catch {}
          }
        }
      }
      this.schedulePersist();
      return;
    }

    if (kind === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(dec);
      awarenessProtocol.applyAwarenessUpdate(this.awareness!, update, ws);
      for (const other of this.state.getWebSockets()) {
        if (other !== ws) {
          try { other.send(bytes); } catch {}
        }
      }
      return;
    }
  }

  async webSocketClose(ws: WebSocket) { await this.onClose(ws); }
  async webSocketError(ws: WebSocket) { await this.onClose(ws); }

  private async onClose(ws: WebSocket) {
    try {
      const att = ws.deserializeAttachment?.() as Attachment | undefined;
      if (att && this.awareness) {
        awarenessProtocol.removeAwarenessStates(this.awareness, [att.clientId], ws);
        // Notify others that this client left.
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_AWARENESS);
        encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [att.clientId]));
        const bytes = encoding.toUint8Array(enc);
        for (const other of this.state.getWebSockets()) {
          if (other !== ws) { try { other.send(bytes); } catch {} }
        }
      }
    } catch {}

    // If this was the last socket, persist and flush plain text to D1.
    if (this.state.getWebSockets().length === 0) {
      await this.persistNow();
    }
  }

  private ensureLoaded(): Promise<void> {
    return (this.loadingPromise ??= this.loadDoc());
  }

  private async loadDoc(): Promise<void> {
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);

    const stored = await this.state.storage.get<ArrayBuffer>(STORAGE_KEY);
    if (stored) {
      Y.applyUpdate(this.doc, new Uint8Array(stored));
    } else if (this.fileId) {
      const row = await this.env.DB.prepare('SELECT content FROM files WHERE id = ?').bind(this.fileId).first() as any;
      if (row?.content) {
        this.doc.getText('content').insert(0, row.content);
      }
    }
  }

  private schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistNow().catch(() => {}), PERSIST_DEBOUNCE_MS);
  }

  private async persistNow() {
    if (!this.doc) return;
    const update = Y.encodeStateAsUpdate(this.doc);
    await this.state.storage.put(STORAGE_KEY, update);
    if (this.fileId) {
      const text = this.doc.getText('content').toString();
      try {
        await this.env.DB.prepare('UPDATE files SET content = ? WHERE id = ?').bind(text, this.fileId).run();
      } catch {}
    }
  }
}
