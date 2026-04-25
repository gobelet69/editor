import { describe, it, expect, beforeAll } from "vitest";
import { SELF } from "cloudflare:test";
import { bootstrap } from "./setup";

// High-level smoke test. Detailed behavior lives in the per-feature *.spec.ts files.
describe("editor worker smoke", () => {
  beforeAll(async () => bootstrap());

  it("unauthenticated root redirects to /auth/login", async () => {
    const r = await SELF.fetch("https://example.com/", { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toContain("/auth/login");
  });

  it("unknown API path returns 404 when authed", async () => {
    const r = await SELF.fetch("https://example.com/api/nope", {
      headers: { Cookie: "sess=sess-alice" },
    });
    expect(r.status).toBe(404);
  });
});
