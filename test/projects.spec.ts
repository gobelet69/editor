import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import {
  bootstrap,
  authHeaders,
  OWNER_SESSION_ID,
  createProject,
  seedSession,
  seedUser,
} from "./setup";

describe("projects", () => {
  beforeAll(async () => bootstrap());
  beforeEach(async () => bootstrap());

  it("POST creates a project owned by the caller", async () => {
    const r = await SELF.fetch("https://example.com/api/projects", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "MyProj", description: "d", git_repo: "u/r", git_branch: "dev" }),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.id).toBeTruthy();
    expect(j.name).toBe("MyProj");
    expect(j.owner).toBe("alice");

    const row = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(j.id).first() as any;
    expect(row.owner).toBe("alice");
    expect(row.git_repo).toBe("u/r");
    expect(row.git_branch).toBe("dev");
  });

  it("POST defaults name to 'Untitled' when missing", async () => {
    const r = await SELF.fetch("https://example.com/api/projects", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const j = await r.json() as any;
    expect(j.name).toBe("Untitled");
  });

  it("GET lists owned + shared projects, splitting them", async () => {
    const owned = await createProject("Mine", "alice");
    const otherOwned = await createProject("Theirs", "bob");
    await env.DB.prepare(
      "INSERT INTO project_members (project_id, username) VALUES (?, ?)"
    ).bind(otherOwned, "alice").run();

    const r = await SELF.fetch("https://example.com/api/projects", { headers: authHeaders() });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.owned.map((p: any) => p.id)).toContain(owned);
    expect(j.shared.map((p: any) => p.id)).toContain(otherOwned);
    expect(j.owned.map((p: any) => p.id)).not.toContain(otherOwned);
  });

  it("GET /api/projects/:id returns the project", async () => {
    const id = await createProject("A");
    const r = await SELF.fetch(`https://example.com/api/projects/${id}`, { headers: authHeaders() });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.id).toBe(id);
    expect(j.name).toBe("A");
  });

  it("GET unknown project returns 404", async () => {
    const r = await SELF.fetch("https://example.com/api/projects/does-not-exist", {
      headers: authHeaders(),
    });
    expect(r.status).toBe(404);
  });

  it("PUT updates name/description/git fields", async () => {
    const id = await createProject("Old");
    const r = await SELF.fetch(`https://example.com/api/projects/${id}`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New", description: "x", git_repo: "u/r2", git_branch: "b" }),
    });
    expect(r.status).toBe(200);
    const row = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first() as any;
    expect(row.name).toBe("New");
    expect(row.description).toBe("x");
    expect(row.git_repo).toBe("u/r2");
    expect(row.git_branch).toBe("b");
  });

  it("PUT with empty body is a no-op success", async () => {
    const id = await createProject("Same");
    const r = await SELF.fetch(`https://example.com/api/projects/${id}`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(200);
    const row = await env.DB.prepare("SELECT name FROM projects WHERE id = ?").bind(id).first() as any;
    expect(row.name).toBe("Same");
  });

  it("DELETE by owner cascades files/folders/members", async () => {
    const id = await createProject("ToDelete", "alice");
    await env.DB.prepare("INSERT INTO folders (id, name, parent_id, project_id) VALUES (?, ?, ?, ?)")
      .bind("f1", "F", null, id).run();
    await env.DB.prepare("INSERT INTO files (id, name, folder_id, project_id, content) VALUES (?, ?, ?, ?, ?)")
      .bind("file1", "x.txt", null, id, "hi").run();
    await env.DB.prepare("INSERT INTO project_members (project_id, username) VALUES (?, ?)")
      .bind(id, "bob").run();

    const r = await SELF.fetch(`https://example.com/api/projects/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(r.status).toBe(200);

    const proj = await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(id).first();
    expect(proj).toBeNull();
    const { results: files } = await env.DB.prepare("SELECT id FROM files WHERE project_id = ?").bind(id).all();
    const { results: folders } = await env.DB.prepare("SELECT id FROM folders WHERE project_id = ?").bind(id).all();
    const { results: members } = await env.DB.prepare("SELECT username FROM project_members WHERE project_id = ?").bind(id).all();
    expect(files.length).toBe(0);
    expect(folders.length).toBe(0);
    expect(members.length).toBe(0);
  });

  it("DELETE by non-owner non-admin returns 403", async () => {
    const id = await createProject("BobsProj", "bob");
    const r = await SELF.fetch(`https://example.com/api/projects/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(r.status).toBe(403);
    const proj = await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(id).first();
    expect(proj).not.toBeNull();
  });

  it("DELETE allowed for admin role even on someone else's project", async () => {
    const id = await createProject("BobsProj", "bob");
    const r = await SELF.fetch(`https://example.com/api/projects/${id}`, {
      method: "DELETE",
      headers: authHeaders(OWNER_SESSION_ID),
    });
    expect(r.status).toBe(200);
  });
});

describe("project join", () => {
  beforeAll(async () => bootstrap());
  beforeEach(async () => bootstrap());

  it("POST /api/projects/join requires project_id", async () => {
    const r = await SELF.fetch("https://example.com/api/projects/join", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it("returns 404 when project does not exist", async () => {
    const r = await SELF.fetch("https://example.com/api/projects/join", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: "nope" }),
    });
    expect(r.status).toBe(404);
  });

  it("inserts a project_members row on join, idempotently", async () => {
    const id = await createProject("Open", "bob");
    const r1 = await SELF.fetch("https://example.com/api/projects/join", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: id }),
    });
    expect(r1.status).toBe(200);
    const j = await r1.json() as any;
    expect(j.success).toBe(true);
    expect(j.project.id).toBe(id);

    // second join should not error and should not duplicate
    const r2 = await SELF.fetch("https://example.com/api/projects/join", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: id }),
    });
    expect(r2.status).toBe(200);
    const { results } = await env.DB.prepare(
      "SELECT username FROM project_members WHERE project_id = ? AND username = ?"
    ).bind(id, "alice").all();
    expect(results.length).toBe(1);
  });
});

// keep helper imports referenced
void seedSession; void seedUser;
