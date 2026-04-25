import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import {
  bootstrap,
  authHeaders,
  SESSION_ID,
  seedSession,
} from "./setup";

describe("auth", () => {
  beforeAll(async () => bootstrap());
  beforeEach(async () => bootstrap());

  it("rejects /api/* with no cookie", async () => {
    const r = await SELF.fetch("https://example.com/api/projects");
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects /api/* with bogus cookie", async () => {
    const r = await SELF.fetch("https://example.com/api/projects", {
      headers: { Cookie: "sess=does-not-exist" },
    });
    expect(r.status).toBe(401);
  });

  it("rejects /api/* with expired session", async () => {
    await env.AUTH_DB.prepare(
      "INSERT OR REPLACE INTO sessions (id, username, expires) VALUES (?, ?, ?)"
    ).bind("expired", "alice", Date.now() - 1000).run();
    const r = await SELF.fetch("https://example.com/api/projects", {
      headers: { Cookie: "sess=expired" },
    });
    expect(r.status).toBe(401);
  });

  it("accepts /api/* with valid session", async () => {
    const r = await SELF.fetch("https://example.com/api/projects", {
      headers: authHeaders(),
    });
    expect(r.status).toBe(200);
  });

  it("falls back role to viewer when user row is missing", async () => {
    await env.AUTH_DB.prepare("DELETE FROM users WHERE username = ?").bind("alice").run();
    await seedSession("orphan-sess", "alice");
    const r = await SELF.fetch("https://example.com/api/projects", {
      headers: { Cookie: "sess=orphan-sess" },
    });
    // still authenticated (session ok); role defaults inside handler
    expect(r.status).toBe(200);
  });
});

describe("OPTIONS / CORS", () => {
  beforeAll(async () => bootstrap());

  it("returns CORS headers on preflight", async () => {
    const r = await SELF.fetch("https://example.com/api/projects", { method: "OPTIONS" });
    expect(r.status).toBe(200);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(r.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(r.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  });

  it("attaches CORS headers to API responses", async () => {
    const r = await SELF.fetch("https://example.com/api/projects", {
      headers: authHeaders(),
    });
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("debug-env", () => {
  beforeAll(async () => bootstrap());

  it("exposes the bound env keys via /editor/debug-env", async () => {
    const r = await SELF.fetch("https://example.com/editor/debug-env");
    expect(r.status).toBe(200);
    const j = await r.json() as { keys: string[] };
    expect(j.keys).toEqual(expect.arrayContaining(["DB", "AUTH_DB", "COLLAB_ROOM", "ASSETS"]));
  });
});

// Reference exports to keep imports tree-shake-stable
void SESSION_ID;
