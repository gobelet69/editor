# Editor Overhaul — Design

**Date:** 2026-04-17
**Scope:** Full overhaul ("bucket D") of the `editor` Cloudflare Worker app — real CRDT collab, security hardening, UX polish, feature additions.

## Goals

1. Fix every broken-outright bug surfaced in the initial audit.
2. Replace last-write-wins, full-file WebSocket sync with a proper CRDT collab layer that respects Cloudflare Workers / Durable Object constraints.
3. Tighten authorization so project/file/folder endpoints are membership-gated.
4. Remove the UX rough edges (native `confirm`/`prompt`, no keyboard affordances, no project rename, no member management, LaTeX preview wiping on keystroke).
5. Add the small features whose absence makes the editor feel unfinished: find/replace, project rename, member management UI.

## Non-Goals

- Mobile responsive overhaul.
- Image / binary file upload.
- Version history, diff view.
- Command palette.
- Multi-pane editor layout.
- Changing the storage layer (D1 stays source-of-truth; DO SQLite holds CRDT snapshots).

## Architecture

### Durable Object `CollabRoom` — CRDT sync server

One DO instance per file (existing model, unchanged). Internals fully replaced:

- **Transport:** switch from `ws.accept()` + event listeners to **hibernatable WebSockets** (`state.acceptWebSocket(ws)` + the DO `webSocketMessage` / `webSocketClose` / `webSocketError` handlers). Idle rooms hibernate; state rehydrates on next message.
- **CRDT:** a single `Y.Doc` per DO, imported from `yjs`. Lazy-loaded on first message after wake by reading the persisted state bytes out of DO SQLite storage (`this.state.storage`).
- **Sync protocol:** standard `y-protocols/sync` binary frames (sync step 1, sync step 2, update). DO applies every update to its `Y.Doc`, then broadcasts the raw frame to every other connection.
- **Awareness:** `y-protocols/awareness` binary frames for cursors / user names / colors. Relay-only — never persisted.
- **Persistence:** after each update, schedule a debounced (500ms) write of `Y.encodeStateAsUpdate(doc)` into DO SQLite under key `ydoc`. On the last WebSocket disconnect, force a final persist and also flush the plain-text content (`doc.getText('content').toString()`) into D1 `files.content` so git push / export / search see current state.
- **Per-connection metadata:** attach `{ username, color, clientId }` to each socket via `ws.serializeAttachment(...)`. On wake, `ws.deserializeAttachment()` restores it. This removes the `sessions` Map entirely.

### Browser

- Load `yjs`, `y-codemirror`, `y-protocols/awareness` as browser ESM from `esm.sh` via `<script type="module">`. Expose the needed exports on `window` for the main script (or convert `app.js` to a module).
- `CodemirrorBinding(yText, editor, awareness)` replaces the manual `editor.on('change', ...)` whole-file broadcast and the manual remote-cursor `TextMarker` code.
- A tiny custom Yjs WS provider wraps the existing `/ws/:fileId` endpoint: on open, send sync step 1; handle inbound sync/awareness frames; forward local `Y.Doc` `update` events and local awareness updates as outbound frames.
- The local `debouncedSave` plain-text PUT to `/api/files/:id` is removed — persistence is now server-driven. When the tab is switched or closed, the client sends nothing special; the DO persists on its own.

### Data flow

```
user types
  → CodeMirror change
  → y-codemirror applies to Y.Doc
  → local Y.Doc "update" event fires
  → client sends binary update frame over WS
  → DO receives, applies to its Y.Doc, broadcasts to other sockets, schedules debounced persist
  → other clients apply the frame, y-codemirror updates their CodeMirror
```

```
user opens a file for the first time ever
  → DO wakes, finds no snapshot in SQLite
  → DO reads plain text from D1 files.content, seeds Y.Doc with Y.Text insert
  → normal sync proceeds
```

### Authorization

A new helper `requireProjectAccess(env, user, projectId)` returns a typed result `{ project, role }` or an error `Response`. It is called at the top of every handler that touches a specific project, file, or folder. For file/folder routes, the project ID is resolved from the row first. Access rules:

- Owner of the project: full access.
- Global role `owner` (platform super-user): full access (matches existing behaviour).
- Member (row in `project_members`): read + write except destructive project-level operations (delete project, manage members). Members can edit / create / delete files + folders.
- Anyone else: 403.

`/api/projects/join` still works the way it does today (anyone with the ID can join); this is the intended invite flow.

### Member management

New endpoints:

- `DELETE /api/projects/:id/members/:username` — owner only.
- `PUT /api/projects/:id/members/:username` with `{ role }` — owner only; role is stored in `project_members.role`, but practical effect today is limited to display.

New sidebar button **Members** (between "Copy Invite Link" and "Git Settings") opens a modal listing members (with the owner pinned at top), each with an `×` remove button for owners. The current explicit-invite path moves into this modal too so inviting and removing live together.

### Project rename

- On each project card: a pencil icon appears on hover next to the delete `×`. Clicking it opens a rename modal (reuses `showPrompt`). Save calls `PUT /api/projects/:id` with `{ name }`.
- Inside the editor, clicking the project name in the sidebar header opens the same rename modal.

### Modal: keyboard + `confirm`/`prompt` replacement

- `showPrompt` adds an Enter key handler that fires `modalConfirmCb`. Escape hides the modal.
- A new `showConfirm(title, message, cb)` helper replaces the remaining `confirm()` calls (delete file, delete project, pull overwrite).
- A new `showInput(title, defaultVal, placeholder, cb)` is the enhanced `showPrompt` (placeholder support, clears `modalConfirmCb` on close).
- Native `prompt()` on Git push commit message → modal with input.
- Backdrop click already hides; keep that.

