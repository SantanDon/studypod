import { afterEach, describe, expect, it, vi } from "vitest";
import { generateTextToString } from "@/lib/ai/ollamaClient";

const modelResponse = () =>
  new Response(JSON.stringify({ models: [{ name: "test-model:latest" }] }), {
    headers: { "content-type": "application/json" },
  });

function mockGeneration(body: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/api/tags")) return modelResponse();
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("generateTextToString completion integrity", () => {
  const options = { model: "test-model:latest", prompt: "Explain justice." };

  it("returns text from a normally completed response", async () => {
    mockGeneration({ response: "Justice means giving each what is due.", done: true, done_reason: "stop" });

    await expect(generateTextToString(options)).resolves.toBe(
      "Justice means giving each what is due.",
    );
  });

  it.each([
    { done: true, done_reason: "length" },
    { done: false, done_reason: "stop" },
  ])("rejects explicitly incomplete response metadata: %o", async (completion) => {
    mockGeneration({ response: "Justice means giving each", ...completion });

    await expect(generateTextToString(options)).rejects.toThrow(
      "ended before completion",
    );
  });

  it("propagates caller aborts instead of returning partial text", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("Cancelled", "AbortError");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/tags")) return modelResponse();
      controller.abort(abortError);
      const response = new Response("", {
        headers: { "content-type": "application/json" },
      });
      response.json = vi.fn().mockRejectedValue(abortError);
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateTextToString({ ...options, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
