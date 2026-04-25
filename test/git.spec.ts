import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { SELF, env, fetchMock } from "cloudflare:test";
import { bootstrap, authHeaders, createProject } from "./setup";

async function setToken(username: string, token: string | null) {
  await env.AUTH_DB.prepare(
    "INSERT OR REPLACE INTO user_integrations (username, github_token) VALUES (?, ?)"
  ).bind(username, token).run();
}

describe("GitHub OAuth login redirect", () => {
  beforeAll(async () => bootstrap());

  it("redirects to github with client_id and scope", async () => {
    await env.AUTH_DB.prepare(
      "INSERT OR REPLACE INTO server_settings (key, value) VALUES (?, ?)"
    ).bind("GITHUB_CLIENT_ID", "abc123").run();

    const r = await SELF.fetch("https://example.com/auth/github/login", {
      headers: authHeaders(),
      redirect: "manual",
    });
    expect(r.status).toBe(302);
    const loc = r.headers.get("Location") || "";
    expect(loc).toContain("github.com/login/oauth/authorize");
    expect(loc).toContain("client_id=abc123");
    expect(loc).toContain("scope=repo");
  });

  it("returns 500 if no client id is configured", async () => {
    await env.AUTH_DB.prepare("DELETE FROM server_settings").run();
    const r = await SELF.fetch("https://example.com/auth/github/login", {
      headers: authHeaders(),
    });
    expect(r.status).toBe(500);
  });
});

describe("GitHub repos endpoint", () => {
  beforeAll(async () => {
    await bootstrap();
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });
  afterEach(() => fetchMock.assertNoPendingInterceptors());

  it("returns has_token:false when user has no token", async () => {
    const r = await SELF.fetch("https://example.com/api/git/repos", { headers: authHeaders() });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ has_token: false });
  });

  it("lists repos when token is present", async () => {
    await setToken("alice", "ghp_test");
    fetchMock
      .get("https://api.github.com")
      .intercept({ path: (p: string) => p.startsWith("/user/repos") })
      .reply(200, [
        { full_name: "alice/foo", default_branch: "main", private: false, extra: "ignored" },
        { full_name: "alice/bar", default_branch: "dev",  private: true,  extra: "ignored" },
      ]);

    const r = await SELF.fetch("https://example.com/api/git/repos", { headers: authHeaders() });
    expect(r.status).toBe(200);
    const j = await r.json() as any;
    expect(j.has_token).toBe(true);
    expect(j.repos).toEqual([
      { full_name: "alice/foo", default_branch: "main", private: false },
      { full_name: "alice/bar", default_branch: "dev",  private: true  },
    ]);
  });

  it("clears the token and returns has_token:false on 401", async () => {
    await setToken("alice", "ghp_bad");
    fetchMock
      .get("https://api.github.com")
      .intercept({ path: (p: string) => p.startsWith("/user/repos") })
      .reply(401, "unauthorized");

    const r = await SELF.fetch("https://example.com/api/git/repos", { headers: authHeaders() });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ has_token: false });

    const row = await env.AUTH_DB.prepare(
      "SELECT github_token FROM user_integrations WHERE username = ?"
    ).bind("alice").first() as any;
    expect(row.github_token).toBeNull();
  });
});

describe("git push / pull guards", () => {
  beforeAll(async () => bootstrap());

  it("push: 400 when params missing", async () => {
    const r = await SELF.fetch("https://example.com/api/git/push", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it("push: 401 when no GitHub token", async () => {
    const pid = await createProject("P");
    const r = await SELF.fetch("https://example.com/api/git/push", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "u/r", project_id: pid }),
    });
    expect(r.status).toBe(401);
  });

  it("pull: 400 when params missing", async () => {
    const r = await SELF.fetch("https://example.com/api/git/pull", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it("pull: 401 when no GitHub token", async () => {
    const pid = await createProject("P");
    const r = await SELF.fetch("https://example.com/api/git/pull", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "u/r", project_id: pid }),
    });
    expect(r.status).toBe(401);
  });
});

describe("git pull happy path", () => {
  beforeAll(async () => {
    await bootstrap();
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });
  afterEach(() => fetchMock.assertNoPendingInterceptors());

  it("imports the repo tree into the project", async () => {
    const pid = await createProject("P", "alice");
    await setToken("alice", "ghp_ok");

    fetchMock
      .get("https://api.github.com")
      .intercept({ path: "/repos/u/r/git/trees/main?recursive=1" })
      .reply(200, {
        tree: [
          { path: "README.md", type: "blob", sha: "shaA" },
          { path: "src/index.ts", type: "blob", sha: "shaB" },
          { path: "src", type: "tree", sha: "shaT" },
        ],
      });
    fetchMock.get("https://api.github.com")
      .intercept({ path: "/repos/u/r/git/blobs/shaA" }).reply(200, "# hi");
    fetchMock.get("https://api.github.com")
      .intercept({ path: "/repos/u/r/git/blobs/shaB" }).reply(200, "console.log('x')");

    const r = await SELF.fetch("https://example.com/api/git/pull", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "u/r", branch: "main", project_id: pid }),
    });
    expect(r.status).toBe(200);

    const { results: files } = await env.DB.prepare(
      "SELECT name, content, folder_id FROM files WHERE project_id = ? ORDER BY name"
    ).bind(pid).all();
    expect(files.length).toBe(2);
    const readme = files.find((f: any) => f.name === "README.md") as any;
    const src = files.find((f: any) => f.name === "index.ts") as any;
    expect(readme.content).toBe("# hi");
    expect(readme.folder_id).toBeNull();
    expect(src.content).toBe("console.log('x')");
    expect(src.folder_id).not.toBeNull();

    const { results: folders } = await env.DB.prepare(
      "SELECT name FROM folders WHERE project_id = ?"
    ).bind(pid).all();
    expect(folders.map((f: any) => f.name)).toEqual(["src"]);
  });
});
