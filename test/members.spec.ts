import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { bootstrap, authHeaders, createProject, OWNER_SESSION_ID, seedUser } from "./setup";

describe("project members + invite", () => {
  beforeAll(async () => bootstrap());
  beforeEach(async () => bootstrap());

  it("GET /api/projects/:id/members returns members", async () => {
    const id = await createProject("P", "alice");
    await env.DB.prepare("INSERT INTO project_members (project_id, username) VALUES (?, ?)")
      .bind(id, "bob").run();
    const r = await SELF.fetch(`https://example.com/api/projects/${id}/members`, {
      headers: authHeaders(),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as any[];
    expect(j.map(m => m.username)).toContain("bob");
  });

  it("POST invite requires username", async () => {
    const id = await createProject("P", "alice");
    const r = await SELF.fetch(`https://example.com/api/projects/${id}/invite`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it("POST invite returns 404 if target user does not exist", async () => {
    const id = await createProject("P", "alice");
    const r = await SELF.fetch(`https://example.com/api/projects/${id}/invite`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: "ghost" }),
    });
    expect(r.status).toBe(404);
  });

  it("POST invite by owner succeeds", async () => {
    const id = await createProject("P", "alice");
    await seedUser("bob");
    const r = await SELF.fetch(`https://example.com/api/projects/${id}/invite`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: "bob" }),
    });
    expect(r.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT * FROM project_members WHERE project_id = ? AND username = ?"
    ).bind(id, "bob").first();
    expect(row).not.toBeNull();
  });

  it("POST invite by non-owner non-admin returns 403", async () => {
    const id = await createProject("P", "bob");
    await seedUser("carol");
    const r = await SELF.fetch(`https://example.com/api/projects/${id}/invite`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ username: "carol" }),
    });
    expect(r.status).toBe(403);
  });

  it("admin role can invite to any project", async () => {
    const id = await createProject("P", "bob");
    await seedUser("carol");
    const r = await SELF.fetch(`https://example.com/api/projects/${id}/invite`, {
      method: "POST",
      headers: { ...authHeaders(OWNER_SESSION_ID), "Content-Type": "application/json" },
      body: JSON.stringify({ username: "carol" }),
    });
    expect(r.status).toBe(200);
  });

  it("invite is idempotent", async () => {
    const id = await createProject("P", "alice");
    await seedUser("bob");
    for (let i = 0; i < 2; i++) {
      const r = await SELF.fetch(`https://example.com/api/projects/${id}/invite`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ username: "bob" }),
      });
      expect(r.status).toBe(200);
    }
    const { results } = await env.DB.prepare(
      "SELECT username FROM project_members WHERE project_id = ? AND username = ?"
    ).bind(id, "bob").all();
    expect(results.length).toBe(1);
  });
});
