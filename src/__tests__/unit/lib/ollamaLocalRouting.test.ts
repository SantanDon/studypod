import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cloudResponse } = vi.hoisted(() => ({ cloudResponse: vi.fn() }));

vi.mock("@/lib/ai/serverAiClient", () => ({ generateServerAiResponse: cloudResponse }));

describe("local Ollama routing", () => {
  it("assembles fragmented UTF-8 streams, keeps reasoning private, and uses the configured reasoning budget", async () => {
    vi.stubEnv("VITE_ENABLE_OLLAMA", "true");
    vi.stubEnv("VITE_OLLAMA_THINK", "true");
    vi.stubEnv("VITE_OLLAMA_CONTEXT", "65536");
    vi.stubEnv("VITE_OLLAMA_MODEL", "bonsai-2:27b");
    let request: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "bonsai-2:27b" }] }));
      request = JSON.parse(String(init?.body));
      const bytes = new TextEncoder().encode('{"thinking":"private"}\n{"response":"Café"}\n{"response":" works","done":true}');
      return new Response(new ReadableStream({ start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      } }));
    }));
    const { chatCompletion } = await import("@/lib/ai/ollamaService");
    const chunks: string[] = [];
    await expect(chatCompletion({ messages: [{ role: "user", content: "Say hello" }], stream: true, onChunk: c => chunks.push(c), maxOutputTokens: 1024 })).resolves.toBe("Café works");
    expect(chunks.join("")).toBe("Café works");
    expect(request).toMatchObject({ think: true, options: { num_ctx: 65536, num_predict: 9216 } });
    expect(request.options).not.toHaveProperty("top_k");
  });

  it("sends the supplied JSON schema to native Ollama without disabling reasoning", async () => {
    vi.stubEnv("VITE_ENABLE_OLLAMA", "true");
    vi.stubEnv("VITE_OLLAMA_THINK", "true");
    vi.stubEnv("VITE_OLLAMA_MODEL", "bonsai-2:27b");
    let request: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "bonsai-2:27b" }] }));
      request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ response: '{"title":"Works"}', done: true }));
    }));
    const { chatCompletion } = await import("@/lib/ai/ollamaService");
    const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };
    await chatCompletion({ messages: [{ role: "user", content: "Return a title" }], jsonMode: true, jsonSchema: schema, maxOutputTokens: 1024 });
    expect(request).toMatchObject({ format: schema, think: true });
  });

  it.each([
    ['{"response":"partial"}\n', /before completion/],
    ['{"done":true,"done_reason":"length"}\n', /token limit/],
    ['{"thinking":"private","done":true}\n', /no answer text/],
    ['{"error":"model failed"}\n', /model failed/],
  ])("rejects an unsuccessful stream: %s", async (body, error) => {
    vi.stubEnv("VITE_ENABLE_OLLAMA", "true");
    vi.stubEnv("VITE_OLLAMA_MODEL", "test:latest");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(
      String(input).endsWith("/api/tags") ? JSON.stringify({ models: [{ name: "test:latest" }] }) : body,
    )));
    const { chatCompletion } = await import("@/lib/ai/ollamaService");
    await expect(chatCompletion({ messages: [{ role: "user", content: "Say hello" }], stream: true, onChunk: () => {} })).rejects.toThrow(error);
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.stubEnv("VITE_ENABLE_OLLAMA", "false");
    vi.stubEnv("VITE_OLLAMA_THINK", "false");
    vi.stubEnv("VITE_OLLAMA_CONTEXT", "");
    vi.stubEnv("VITE_OLLAMA_MODEL", "");
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

  it.each([30_000, 900_000])("keeps the %ims generation deadline active after headers while the response body is stalled", async (duration) => {
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
    const completion = chatCompletion({
      messages: [{ role: "user", content: "Explain this briefly" }],
      ...(duration > 30_000 ? {deadlineAt: Date.now() + duration} : {}),
    });
    await bodyIsPending;
    expect(generateSignal?.aborted).toBe(false);

    const timeoutRejection = expect(completion).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(duration - 1);
    expect(generateSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
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
