import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cloudResponse } = vi.hoisted(() => ({ cloudResponse: vi.fn() }));

vi.mock("@/lib/ai/serverAiClient", () => ({ generateServerAiResponse: cloudResponse }));

describe("local Ollama routing", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubEnv("VITE_ENABLE_OLLAMA", "false");
    vi.stubEnv("VITE_OLLAMA_URL", "http://127.0.0.1:11434");
    cloudResponse.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    window.localStorage.clear();
    vi.resetModules();
  });

  it("runtime opt-in calls the configured local endpoint and reports outage without cloud fallback", async () => {
    const config = await import("@/config/ollamaConfig");
    config.setRuntimeOllamaEnabled(true);
    config.setRuntimeOllamaBaseUrl("http://127.0.0.1:11434/");

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { chatCompletion } = await import("@/lib/ai/ollamaService");
    await expect(chatCompletion({
      messages: [{ role: "user", content: "Explain this briefly" }],
    })).rejects.toThrow(/Could not reach Ollama from this browser.*browser permissions or CORS/i);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/generate",
    ]);
    expect(cloudResponse).not.toHaveBeenCalled();
  });

  it("rejects a missing selected model and keeps discovery caches separate by endpoint", async () => {
    const config = await import("@/config/ollamaConfig");
    config.setRuntimeOllamaEnabled(true);
    window.localStorage.setItem("ollama-default-models", JSON.stringify({ chat: "qwen3.5:9b" }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({
      models: [{ name: String(input).includes("endpoint-a") ? "model-a:latest" : "model-b:latest" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { chatCompletion } = await import("@/lib/ai/ollamaService");

    config.setRuntimeOllamaBaseUrl("http://endpoint-a:11434");
    await expect(chatCompletion({ messages: [{ role: "user", content: "test question" }], localOnly: true }))
      .rejects.toThrow(/Selected Ollama model "qwen3\.5:9b" is not installed/);
    config.setRuntimeOllamaBaseUrl("http://endpoint-b:11434");
    await expect(chatCompletion({ messages: [{ role: "user", content: "test question" }], localOnly: true }))
      .rejects.toThrow(/Selected Ollama model "qwen3\.5:9b" is not installed/);

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://endpoint-a:11434/api/tags",
      "http://endpoint-b:11434/api/tags",
    ]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/generate"))).toBe(false);
  });

  it("a request-scoped local-only route does not fall back to cloud when runtime opt-in is off", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { chatCompletion } = await import("@/lib/ai/ollamaService");
    await expect(chatCompletion({
      messages: [{ role: "user", content: "Explain this briefly" }],
      localOnly: true,
    })).rejects.toThrow(/Could not reach Ollama from this browser.*browser permissions or CORS/i);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(cloudResponse).not.toHaveBeenCalled();
  });

  it("runtime disable overrides build-time opt-in and routes ordinary chat to cloud", async () => {
    vi.stubEnv("VITE_ENABLE_OLLAMA", "true");
    const config = await import("@/config/ollamaConfig");
    config.setRuntimeOllamaEnabled(false);
    cloudResponse.mockResolvedValue("cloud response");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { chatCompletion } = await import("@/lib/ai/ollamaService");
    await expect(chatCompletion({
      messages: [{ role: "user", content: "Hello" }],
    })).resolves.toBe("cloud response");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(cloudResponse).toHaveBeenCalledTimes(1);
  });

  it("keeps the generation deadline active after headers while the response body is stalled", async () => {
    vi.useFakeTimers();
    const config = await import("@/config/ollamaConfig");
    config.setRuntimeOllamaEnabled(true);
    config.setRuntimeOllamaBaseUrl("http://127.0.0.1:11434");

    let generateSignal: AbortSignal | undefined;
    let bodyStarted!: () => void;
    const bodyIsPending = new Promise<void>((resolve) => { bodyStarted = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      generateSignal = init?.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          bodyStarted(); // fetch has returned headers; json() will now wait on this body.
          generateSignal?.addEventListener("abort", () => controller.error(generateSignal?.reason), { once: true });
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { chatCompletion } = await import("@/lib/ai/ollamaService");
    const completion = chatCompletion({ messages: [{ role: "user", content: "Explain this briefly" }] });
    await bodyIsPending;
    expect(generateSignal?.aborted).toBe(false);

    const timeoutRejection = expect(completion).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(30_000);
    // An aborted generation must reject rather than look like a valid empty answer.
    await timeoutRejection;
    expect(generateSignal?.aborted).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/generate"))).toBe(true);
  });

  it("aborts a stalled response body when the caller cancels", async () => {
    const config = await import("@/config/ollamaConfig");
    config.setRuntimeOllamaEnabled(true);
    config.setRuntimeOllamaBaseUrl("http://127.0.0.1:11434");

    let bodyStarted!: () => void;
    const bodyIsPending = new Promise<void>((resolve) => { bodyStarted = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const signal = init?.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          bodyStarted();
          signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { chatCompletion } = await import("@/lib/ai/ollamaService");
    const caller = new AbortController();
    const completion = chatCompletion({
      messages: [{ role: "user", content: "Explain this briefly" }],
      signal: caller.signal,
    });
    await bodyIsPending;
    caller.abort(new DOMException("Caller cancelled", "AbortError"));

    await expect(completion).rejects.toMatchObject({ name: "AbortError" });
  });
});
