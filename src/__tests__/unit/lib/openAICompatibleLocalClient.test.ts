import { afterEach, expect, it, vi } from "vitest";
import { getLocalModelSettings, saveLocalModelSettings, setLocalModelApiKey } from "@/config/localModelConfig";
import { boundCompatibleChatMessages, checkCompatibleLocalModel, completeCompatibleLocalChat } from "@/lib/ai/openAICompatibleLocalClient";

afterEach(() => { localStorage.clear(); setLocalModelApiKey(""); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("normalizes LM Studio defaults and keeps credentials out of persistent settings", () => {
  const settings = saveLocalModelSettings({ provider: "lm-studio", enabled: true });
  setLocalModelApiKey("session-secret");
  expect(settings.baseUrl).toBe("http://localhost:1234/v1");
  expect(getLocalModelSettings()).toMatchObject({ provider: "lm-studio", enabled: true });
  expect(localStorage.getItem("studypod.localModel.settings.v1")).not.toContain("session-secret");
});

it("discovers OpenAI-compatible model ids and sends chat through the selected endpoint", async () => {
  saveLocalModelSettings({ provider: "custom", baseUrl: "http://127.0.0.1:8080", model: "local-chat", enabled: true });
  setLocalModelApiKey("secret");
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "local-chat" }] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "A local answer." } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await checkCompatibleLocalModel()).toMatchObject({ ok: true, models: ["local-chat"] });
  await expect(completeCompatibleLocalChat({ model: "local-chat", messages: [{ role: "user", content: "Hello" }] })).resolves.toBe("A local answer.");
  expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8080/v1/chat/completions");
  expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Authorization")).toBe("Bearer secret");
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ max_tokens: 1024, stream: false });
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).not.toHaveProperty("reasoning_effort");
});

it("disables reasoning only for a compatible endpoint on Ollama's default port", async () => {
  saveLocalModelSettings({ provider: "custom", baseUrl: "http://127.0.0.1:11434", model: "qwen3.5:9b", enabled: true });
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "READY" } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(completeCompatibleLocalChat({ model: "qwen3.5:9b", messages: [{ role: "user", content: "Reply READY." }] })).resolves.toBe("READY");
  expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:11434/v1/chat/completions");
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ reasoning_effort: "none", max_tokens: 1024 });
});

it("preserves explicit structured output controls through the bounded empty retry", async () => {
  saveLocalModelSettings({ provider: "custom", baseUrl: "http://127.0.0.1:8080", model: "local-chat", enabled: true });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(completeCompatibleLocalChat({ model: "local-chat", messages: [{ role: "user", content: "Return JSON." }], maxOutputTokens: 4096, jsonMode: true })).resolves.toBe("{}");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [, options] of fetchMock.mock.calls) {
    expect(JSON.parse(String(options.body))).toMatchObject({ max_tokens: 4096, response_format: { type: "json_object" } });
  }
});

it("retries one empty completion locally with a concise-answer instruction and a bounded token increase", async () => {
  saveLocalModelSettings({ provider: "custom", baseUrl: "http://127.0.0.1:8080", model: "qwen3.5:9b", enabled: true });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Chapter 3 argues that..." } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(completeCompatibleLocalChat({
    model: "qwen3.5:9b",
    messages: [{ role: "system", content: "Use notebook evidence." }, { role: "user", content: "What does chapter 3 argue?" }],
  })).resolves.toBe("Chapter 3 argues that...");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.every(([url]) => url === "http://127.0.0.1:8080/v1/chat/completions")).toBe(true);
  const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
  const retryBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
  expect(firstBody.max_tokens).toBe(1024);
  expect(retryBody.max_tokens).toBe(4096);
  expect(retryBody.messages[0].content).toContain("Do not output internal reasoning");
  expect(retryBody.messages.some((message: { content: string }) => message.content.includes("What does chapter 3 argue?"))).toBe(true);
  expect(retryBody).not.toHaveProperty("think");
  expect(retryBody).not.toHaveProperty("options");
  expect(retryBody).not.toHaveProperty("reasoning_effort");
});

it("returns a clear error after the bounded empty-completion retry is also empty", async () => {
  saveLocalModelSettings({ provider: "custom", baseUrl: "http://127.0.0.1:8080", model: "local-chat", enabled: true });
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), { status: 200 })));
  await expect(completeCompatibleLocalChat({ model: "local-chat", messages: [{ role: "user", content: "Explain this passage" }] }))
    .rejects.toThrow("Local model returned an empty completion after one bounded retry");
});

it("bounds source-heavy context while preserving message roles and the latest question", () => {
  const bounded = boundCompatibleChatMessages([
    { role: "system", content: `Instructions. Source material: ${"evidence ".repeat(500)}` },
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
    { role: "user", content: "What does chapter 3 conclude?" },
  ], 120);
  expect(bounded.map(({ role }) => role)).toEqual(["system", "user"]);
  expect(bounded.map(({ content }) => content).join("\n\n").length).toBeLessThanOrEqual(120);
  expect(bounded.at(-1)?.content).toBe("What does chapter 3 conclude?");
  expect(bounded[0].content.startsWith("Instructions.")).toBe(true);
});

it("preserves the beginning of notebook evidence and the latest question when one user message exceeds the budget", () => {
  const question = "User question: What does chapter 3 conclude?";
  const userContent = `Notebook evidence:\nCHAPTER 3 opening passage: ${"source passage ".repeat(2_000)}\n\n${question}`;
  const bounded = boundCompatibleChatMessages([{ role: "user", content: userContent }], 400);
  expect(bounded).toHaveLength(1);
  expect(bounded[0].content).toContain("Notebook evidence:\nCHAPTER 3 opening passage:");
  expect(bounded[0].content).toContain(question);
  expect(bounded[0].content).toContain("Earlier context shortened");
  expect(bounded[0].content.length).toBeLessThanOrEqual(400);
});

it("aborts a stalled compatible request at its finite timeout", async () => {
  saveLocalModelSettings({ provider: "custom", baseUrl: "http://127.0.0.1:8080", model: "local-chat", enabled: true });
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
  const pending = expect(completeCompatibleLocalChat({ model: "local-chat", messages: [{ role: "user", content: "Hello" }] }))
    .rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(120_000);
  await pending;
  vi.useRealTimers();
});

it("keeps the deadline active while reading a stalled SSE response body", async () => {
  saveLocalModelSettings({ provider: "custom", baseUrl: "http://127.0.0.1:8080", model: "local-chat", enabled: true });
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } })));
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
  const pending = expect(completeCompatibleLocalChat({
    model: "local-chat",
    messages: [{ role: "user", content: "Hello" }],
    onChunk: vi.fn(),
  })).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(120_000);
  await pending;
  expect(streamController).toBeDefined();
  vi.useRealTimers();
});

it("surfaces endpoint errors instead of disguising them as a cloud response", async () => {
  saveLocalModelSettings({ provider: "lm-studio", enabled: true });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("offline", { status: 503 })));
  await expect(completeCompatibleLocalChat({ model: "local", messages: [{ role: "user", content: "Hello" }] })).rejects.toThrow("Local model generation failed (503)");
});
