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
    createChatTurn: vi.fn(),
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
    expect(mocks.db.createChatTurn).toHaveBeenCalledTimes(1);
    expect(mocks.db.createChatTurn).toHaveBeenCalledWith("book", "owner", expect.objectContaining({
      role: "user", question, answer: res.json.mock.calls[0][0].answer,
      groundedSources: { version: 1, sourceIds: ["inventory"], citations: [citation] },
    }));
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
  it.each([
    ["Where are the field journals kept?", "The field journals are stored beside the entrance."],
    ["When does chamber inspection begin?", "Chamber inspections start at dawn."],
    ["How many spare batteries are required?", "The workshop needs six spare batteries."],
    ["How many sample boxes are there in the archive?", "The archive contains 13 sample boxes."],
  ])("finds a uniquely supported paraphrase: %s", (prompt, line) => {
    const result = recoverStandalonePassage(error, prompt, [{ ...source, content: "Overview\n" + line }]);
    expect(result.citations[0]).toMatchObject({ excerpt: line, chunk_lines_from: 2, chunk_lines_to: 2 });
  });
  it.each([
    ["How many spare batteries are required?", "The workshop needs six chargers for spare batteries."],
    ["How many crates are in the east shed?", "The east shed contains two crates and the west shed contains six crates."],
    ["Where are the field journals kept?", "Field journals are never stored by the entrance."],
    ["Where are the field journals kept?", "Field journals are stored upstairs.\nField journals are kept in the basement."],
    ["How many sample boxes are in the archive?", "The archive contains 2-6 sample boxes."],
    ["Where are the field journals kept?", "The field journalist is kept busy every day."],
    ["When did its inspection begin?", "Its inspection started Tuesday."],
  ])("declines an ambiguous or unsupported paraphrase: %s", (prompt, line) => {
    expect(() => recoverStandalonePassage(error, prompt, [{ ...source, content: line }])).toThrow(error);
  });
  it.each([
    ["Who approves the annual budget?", "The annual budget is approved by Morgan."],
    ["Who tallies the visitor slips?", "Visitor slips are tallied by Gabriela."],
    ["What shade is the fabric swatch?", "The fabric swatch is navy."],
    ["What temperature is the drying oven?", "The drying oven is maintained at 80 degrees Celsius."],
    ["What material is the exhibit plaque made from?", "The exhibit plaque is brass."],
    ["How long does the training session last?", "The training session lasts five hours."],
    ["How does the curator transport the artworks?", "The curator transports the artworks by courier."],
    ["How many filters does the kit contain?", "The kit contains eight sealed filters."],
  ])("opens the exact passage for a supported property or inflection: %s", (message, excerpt) => {
    const result = recoverStandalonePassage(error, message, [{ ...source, content: "Overview\n" + excerpt }]);
    expect(result.citations[0]).toMatchObject({ excerpt, chunk_lines_from: 2 });
  });
  it.each([
    ["What shade is the fabric swatch?", "The fabric swatch is on display."],
    ["What shade is the fabric swatch?", "The fabric swatch is on display. The floor is navy."],
    ["What material is the exhibit plaque made from?", "The exhibit plaque is missing."],
    ["How long does the training session last?", "The training session lasts until the vote."],
    ["How many filters does the kit contain?", "The kit contains eight packets of filters."],
    ["Who approves the annual budget?", "Morgan approved the operating budget."],
  ])("preserves the retry when attributes or required terms lack evidence: %s", (message, content) => {
    expect(() => recoverStandalonePassage(error, message, [{ ...source, content }])).toThrow(error);
  });
  it.each(["PERSONAL_PROVIDER_UNAVAILABLE", "DATABASE_TEMPORARILY_UNAVAILABLE", "GROUNDING_UNAVAILABLE", "CHAT_TIMEOUT"])(
    "preserves %s", code => {
      const original = Object.assign(new Error(code), { code });
      expect(() => recoverStandalonePassage(original, question, [source])).toThrow(original);
    });
});
