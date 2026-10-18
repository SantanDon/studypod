import { describe, expect, it, vi } from "vitest";
import { renderLiteralJsonRetry, chatWithNotebook } from "../services/aiChatService.js";
const dispatch = vi.hoisted(() => vi.fn());
vi.mock("../services/titanProvider.js", () => ({ dispatchToTitan: dispatch }));
const literal = "In this process, atmospheric carbon dioxide is incorporated into already existing organic compounds, such as ribulose bisphosphate (RuBP).";
const next = "Using the ATP and NADPH produced by the light-dependent reactions, the resulting compounds are then reduced.";
const question = "According to this photosynthesis article, which gas do plants take in as a reactant? Name the gas and cite the source.";
const source = { id: "website-photosynthesis", title: "Photosynthesis", type: "website", content: `In plants, algae, and cyanobacteria, sugars are synthesized by a subsequent sequence of light-independent reactions called the Calvin cycle.\n\n${literal}[6] ${next}` };
const refs = [{ id: source.id, title: source.title, type: source.type, index: 1 }];
const json = text => JSON.stringify({ status: "supported", sentences: [{ sourceIndex: 1, text }] });
describe("source footnote terminal boundary regression", () => {
 it("recognizes the retained complete sentence without a Wikipedia footnote", () => {
   expect(renderLiteralJsonRetry(json(literal), refs, [source])).toContain(`CITATIONS:\n[1] "${literal}"`);
 });
 it("recognizes the next original sentence after a terminal source footnote", () => {
   expect(renderLiteralJsonRetry(json(next), refs, [source])).toContain(`[1] "${next}"`);
 });
 it("revalidates the observed retained retry through the complete production chat chain", async () => {
   dispatch.mockReset();
   dispatch.mockResolvedValueOnce({ answer: "Plants consume gas.[1]", tokensUsed: 2, modelUsed: "mock-initial" });
   dispatch.mockResolvedValueOnce({ answer: json(literal), tokensUsed: 3, modelUsed: "mock-retry" });
   const result = await chatWithNotebook({ notebook: { id: "footnote-retained", title: "Photosynthesis" }, sources: [source], notes: [], message: question, allowWebFallback: false });
   expect(result.answer).toContain(literal.slice(0,-1));
   expect(result.tokensUsed).toBe(5);
   expect(dispatch).toHaveBeenCalledTimes(2);
 });
 it.each([
  literal.replace("carbon dioxide", "oxygen"),
  literal.replace("is incorporated", "is not incorporated"),
  `${literal} Plants produce diesel.`,
  literal.slice(literal.indexOf("atmospheric")),
  literal.slice(0,-1),
  `${literal}[6]`,
 ])("rejects mutated, unsupported, fragmentary or citation-bearing selections %#", text => {
   expect(() => renderLiteralJsonRetry(json(text), refs, [source])).toThrow();
 });
 it("retains unique source sentence and source identity requirements", () => {
   expect(() => renderLiteralJsonRetry(json(literal), refs, [{...source,content:`${literal}[6] ${literal}[7] ${next}`}])).toThrow();
   expect(() => renderLiteralJsonRetry(json(literal), [{...refs[0],id:"foreign"}], [source])).toThrow();
 });
 it("does not treat an interior numeric footnote as a sentence boundary", () => {
   expect(() => renderLiteralJsonRetry(json("carbon dioxide."),refs,[{...source,content:"Plants take[6] carbon dioxide."}])).toThrow();
 });
});
