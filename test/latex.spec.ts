import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import { bootstrap, authHeaders } from "./setup";

describe("LaTeX compile proxy", () => {
  beforeAll(async () => {
    await bootstrap();
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });
  afterEach(() => fetchMock.assertNoPendingInterceptors());

  it("returns 400 when text is missing", async () => {
    const fd = new FormData();
    const r = await SELF.fetch("https://example.com/api/compile-latex", {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    });
    expect(r.status).toBe(400);
  });

  it("forwards source to latexonline and returns the PDF body", async () => {
    fetchMock
      .get("https://latexonline.cc")
      .intercept({ path: (p: string) => p.startsWith("/compile") })
      .reply(200, "%PDF-fake-bytes", {
        headers: { "Content-Type": "application/pdf" },
      });

    const fd = new FormData();
    fd.set("text", "\\documentclass{article}\\begin{document}hi\\end{document}");
    const r = await SELF.fetch("https://example.com/api/compile-latex", {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(await r.text()).toBe("%PDF-fake-bytes");
  });

  it("propagates non-OK responses from latexonline as 400", async () => {
    fetchMock
      .get("https://latexonline.cc")
      .intercept({ path: (p: string) => p.startsWith("/compile") })
      .reply(500, "boom");

    const fd = new FormData();
    fd.set("text", "junk");
    const r = await SELF.fetch("https://example.com/api/compile-latex", {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    });
    expect(r.status).toBe(400);
    expect(await r.text()).toBe("boom");
  });
});
