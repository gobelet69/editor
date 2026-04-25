import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { bootstrap, authHeaders, createProject } from "./setup";

describe("files", () => {
  beforeAll(async () => bootstrap());
  beforeEach(async () => bootstrap());

  it("POST creates a file (no folder)", async () => {
    const pid = await createProject("P");
    const r = await SELF.fetch("https://example.com/api/files", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "main.tex", project_id: pid, content: "\\documentclass" }),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.name).toBe("main.tex");
    expect(j.folder_id).toBeNull();

    const row = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(j.id).first() as any;
    expect(row.content).toBe("\\documentclass");
  });

  it("POST defaults content to empty string", async () => {
    const pid = await createProject("P");
    const r = await SELF.fetch("https://example.com/api/files", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "blank.txt", project_id: pid }),
    });
    const j = await r.json() as any;
    const row = await env.DB.prepare("SELECT content FROM files WHERE id = ?").bind(j.id).first() as any;
    expect(row.content).toBe("");
  });

  it("GET ?project_id= filters files and excludes content", async () => {
    const a = await createProject("A");
    const b = await createProject("B");
    await env.DB.prepare("INSERT INTO files (id, name, folder_id, project_id, content) VALUES (?, ?, ?, ?, ?)")
      .bind("fa", "a.txt", null, a, "secret-a").run();
    await env.DB.prepare("INSERT INTO files (id, name, folder_id, project_id, content) VALUES (?, ?, ?, ?, ?)")
      .bind("fb", "b.txt", null, b, "secret-b").run();

    const r = await SELF.fetch(`https://example.com/api/files?project_id=${a}`, { headers: authHeaders() });
    const j = await r.json() as any[];
    expect(j.map(x => x.id)).toEqual(["fa"]);
    expect(j[0].content).toBeUndefined(); // list endpoint omits content
  });

  it("GET /api/files/:id returns the full file with content", async () => {
    const pid = await createProject("P");
    await env.DB.prepare("INSERT INTO files (id, name, folder_id, project_id, content) VALUES (?, ?, ?, ?, ?)")
      .bind("f1", "x.txt", null, pid, "hello").run();
    const r = await SELF.fetch("https://example.com/api/files/f1", { headers: authHeaders() });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.content).toBe("hello");
  });

  it("GET unknown file returns 404", async () => {
    const r = await SELF.fetch("https://example.com/api/files/nope", { headers: authHeaders() });
    expect(r.status).toBe(404);
  });

  it("PUT updates content / name / folder_id independently", async () => {
    const pid = await createProject("P");
    await env.DB.prepare("INSERT INTO folders (id, name, parent_id, project_id) VALUES (?, ?, ?, ?)")
      .bind("fld", "fld", null, pid).run();
    await env.DB.prepare("INSERT INTO files (id, name, folder_id, project_id, content) VALUES (?, ?, ?, ?, ?)")
      .bind("f", "old.txt", null, pid, "old").run();

    const r1 = await SELF.fetch("https://example.com/api/files/f", {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ content: "new-content" }),
    });
    expect(r1.status).toBe(200);

    const r2 = await SELF.fetch("https://example.com/api/files/f", {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new.txt" }),
    });
    expect(r2.status).toBe(200);

    const r3 = await SELF.fetch("https://example.com/api/files/f", {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ folder_id: "fld" }),
    });
    expect(r3.status).toBe(200);

    const row = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind("f").first() as any;
    expect(row.content).toBe("new-content");
    expect(row.name).toBe("new.txt");
    expect(row.folder_id).toBe("fld");
  });

  it("DELETE removes a file", async () => {
    const pid = await createProject("P");
    await env.DB.prepare("INSERT INTO files (id, name, folder_id, project_id, content) VALUES (?, ?, ?, ?, ?)")
      .bind("f", "x.txt", null, pid, "").run();
    const r = await SELF.fetch("https://example.com/api/files/f", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(r.status).toBe(200);
    const row = await env.DB.prepare("SELECT id FROM files WHERE id = ?").bind("f").first();
    expect(row).toBeNull();
  });
});
