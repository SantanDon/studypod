// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { chatWithNotebook } from "../services/aiChatService.js";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("../services/titanProvider.js", () => ({ dispatchToTitan: dispatch }));

const quote = "The equipment register does not record personal addresses.";
const source = { id: "register", type: "text", title: "Equipment register", content: quote };
const ask = async (question, answer) => {
  dispatch.mockResolvedValue({ answer, tokensUsed: 1, modelUsed: "offline-mock" });
  return chatWithNotebook({ notebook: { id: "register-abstention", title: "Register" },
    sources: [source], notes: [], message: question, allowWebFallback: false });
};

describe("citations for unanswered notebook questions", () => {
  it("discards unrelated context and its source cards on an explicit non-answer", async () => {
    const result = await ask("Which county issued the register?",
      "The notebook does not establish which county issued the register. The sources describe addresses.\nCITATIONS:\n[1] \"" + quote + "\"");
    expect(result.answer).toContain("couldn't find an answer");
    expect(result.groundedSources).toEqual([]);
    expect(result.citations).toEqual([]);
  });
  it("retains evidence when the source explicitly supports a negative fact", async () => {
    const result = await ask("Does the equipment register record personal addresses?",
      quote + "[1]\nCITATIONS:\n[1] \"" + quote + "\"");
    expect(result.answer).toContain(quote);
    expect(result.citations).toEqual([expect.objectContaining({ source_id: "register", excerpt: quote })]);
  });
});
