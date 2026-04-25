import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env, runInDurableObject } from "cloudflare:test";
import { bootstrap } from "./setup";

describe("CollabRoom websocket", () => {
  beforeAll(async () => bootstrap());

  it("rejects non-upgrade requests with 426", async () => {
    const r = await SELF.fetch("https://example.com/ws/file-123");
    expect(r.status).toBe(426);
    expect(await r.text()).toContain("websocket");
  });

  it("404s when fileId is missing", async () => {
    const r = await SELF.fetch("https://example.com/ws/");
    expect(r.status).toBe(400);
  });

  it("upgrades, broadcasts presence, and relays messages between peers", async () => {
    const id = env.COLLAB_ROOM.idFromName("room-1");
    const stub = env.COLLAB_ROOM.get(id);

    async function open(name: string, color: string) {
      const res = await stub.fetch(
        new Request(`https://do/?name=${name}&color=${encodeURIComponent(color)}`, {
          headers: { Upgrade: "websocket" },
        })
      );
      expect(res.status).toBe(101);
      const ws = res.webSocket!;
      ws.accept();
      return ws;
    }

    const messagesA: string[] = [];
    const messagesB: string[] = [];

    const a = await open("alice", "#fff");
    a.addEventListener("message", e => messagesA.push(typeof e.data === "string" ? e.data : ""));

    const b = await open("bob", "#000");
    b.addEventListener("message", e => messagesB.push(typeof e.data === "string" ? e.data : ""));

    // give the DO a moment to emit presence
    await new Promise(r => setTimeout(r, 30));

    // Alice sends an arbitrary edit message — bob should receive it, alice should not echo back to herself
    a.send(JSON.stringify({ type: "edit", text: "hi" }));
    await new Promise(r => setTimeout(r, 30));
    expect(messagesB.some(m => m.includes('"type":"edit"'))).toBe(true);
    expect(messagesA.some(m => m.includes('"type":"edit"'))).toBe(false);

    // Cursor messages also relay
    a.send(JSON.stringify({ type: "cursor", pos: { line: 1, ch: 2 } }));
    await new Promise(r => setTimeout(r, 30));
    expect(messagesB.some(m => m.includes('"type":"cursor"'))).toBe(true);

    // At least one presence frame containing both users should have arrived
    const presenceFrames = messagesB.filter(m => m.includes('"type":"presence"'));
    expect(presenceFrames.length).toBeGreaterThan(0);
    expect(presenceFrames[presenceFrames.length - 1]).toContain('"count":2');

    a.close();
    b.close();
  });

  it("session map is empty after all peers close", async () => {
    const id = env.COLLAB_ROOM.idFromName("room-2");
    const stub = env.COLLAB_ROOM.get(id);
    const res = await stub.fetch(
      new Request("https://do/?name=carol&color=%23123456", {
        headers: { Upgrade: "websocket" },
      })
    );
    const ws = res.webSocket!;
    ws.accept();
    ws.close();
    await new Promise(r => setTimeout(r, 30));

    await runInDurableObject(stub, (instance: any) => {
      expect(instance.sessions.size).toBe(0);
    });
  });
});
