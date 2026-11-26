import { beforeEach, describe, expect, it, vi } from "vitest";

const { request, lookup } = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }));
vi.mock("node-fetch", () => ({ default: request }));
vi.mock("node:dns/promises", () => ({ lookup, default: { lookup } }));
const { fetchPublicUrl, extractWebSource } = await import("../services/extractionService.js");
const { parseTweetId, extractTweet } = await import("../services/tweetExtractionService.js");

describe("source extraction destinations", () => {
  beforeEach(() => {
    request.mockReset();
    lookup.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  });

  it("uses the approved addresses at socket creation without another DNS lookup", async () => {
    request.mockResolvedValue({ status: 200 });
    await fetchPublicUrl("https://example.com/guide", {});
    const { agent, redirect } = request.mock.calls[0][1];
    expect(redirect).toBe("manual");
    const addresses = await new Promise((resolve, reject) => {
      agent.options.lookup("example.com", { all: true }, (error, result) => error ? reject(error) : resolve(result));
    });
    expect(addresses).toEqual([{ address: "8.8.8.8", family: 4 }]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("stops the entire extraction chain when the redirect violates destination policy", async () => {
    request.mockResolvedValue({ status: 302, headers: { get: () => "http://example.com/guide" } });
    await expect(extractWebSource("https://example.com/guide")).rejects.toThrow(/HTTPS/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("fetches GitHub metadata, trees and nested file paths from their designated providers", async () => {
    request.mockResolvedValueOnce({ ok: true, json: async () => ({ default_branch: "study/guide" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tree: [{ type: "blob", path: "notes/week 1.md" }] }) })
      .mockResolvedValueOnce({ ok: true, text: async () => "Study guide contents" });
    const result = await extractWebSource("https://github.com/study-team/sample");
    expect(result.content).toContain("Study guide contents");
    expect(request.mock.calls.map(([url]) => String(url))).toEqual([
      "https://api.github.com/repos/study-team/sample",
      "https://api.github.com/repos/study-team/sample/git/trees/study/guide?recursive=1",
      "https://raw.githubusercontent.com/study-team/sample/study/guide/notes/week%201.md",
    ]);
    expect(request.mock.calls.every(([, options]) => options.redirect === "error")).toBe(true);
  });

  it("sends Reader fallback requests only to Jina while retaining source query parameters", async () => {
    request.mockResolvedValueOnce({ status: 403, ok: false })
      .mockResolvedValueOnce({ ok: true, text: async () => "Title: Example\n" + "Reading material. ".repeat(9) });
    expect((await extractWebSource("https://example.com/guide?page=2")).title).toBe("Example");
    const [url, options] = request.mock.calls[1];
    expect(String(url)).toBe("https://r.jina.ai/https://example.com/guide?page=2");
    expect(options.redirect).toBe("error");
  });

  it("recognizes real tweet permalinks and constructs a canonical oEmbed URL", async () => {
    expect(parseTweetId("https://example.com/twitter.com/user/status/123")).toBeNull();
    expect(parseTweetId("https://mobile.twitter.com/i/web/status/123")).toBe("123");
    request.mockImplementation(async (url, options) => {
      expect(options.redirect).toBe("error");
      if (url.hostname === "api.twitter.com") return { ok: false, status: 403 };
      expect(url.origin).toBe("https://publish.twitter.com");
      expect(url.searchParams.get("url")).toBe("https://twitter.com/i/web/status/123");
      return { ok: true, json: async () => ({ html: "<p>Hello</p>" }) };
    });
    expect((await extractTweet("https://x.com/student/status/123?ref=study")).text).toBe("Hello");
  });
});
