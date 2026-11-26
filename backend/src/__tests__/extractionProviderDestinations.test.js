import { beforeEach, describe, expect, it, vi } from "vitest";

const { request, lookup } = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }));
vi.mock("node-fetch", () => ({ default: request }));
vi.mock("node:dns/promises", () => ({ lookup, default: { lookup } }));
const { fetchPublicUrl, extractWebSource } = await import("../services/extractionService.js");
const { parseTwitterBookmarksExport, parseTweetId, extractTweet, classifyUrl, extractUrlsFromText } = await import("../services/tweetExtractionService.js");

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

  it("stops waiting for DNS at the extraction deadline, including on redirects", async () => {
    const signal = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(signal.signal);
    const removeListener = vi.spyOn(signal.signal, "removeEventListener");
    const pendingDns = Promise.withResolvers();
    const dnsStarted = Promise.withResolvers();
    lookup.mockImplementationOnce(async () => [{ address: "8.8.8.8", family: 4 }]);
    lookup.mockImplementationOnce(() => {
      dnsStarted.resolve();
      return pendingDns.promise;
    });
    request.mockResolvedValueOnce({ status: 302, headers: { get: () => "https://example.org/guide" } });

    try {
      const extraction = fetchPublicUrl("https://example.com/guide");
      const assertion = expect(extraction).rejects.toThrow("Extraction deadline");
      await dnsStarted.promise;
      signal.abort(new Error("Extraction deadline"));
      await assertion;
      pendingDns.reject(new Error("Late DNS failure"));
      expect(request).toHaveBeenCalledTimes(1);
      expect(removeListener.mock.calls).toEqual([
        ["abort", expect.any(Function)],
        ["abort", expect.any(Function)],
      ]);
    } finally {
      timeout.mockRestore();
      removeListener.mockRestore();
    }
  });

  it("keeps aborted resolver work in the shared capacity limit until it settles", async () => {
    const pendingDns = Array.from({ length: 8 }, () => Promise.withResolvers());
    const controllers = pendingDns.map(() => new AbortController());
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const addresses = [{ address: "8.8.8.8", family: 4 }];
    for (const [index, pending] of pendingDns.entries()) {
      lookup.mockReturnValueOnce(pending.promise);
      timeout.mockReturnValueOnce(controllers[index].signal);
    }
    request.mockResolvedValue({ status: 200 });

    try {
      const attempts = controllers.map((_, index) =>
        index % 2 === 0 ? fetchPublicUrl("https://example.com") : extractWebSource("https://example.com"),
      );
      const results = Promise.allSettled(attempts);
      controllers.forEach((controller) => controller.abort(new Error("Extraction deadline")));
      expect((await results).every(({ status, reason }) =>
        status === "rejected" && reason.message === "Extraction deadline",
      )).toBe(true);

      await expect(extractWebSource("https://example.org")).rejects.toThrow("External DNS is busy");
      await expect(fetchPublicUrl("https://example.org")).rejects.toThrow("External DNS is busy");
      expect(lookup).toHaveBeenCalledTimes(8);
      expect(request).not.toHaveBeenCalled();

      pendingDns[0].reject(new Error("Late resolver failure"));
      await Promise.resolve();
      await expect(fetchPublicUrl("https://example.org")).resolves.toEqual({ status: 200 });
      expect(lookup).toHaveBeenCalledTimes(9);
    } finally {
      timeout.mockRestore();
      pendingDns.forEach(({ resolve }) => resolve(addresses));
    }
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
      return { ok: true, json: async () => ({ html: "<p>Hello &amp; welcome<br><a href='https://example.com/guide'><strong>Study</strong></a></p>" }) };
    });
    expect((await extractTweet("https://x.com/student/status/123?ref=study")).text).toBe("Hello & welcome\nStudy [https://example.com/guide]");
  });
});

it("classifies bookmark links by their destination host", () => {
  const article = "https://example.com/lesson?source=x.com";
  expect(extractUrlsFromText(article + " https://mobile.twitter.com/study https://t.co/short")).toEqual([article]);
  expect(classifyUrl("https://study.substack.com/guide")).toBe("article");
  expect(classifyUrl("https://notes.example.com/guide?source=substack.com")).toBe("website");
});

it("reads bookmark archives even when the text contains assignment characters", () => {
  const json = JSON.stringify([{ id: "123", text: "value = [answer]" }]);
  const records = parseTwitterBookmarksExport(json);
  expect(records[0].text).toBe("value = [answer]");
  expect(parseTwitterBookmarksExport("window.YTD.bookmark.part0 = " + json + ";")).toEqual(records);
  expect(extractUrlsFromText("https://example.com/note...!")).toEqual(["https://example.com/note"]);
});