### Find / replace

Load CodeMirror addons from cdnjs: `addon/search/search.min.js`, `addon/search/searchcursor.min.js`, `addon/dialog/dialog.min.js` + dialog.css, `addon/search/jump-to-line.min.js`. Default key bindings (`Cmd/Ctrl-F`, `Cmd-Alt-F` / `Shift-Ctrl-F` for replace) just work once the addons are loaded.

### LaTeX preview

Today `renderPreview` replaces `previewEl.innerHTML` with the compile-button UI on every keystroke for `.tex` / `.latex`. Fix:

- Track `latexPdfUrl` per open file (map by file id).
- `renderPreview` for LaTeX files only rebuilds the compile UI when the file was just switched (or when no PDF has been compiled yet). If a PDF exists, it leaves the iframe alone and shows a small "Recompile" button overlay.
- On compile success, store the new blob URL in the map and revoke the previous one.
- On file close / project close, revoke all blob URLs in the map.

### Stale tab cleanup

`loadProjectData()` gets a post-step: `openTabs = openTabs.filter(id => files.some(f => f.id === id))`. If `currentFileId` is no longer in `files`, treat it as "no file open".

### PDF export

`btn-export-pdf` currently passes the live `previewEl`. Replace with: render the current file's markdown to a detached `<div>` styled like `.preview-content`, pass that to `html2pdf`, discard. This avoids exporting the compile button / stale state.

## Components

| Unit | Purpose | Depends on |
|---|---|---|
| `CollabRoom` DO (rewritten) | CRDT sync, persistence, hibernation | `yjs`, `y-protocols`, DO SQLite |
| `requireProjectAccess` | single-source auth middleware | `env.DB` |
| `public/editor/collab.js` (new) | client-side Yjs wiring + custom WS provider | `yjs`, `y-codemirror`, `y-protocols/awareness` (esm.sh) |
| `public/editor/app.js` (trimmed) | UI + non-collab state + modals + file tree | `collab.js`, CodeMirror |
| `public/editor/modal.js` (new, optional split) | `showPrompt` / `showConfirm` / `showInput` + keys | DOM |
| Member management modal | new sidebar entry | modal module |
| Project rename affordance | card + sidebar entry points | modal module |

`app.js` is already ~1000 lines. The split into `modal.js` and `collab.js` is part of this spec (not optional); it keeps `app.js` focused on UI + project/file state and makes each file small enough to hold in context while editing.

## Data flow / state

- CRDT state lives canonically in the DO's Y.Doc and DO SQLite. D1 `files.content` becomes a **derived snapshot** updated on last-client-disconnect and on a 30s tick while connected.
- Cmd-S just shows a "Saved" toast; the DO's auto-persist loop is the real save path.
- Git push must see the freshest text. Before building the tree, `/api/git/push` calls each file's DO via a stub fetch to `/flush`, which forces the DO to write its current Y.Doc text to D1 and return. Only then does the push read from D1 and build the tree.
- Git pull wipes and recreates files with **new IDs** (existing behaviour). DOs keyed by old IDs become orphaned naturally — no explicit reset needed. Any client still connected to an orphaned DO will see its tab evicted by the stale-tab cleanup step on the next `loadProjectData`.

## Error handling

- WebSocket receive errors (malformed frames, throws inside `Y.applyUpdate`): logged, connection closed, client will reconnect.
- DO storage write failure: tolerate; the next successful write catches up.
- esm.sh load failure: fall back to an error banner in the editor asking the user to refresh; no silent degradation.
- Auth middleware 403: returns JSON `{ error }` with status 403, handled by existing client fetch paths (toast).

## Testing

Existing `test/` has a single spec for the Worker. We will:

1. Add unit tests for `requireProjectAccess` — owner / global owner / member / outsider / missing project.
2. Add an integration test for the CRDT sync server by spinning up the DO via `@cloudflare/vitest-pool-workers`, opening two WS clients, applying Yjs updates on one, and asserting the other converges.
3. Add an integration test for member endpoints (add, remove, role change, non-owner forbidden).
4. Keep the existing smoke test green.

Manual verification (written into a checklist that rides along with the PR):

- Two browser tabs editing simultaneously → characters interleave correctly.
- Close both tabs, reopen → content intact.
- Delete a file while another user has it open → graceful disconnect.
- Rename project from the card and from the sidebar.
- Invite link (copied from "Copy Invite Link") joins a fresh user as a member.
- Edit as member → allowed. Delete project as member → 403.
- Find/replace with Cmd-F and Cmd-Alt-F.
- Compile a LaTeX file → keep typing → PDF iframe stays.
- Git pull after local unsaved edits in a different DO → no overwrite of the just-pulled content.

## Migration / rollout

- `wrangler.jsonc` migration: not strictly required; `new_sqlite_classes` for `CollabRoom` is already declared. Adding storage keys is free.
- One-time: on first deploy, existing clients will get a hard reload (new `app.js` / `collab.js`). No server-side data migration is needed — D1 plain-text stays intact and seeds new Y.Doc instances on first connect.
- Deploy order: push Worker with new DO first, then frontend. Browsers on the old frontend will still work (old client sends text frames which the new DO ignores); they just won't collaborate correctly with new clients. Acceptable for a short window.

## Open items (flagged, not in this spec)

- Mobile layout.
- Image upload.
- Version history.
- Command palette.
- Better `.tex` compile error parsing.
