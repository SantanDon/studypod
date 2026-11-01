import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  listModels: vi.fn(),
  cloud: vi.fn(),
}));

vi.mock("@/lib/ai/ollamaClient", () => ({
  generateTextToString: mocks.generate,
  listModels: mocks.listModels,
}));
vi.mock("@/lib/ai/serverAiClient", () => ({ generateServerAiResponse: mocks.cloud }));

describe("Ollama chat prompt budgeting", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_ENABLE_OLLAMA", "true");
    vi.stubEnv("VITE_OLLAMA_MODEL", "qwen2.5:7b");
    window.localStorage.clear();
    mocks.generate.mockReset().mockResolvedValue("ok");
    mocks.listModels.mockReset().mockResolvedValue(["qwen2.5:7b"]);
    mocks.cloud.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    window.localStorage.clear();
    vi.resetModules();
  });

  it("keeps directions and the latest practice request when source text exceeds the limit", async () => {
    const { buildOllamaChatPrompt } = await import("@/lib/ai/ollamaService");
    const prompt = buildOllamaChatPrompt([
      { role: "system", content: "Tutor naturally. Ask one question and wait for an attempt.\nNotebook source material:\n" + "source evidence ".repeat(1800) },
      { role: "user", content: "Earlier request" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Help me practise the main idea. Ask one question at a time and wait before revealing the answer." },
    ]);

    expect(prompt.length).toBeLessThanOrEqual(20_000);
    expect(prompt).toContain("Tutor naturally. Ask one question and wait for an attempt.");
    expect(prompt).toContain("User: Help me practise the main idea.");
    expect(prompt).toContain("Source excerpt shortened to fit the prompt.");
    expect(prompt.endsWith("before revealing the answer.")).toBe(true);
    expect(prompt).not.toContain("source evidence ".repeat(1800));
  });

  it("shares a small source budget across every selected source while retaining citation labels", async () => {
    const { buildOllamaChatPrompt } = await import("@/lib/ai/ollamaService");
    const maxChars = 900;
    const prompt = buildOllamaChatPrompt([
      {
        role: "system",
        content: "Follow the tutoring directions and answer the latest question.\nNotebook source material:\n"
          + "[1] First reading (PDF)\n" + "Alpha evidence ".repeat(30)
          + "\n[2] Second reading (PDF)\n" + "Beta evidence ".repeat(30)
          + "\n[3] Third reading (PDF)\n" + "Gamma evidence ".repeat(30),
      },
      { role: "user", content: "Compare the three readings and ask me one question." },
    ], maxChars);

    expect(prompt.length).toBeLessThanOrEqual(maxChars);
    expect(prompt).toContain("User: Compare the three readings and ask me one question.");
    for (const label of ["[1] First reading (PDF)", "[2] Second reading (PDF)", "[3] Third reading (PDF)"]) {
      expect(prompt).toContain(label);
    }
    for (const evidence of ["Alpha evidence", "Beta evidence", "Gamma evidence"]) {
      expect(prompt).toContain(evidence);
    }
  });

  it("preserves paragraph breaks and sends generation options in Ollama's options object", async () => {
    const { chatCompletion } = await import("@/lib/ai/ollamaService");
    await chatCompletion({ messages: [
      { role: "system", content: "Give grounded feedback.\n\nKeep it readable." },
      { role: "user", content: "Explain this." },
    ] });

    const request = mocks.generate.mock.calls[0][0];
    expect(request.prompt).toContain("Give grounded feedback.\n\nKeep it readable.");
    expect(request.params).toEqual({
      think: false,
      options: { temperature: 0.7, num_predict: 512, top_k: 40, top_p: 0.9, num_ctx: 2048 },
    });
    expect(request.params.temperature).toBeUndefined();
    expect(mocks.cloud).not.toHaveBeenCalled();
  });

  it("budgets long grounded replies for source context and bounded output", async () => {
    const { chatCompletion } = await import("@/lib/ai/ollamaService");
    await chatCompletion({ messages: [
      { role: "system", content: "Use the supplied reading and cite it.\nNotebook source material:\n[1] Reading\nJustice is examined through the opening discussion. ".repeat(30) },
      { role: "user", content: "Explain the opening argument, cite a relevant passage, and end with one question." },
    ] });

    const request = mocks.generate.mock.calls[0][0];
    expect(request.params).toEqual({
      think: false,
      options: { temperature: 0.7, num_predict: 1024, top_k: 40, top_p: 0.9, num_ctx: 8192 },
    });
    expect(request.prompt).toContain("[1] Reading");
    expect(request.prompt).toContain("end with one question");
  });

  it("honors structured output budgets and bypasses ordinary cached completions", async () => {
    const { chatCompletion } = await import("@/lib/ai/ollamaService");
    const messages = [{ role: "user" as const, content: "Return a JSON discussion." }];
    await chatCompletion({ messages });
    await chatCompletion({ messages, maxOutputTokens: 4096, jsonMode: true });
    await chatCompletion({ messages, maxOutputTokens: 4096, jsonMode: true });
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(mocks.generate.mock.calls[1][0].params).toMatchObject({
      format: "json", options: { num_predict: 4096, num_ctx: 16384 },
    });
    expect(mocks.generate.mock.calls[0][0].params).not.toHaveProperty("format");
  });

  it("rejects invalid output budgets before contacting a provider", async () => {
    const { chatCompletion } = await import("@/lib/ai/ollamaService");
    await expect(chatCompletion({ messages: [], maxOutputTokens: 8193 })).rejects.toThrow();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
