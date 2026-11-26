// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { recoverStandalonePassage } from "../services/standaloneChatPassage.js";

const error = Object.assign(new Error("Unavailable"), { code: "PROVIDER_UNAVAILABLE" });
const question = "Where is the spare spectrometer stored?";
const quote = "The spare spectrometer is stored in the amber cabinet.";
const source = { id: "inventory", title: "Inventory", type: "text", content: ["Inventory", "", "Bench supplies are stored in the blue cupboard.", quote].join("\r\n") };

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  db: {
    isNotebookExplicitlyDeleted: vi.fn().mockResolvedValue(false),
    getNotebookById: vi.fn().mockResolvedValue({ id: "book" }),
    getSourcesByNotebookId: vi.fn(),
    getNotesByNotebookId: vi.fn().mockResolvedValue([]),
    getChatMessagesByNotebookId: vi.fn().mockResolvedValue([]),
    createChatMessage: vi.fn(),
  },
}));
vi.mock("../db/database.js", () => ({ dbHelpers: mocks.db }));
vi.mock("../services/aiChatService.js", async (load) => ({
  ...await load(), chatWithNotebook: mocks.chat,
}));
vi.mock("../services/webhookDispatcher.js", () => ({ WebhookDispatcher: { recordActivityAndNotify: vi.fn() } }));

describe("standalone chat during a provider outage", () => {
  it("uses the selected source and saves its line coordinates through the standalone route", async () => {
    mocks.chat.mockRejectedValueOnce(error);
    mocks.db.getSourcesByNotebookId.mockResolvedValueOnce([source, { ...source, id: "unselected" }]);
    const { default: router } = await import("../routes/notebooks.js");
    const layer = router.stack.find(layer => layer.route?.path === "/:id/chat" && layer.route.methods.post);
    const req = { params: { id: "book" }, user: { userId: "owner" }, body: { message: question, sourceIds: ["inventory"] } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await layer.route.stack.at(-1).handle(req, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(mocks.db.getSourcesByNotebookId).toHaveBeenCalledWith("book", "owner");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ groundedSources: ["inventory"], sourceScope: ["inventory"] }));
    const citation = res.json.mock.calls[0][0].citations[0];
    expect(citation).toMatchObject({ source_id: "inventory", excerpt: quote, chunk_lines_from: 4, chunk_lines_to: 4 });
    expect(mocks.db.createChatMessage).toHaveBeenCalledTimes(2);
    expect(mocks.db.createChatMessage.mock.calls[1][5]).toEqual({ version: 1, sourceIds: ["inventory"], citations: [citation] });
  });
  it("discloses the outage and returns one exact source line with persisted citation fields", () => {
    const result = recoverStandalonePassage(error, question, [source]);
    expect(result.answer).toContain("AI is temporarily unavailable");
    expect(result.answer).toContain(quote + "” [1]");
    expect(result.groundedSources).toEqual(["inventory"]);
    expect(result.citations).toEqual([{ citation_id: 1, source_id: "inventory", source_type: "text",
      source_title: "Inventory", excerpt: quote, chunk_lines_from: 4, chunk_lines_to: 4 }]);
  });
  it.each([
    [question, [source, { ...source, id: "other" }]],
    [question, [{ ...source, content: quote + "\n" + quote }]],
    [question, [{ ...source, processingStatus: "failed" }]],
    [question, [{ ...source, content: "The spectrometer is stored somewhere." }]],
    ["Where is it stored?", [source]],
    ["Which cabinet is not used?", [source]],
    ["Explain the inventory.", [source]],
    [question, [{ ...source, content: "z".repeat(250_001) + "\n" + quote }]],
  ])("keeps the retry error when no single reliable match is available", (message, sources) => {
    expect(() => recoverStandalonePassage(error, message, sources)).toThrow(error);
  });
  it.each(["PERSONAL_PROVIDER_UNAVAILABLE", "DATABASE_TEMPORARILY_UNAVAILABLE", "GROUNDING_UNAVAILABLE", "CHAT_TIMEOUT"])(
    "preserves %s", code => {
      const original = Object.assign(new Error(code), { code });
      expect(() => recoverStandalonePassage(original, question, [source])).toThrow(original);
    });
});
