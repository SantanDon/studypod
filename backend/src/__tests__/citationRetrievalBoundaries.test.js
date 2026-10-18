import { describe, expect, it } from "vitest";
import { buildNotebookContext, ensurePrimaryGrounding, inferCitationsFromMarkers, selectRelevantContent } from "../services/aiChatService.js";

const separator = "\n\n[... relevant excerpt continues ...]\n\n";
const question = "Which gas do plants take in as a reactant?";
const support = "Green plants consume carbon dioxide and release oxygen under the influence of light.";

describe("bounded complete citation retrieval", () => {
  it("preserves literal sentence boundaries without overlap or budget slicing", () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `Plants take in gas in experiment ${i} while researchers record the observations.`);
    const source = sentences.join(" ");
    const result = selectRelevantContent(source, question, 700);
    const excerpts = result.split(separator);
    expect(result.length).toBeLessThanOrEqual(700);
    expect(excerpts.length).toBeGreaterThan(1);
    expect(new Set(excerpts).size).toBe(excerpts.length);
    for (const excerpt of excerpts) expect(sentences).toContain(excerpt);
  });

  it("abstains rather than slicing an oversized evidence unit", () => {
    expect(selectRelevantContent("Plants " + "unbroken ".repeat(100) + "consume gas.", question, 240)).toBe("");
  });

  it("adds complete introductory evidence in a bounded alternate view from identical authorized sources", () => {
    // Synthetic long-article regression; no provider output is reconstructed.
    const lead = Array.from({ length: 32 }, (_, i) => `Background observation ${i} describes the historical research setting and its scientific context.`).join(" ");
    const buffer = Array.from({ length: 4 }, (_, i) => `Historical observation ${i} describes researchers documenting their methods and publishing their findings.`).join(" ");
    const distractors = Array.from({ length: 100 }, (_, i) => `Plants gas reactant take in experiments ${i} discuss oxygenase activity and photorespiration.`).join(" ");
    const source = { id: "authorized", title: "Plant research", type: "website", content: `${lead} ${support} ${buffer} ${distractors}` };
    const args = [{ title: "Notebook" }, [source], [], question];
    const initial = buildNotebookContext(...args);
    const alternate = buildNotebookContext(...args, { repair: true });
    expect(initial.context).not.toContain(support);
    expect(alternate.context).toContain(support);
    expect(alternate.context.length).toBeLessThanOrEqual(12000);
    expect(alternate.sourceRefs).toEqual(initial.sourceRefs);
    expect(alternate.sourceRefs.map((ref) => ref.id)).toEqual(["authorized"]);
  });

  it.each([
    "Plants consume carbon dioxide as a reactant.[1]",
    "I cannot find a complete sentence about plants consuming carbon dioxide.[1]",
    "Green plants do not consume carbon dioxide and release oxygen under the influence of light.[1]",
    "Green plants might consume carbon dioxide and release oxygen under the influence of light.[1]",
    "Trucks consume carbon dioxide and release oxygen under the influence of light.[1]",
  ])("does not invent implicit evidence for unsupported or abstaining output: %s", (answer) => {
    const refs = [{ index: 1, id: "authorized", title: "Plant research", type: "website" }];
    const sources = [{ id: "authorized", content: support }];
    expect(inferCitationsFromMarkers(answer, refs, sources, question)).toEqual([]);
    expect(ensurePrimaryGrounding(answer, [], refs, sources, question).citations).toEqual([]);
  });

  it("infers only a complete literal assertion with matching question subject", () => {
    const refs = [{ index: 1, id: "authorized", title: "Plant research", type: "website" }];
    const sources = [{ id: "authorized", content: support }];
    expect(inferCitationsFromMarkers(`${support}[1]`, refs, sources, question)[0]).toMatchObject({ source_id: "authorized", excerpt: support });
  });

  it("retains the complete historical evidence sentence from the saved public article", () => {
    // Retained public source text, with a synthetic extractive answer; not a replay of Qwen output.
    const evidence = "In 1796, Jean Senebier, a Swiss pastor, botanist, and naturalist, demonstrated that green plants consume carbon dioxide and release oxygen under the influence of light.";
    const refs = [{ index: 1, id: "authorized", title: "Photosynthesis", type: "website" }];
    const sources = [{ id: "authorized", content: evidence }];
    expect(inferCitationsFromMarkers(`${support}[1]`, refs, sources, question)[0]).toMatchObject({ source_id: "authorized", excerpt: evidence });
  });
});
