import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { bootstrap, authHeaders, createProject } from "./setup";

describe("folders", () => {
  beforeAll(async () => bootstrap());
  beforeEach(async () => bootstrap());

  it("POST creates a folder scoped to a project", async () => {
    const pid = await createProject("P");
    const r = await SELF.fetch("https://example.com/api/folders", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "src", project_id: pid }),
    });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.name).toBe("src");
    expect(j.project_id).toBe(pid);
    expect(j.parent_id).toBeNull();
  });

  it("POST supports nested parent folder", async () => {
    const pid = await createProject("P");
    const parent = await SELF.fetch("https://example.com/api/folders", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "src", project_id: pid }),
    }).then(r => r.json()) as any;
    const child = await SELF.fetch("https://example.com/api/folders", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "lib", project_id: pid, parent_id: parent.id }),
    }).then(r => r.json()) as any;
    expect(child.parent_id).toBe(parent.id);
  });

  it("GET ?project_id= filters folders", async () => {
    const a = await createProject("A");
    const b = await createProject("B");
    await env.DB.prepare("INSERT INTO folders (id, name, parent_id, project_id) VALUES (?, ?, ?, ?)")
      .bind("fa", "fa", null, a).run();
    await env.DB.prepare("INSERT INTO folders (id, name, parent_id, project_id) VALUES (?, ?, ?, ?)")
      .bind("fb", "fb", null, b).run();
    const r = await SELF.fetch(`https://example.com/api/folders?project_id=${a}`, { headers: authHeaders() });
    const j = await r.json() as any[];
    expect(j.map(x => x.id)).toEqual(["fa"]);
  });

  it("GET without project_id returns all folders", async () => {
    const a = await createProject("A");
    await env.DB.prepare("INSERT INTO folders (id, name, parent_id, project_id) VALUES (?, ?, ?, ?)")
      .bind("solo", "solo", null, a).run();
    const r = await SELF.fetch("https://example.com/api/folders", { headers: authHeaders() });
    const j = await r.json() as any[];
    expect(j.find(x => x.id === "solo")).toBeTruthy();
  });

  it("PUT renames a folder", async () => {
    const pid = await createProject("P");
    await env.DB.prepare("INSERT INTO folders (id, name, parent_id, project_id) VALUES (?, ?, ?, ?)")
      .bind("f1", "old", null, pid).run();
    const r = await SELF.fetch("https://example.com/api/folders/f1", {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new" }),
    });
    expect(r.status).toBe(200);
    const row = await env.DB.prepare("SELECT name FROM folders WHERE id = ?").bind("f1").first() as any;
    expect(row.name).toBe("new");
  });

  it("DELETE recursively removes subfolders and their files", async () => {
    const pid = await createProject("P");
    await env.DB.prepare("INSERT INTO folders (id, name, parent_id, project_id) VALUES (?, ?, ?, ?)")
      .bind("root", "root", null, pid).run();
    await env.DB.prepare("INSERT INTO folders (id, name, parent_id, project_id) VALUES (?, ?, ?, ?)")
      .bind("child", "child", "root", pid).run();
    await env.DB.prepare("INSERT INTO folders (id, name, parent_id, project_id) VALUES (?, ?, ?, ?)")
      .bind("grand", "grand", "child", pid).run();
    await env.DB.prepare("INSERT INTO files (id, name, folder_id, project_id, content) VALUES (?, ?, ?, ?, ?)")
      .bind("file-root", "a.txt", "root", pid, "").run();
    await env.DB.prepare("INSERT INTO files (id, name, folder_id, project_id, content) VALUES (?, ?, ?, ?, ?)")
      .bind("file-grand", "b.txt", "grand", pid, "").run();

    const r = await SELF.fetch("https://example.com/api/folders/root", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(r.status).toBe(200);

    const { results: folders } = await env.DB.prepare("SELECT id FROM folders WHERE project_id = ?").bind(pid).all();
    const { results: files } = await env.DB.prepare("SELECT id FROM files WHERE project_id = ?").bind(pid).all();
    expect(folders.length).toBe(0);
    expect(files.length).toBe(0);
  });
});
