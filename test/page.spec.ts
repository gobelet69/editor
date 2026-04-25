import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";
import { bootstrap, authHeaders, OWNER_SESSION_ID } from "./setup";

describe("server-rendered editor page", () => {
  beforeAll(async () => bootstrap());

  it("redirects to login when unauthenticated (root)", async () => {
    const r = await SELF.fetch("https://example.com/", { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/auth/login?redirect=%2F");
  });

  it("redirects to login when unauthenticated (/editor)", async () => {
    const r = await SELF.fetch("https://example.com/editor", { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toContain("/auth/login");
  });

  it("renders index.html with injected user + iridescence header", async () => {
    const r = await SELF.fetch("https://example.com/editor", {
      headers: authHeaders(),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/html");
    const html = await r.text();
    expect(html).toContain("window.__USER__");
    expect(html).toContain('"username":"alice"');
    expect(html).toContain('"role":"member"');
    expect(html).toContain("iri-header");
    // member should NOT see the Admin Panel link
    expect(html).not.toContain("Admin Panel");
  });

  it("shows the Admin Panel link for owner role", async () => {
    const r = await SELF.fetch("https://example.com/editor/", {
      headers: authHeaders(OWNER_SESSION_ID),
    });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('"role":"owner"');
    expect(html).toContain("Admin Panel");
  });
});
