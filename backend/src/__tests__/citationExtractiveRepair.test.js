import { describe, expect, it, vi } from "vitest";
import { alignCitationExcerptsWithClaims, chatWithNotebook, expandTerminalCitationSuffix, replaceRetryWithExtractiveSentence, MAX_CITATION_EXCERPT_CHARS, parseCitationExcerpts, selectExtractiveCitationRepair } from "../services/aiChatService.js";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("../services/titanProvider.js", () => ({ dispatchToTitan: dispatch }));

// Earlier cases use reconstructed assertions and verified literal public source.
// The separately labeled persisted-answer regression below is an actual retained turn.
const evidence = "In 1796, Jean Senebier, a Swiss pastor, botanist, and naturalist, demonstrated that green plants consume carbon dioxide and release oxygen under the influence of light.";
const fragment = "will increase, causing an increase of photorespiration by the oxygenase activity of ribulose-1,5-bisphosphate carboxylase/oxygenase (RuBisCO) and decrease in carbon fixation. Some plants have evolved mechanisms to increase the CO2";
const question = "According to this photosynthesis article, which gas do plants take in as a reactant? Name the gas and cite the source.";
const padding = "Background material discusses the history of research without making a claim about reactants. ".repeat(4);
const repair = (content, query, claim) => selectExtractiveCitationRepair(`${padding}${content}`, query, claim);

describe("conservative extractive fragment repair", () => {
  // Proposed extractive response against the retained literal TED sentence.
  // This fixture does not claim that a live provider generated the repair.
  const tedSentence = "So now that the chloroplast has all the building blocks - carbon, hydrogen, oxygen, and electrons - it can use them to go through the rest of the steps of photosynthesis to transform that original carbon dioxide gas into a simple carbohydrate called glucose, C-6-H-12-O-6.";
  const tedQuestion = "According to this photosynthesis video, which simple carbohydrate is produced? Name it and cite the source.";
  const tedSource = { id: "ted-youtube", title: "Photosynthesis", type: "youtube", content: `${padding}\n${tedSentence}` };
  const tedRefs = [{ id: tedSource.id, index: 1, title: tedSource.title, type: tedSource.type }];
  const tedSuffix = tedSentence.slice(tedSentence.indexOf("it can use"));
  const suffixAnswer = `${tedSuffix}[1]\nCITATIONS:\n[1] "${tedSuffix}"`;

  // Body and terminal citation retained from the 2026-10-13T06-32-28-478Z
  // failed Qwen retry; provider calls in this regression are mocked.
  const observedQuestion = "According to this photosynthesis video transcript, which sugar do plants produce? Name the sugar and cite the source.";
  const observedBody = "Plants produce glucose, which is described as a simple carbohydrate with the formula C-6-H-12-O-6 [1].";
  const observedRetry = `${observedBody}\nCITATIONS:\n[1] "${tedSuffix}"`;

  it("discards the retained paraphrase and returns only the unique complete literal sentence", () => {
    expect(expandTerminalCitationSuffix(observedRetry, tedRefs, [tedSource], observedQuestion)).toBe("");
    expect(replaceRetryWithExtractiveSentence(observedRetry, tedRefs, [tedSource], observedQuestion))
      .toBe(`${tedSentence}[1]\nCITATIONS:\n[1] "${tedSentence}"`);
  });

  it("rejects obsolete prose retry: revalidates a source-extractive replacement after the actual retained retry shape fails", async () => {
    dispatch.mockReset();
    dispatch.mockResolvedValueOnce({ answer: "Plants produce glucose.[1]", tokensUsed: 2, modelUsed: "initial-mock" });
    dispatch.mockResolvedValueOnce({ answer: observedRetry, tokensUsed: 3, modelUsed: "repair-mock" });
    await expect(chatWithNotebook({ notebook: { id: "ted-observed-paraphrase-repair", title: "Photosynthesis" }, sources: [tedSource], notes: [], message: observedQuestion, allowWebFallback: false })).rejects.toMatchObject({ code: "GROUNDING_UNAVAILABLE" });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it.each([
    observedRetry.replace("Plants produce", "Factories produce"),
    observedRetry.replace("Plants produce", "Plants do not produce"),
    observedRetry.replace("Plants produce", "Plants might produce"),
    observedRetry.replace("Plants produce", "If plants produce"),
    observedRetry.replace("Plants produce glucose", "Plants produce sucrose"),
    observedRetry.replace(" [1].", ". Plants produce diesel [1]."),
    observedRetry.replace(" [1].", "; factories consume diesel [1]."),
    observedRetry.replace(" [1].", " [1][1]."),
    observedRetry.replace(/CITATIONS:[\s\S]*/, ""),
    `${observedRetry}\nUnsupported metadata.`,
  ])("rejects unsafe paraphrase replacement eligibility %#", (answer) => {
    expect(replaceRetryWithExtractiveSentence(answer, tedRefs, [tedSource], observedQuestion)).toBe("");
  });

  it.each([
    [[{ ...tedRefs[0], id: "foreign" }], [tedSource], observedQuestion],
    [tedRefs, [{ ...tedSource, content: `${tedSentence}\n${tedSentence}` }], observedQuestion],
    [tedRefs, [{ ...tedSource, content: tedSentence.replace("has all", "does not have all") }], observedQuestion],
    [tedRefs, [{ ...tedSource, content: tedSentence.replace("So now", "If") }], observedQuestion],
    [tedRefs, [{ ...tedSource, content: `So now ${"additional building blocks ".repeat(20)}${tedSuffix}` }], observedQuestion],
    [tedRefs, [tedSource], "Which factories consume diesel?"],
  ])("retains source identity, uniqueness, polarity, size and relevance guards %#", (refs, sources, question) => {
    expect(replaceRetryWithExtractiveSentence(observedRetry, refs, sources, question)).toBe("");
  });

  it("expands only the unique literal terminal suffix into its full source sentence", () => {
    expect(tedSuffix).toHaveLength(172);
    expect(expandTerminalCitationSuffix(suffixAnswer, tedRefs, [tedSource], tedQuestion))
      .toBe(`${tedSentence}[1]\nCITATIONS:\n[1] "${tedSentence}"`);
  });

  it("rejects obsolete prose retry: revalidates the complete suffix expansion after both mocked provider attempts fail", async () => {
    dispatch.mockReset();
    dispatch.mockResolvedValueOnce({ answer: "The video produces glucose.[1]", tokensUsed: 2, modelUsed: "initial-mock" });
    dispatch.mockResolvedValueOnce({ answer: suffixAnswer, tokensUsed: 3, modelUsed: "repair-mock" });
    await expect(chatWithNotebook({ notebook: { id: "ted-terminal-suffix-repair", title: "Photosynthesis" }, sources: [tedSource], notes: [], message: tedQuestion, allowWebFallback: false })).rejects.toMatchObject({ code: "GROUNDING_UNAVAILABLE" });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [suffixAnswer, [{ ...tedRefs[0], id: "foreign" }], [tedSource], tedQuestion],
    [suffixAnswer.replace("[1]", "[2]"), tedRefs, [tedSource], tedQuestion],
    [suffixAnswer.replace("[1]", ". Another claim.[1]"), tedRefs, [tedSource], tedQuestion],
    [suffixAnswer.replace(tedSuffix, tedSuffix.replace("glucose", "sucrose")), tedRefs, [tedSource], tedQuestion],
    [suffixAnswer, tedRefs, [{ ...tedSource, content: `${tedSentence}\n${tedSentence}` }], tedQuestion],
    [suffixAnswer, tedRefs, [{ ...tedSource, content: `Another chloroplast has supplies and ${tedSuffix}\n${tedSentence}` }], tedQuestion],
    [suffixAnswer, tedRefs, [{ ...tedSource, content: `${tedSentence.replace("has all", "does not have all")}\n${tedSentence}` }], tedQuestion],
    [suffixAnswer, tedRefs, [{ ...tedSource, content: `So now ${"additional building blocks ".repeat(20)}${tedSuffix}\n${tedSentence}` }], tedQuestion],
    [suffixAnswer, tedRefs, [tedSource], "Which factories consume diesel?"],
    [suffixAnswer, tedRefs, [{ ...tedSource, content: `So now ${"additional building blocks ".repeat(20)}${tedSuffix}` }], tedQuestion],
    [suffixAnswer, tedRefs, [{ ...tedSource, content: tedSentence.replace("So now", "If") }], tedQuestion],
    [suffixAnswer, tedRefs, [{ ...tedSource, content: tedSentence.replace("So now", "Scientists rejected that") }], tedQuestion],
    [suffixAnswer, tedRefs, [{ ...tedSource, content: tedSentence.replace("has all", "may have all") }], tedQuestion],
    [suffixAnswer, tedRefs, [{ ...tedSource, content: tedSentence.replace("has all", "does not have all") }], tedQuestion],
    [suffixAnswer.replace(/CITATIONS:[\s\S]*/, ""), tedRefs, [tedSource], tedQuestion],
    [`${suffixAnswer}\nAdditional unsupported metadata.`, tedRefs, [tedSource], tedQuestion],
  ])("rejects ambiguous, foreign, unsupported or unsafe suffix expansion %#", (answer, refs, sources, query) => {
    expect(expandTerminalCitationSuffix(answer, refs, sources, query)).toBe("");
  });

  it("preserves the full 272-character TED evidence through parsing and alignment", () => {
    expect(tedSentence).toHaveLength(272);
    expect(MAX_CITATION_EXCERPT_CHARS).toBe(384);
    const parsed = parseCitationExcerpts(`${tedSentence}[1]\nCITATIONS:\n[1] "${tedSentence}"`, tedRefs, [tedSource]);
    expect(parsed.citations[0].excerpt).toBe(tedSentence);
    const aligned = alignCitationExcerptsWithClaims(parsed.answer, parsed.citations, [tedSource], tedQuestion);
    expect(aligned[0].excerpt).toBe(tedSentence);
    expect(repair(tedSentence, tedQuestion, tedSentence)).toBe(tedSentence);
  });

  it("makes the proposed full-sentence TED repair with mocked provider responses", async () => {
    dispatch.mockReset();
    dispatch.mockResolvedValueOnce({ answer: "The video produces glucose.[1]", tokensUsed: 2, modelUsed: "initial-mock" });
    dispatch.mockResolvedValueOnce({ answer: JSON.stringify({ status: "supported", sentences: [{ sourceIndex: 1, text: tedSentence }] }), tokensUsed: 3, modelUsed: "repair-mock" });
    const result = await chatWithNotebook({ notebook: { id: "ted-whole-sentence-repair", title: "Photosynthesis" }, sources: [tedSource], notes: [], message: tedQuestion, allowWebFallback: false });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[1][0].messages.at(-1).content).toContain("fit 384 characters");
    expect(result.citations[0].excerpt).toBe(tedSentence);
    expect(result.groundedSources).toEqual([tedSource.id]);
    expect(result.tokensUsed).toBe(5);
  });

  it("rejects over-budget evidence rather than truncating it into a citation", () => {
    const long = `Photosynthesis ${"requires additional building blocks ".repeat(12)}produces glucose.`;
    expect(long.length).toBeGreaterThan(384);
    const source = { ...tedSource, content: long };
    expect(parseCitationExcerpts(`${long}[1]\nCITATIONS:\n[1] "${long}"`, tedRefs, [source]).citations).toEqual([]);
    expect(repair(long, tedQuestion, long)).toBe("");
    expect(selectExtractiveCitationRepair(long, tedQuestion, long, 1000)).toBe("");
    expect(alignCitationExcerptsWithClaims(`${long}[1]`, [{ citation_id: 1, source_id: source.id, excerpt: long }], [source], tedQuestion)).toEqual([]);
  });

  it.each([
    [tedSentence.slice(0, 240), tedQuestion],
    ["So now the factories consume diesel fuel during operation.", tedQuestion],
    ["So now photosynthesis does not produce glucose.", tedQuestion],
    ["So now photosynthesis might produce glucose.", tedQuestion],
    ["If photosynthesis produces glucose, the fictional result follows.", tedQuestion],
  ])("rejects truncated, unrelated, negative, modal or conditional whole copies: %s", (sentence, query) => {
    expect(repair(sentence, query, sentence)).toBe("");
  });

  it("does not retain literal TED evidence under a foreign source identity", () => {
    expect(alignCitationExcerptsWithClaims(`${tedSentence}[1]`, [{ citation_id: 1, source_id: "foreign-source", excerpt: tedSentence }], [tedSource], tedQuestion)).toEqual([]);
    expect(parseCitationExcerpts(`${tedSentence}[1]\nCITATIONS:\n[1] "${tedSentence}"`, [{ ...tedRefs[0], id: "foreign-source" }], [tedSource]).citations).toEqual([]);
  });

  it("repairs the recorded fragment using retained literal evidence and a reconstructed answer", () => {
    const source = { id: "public-source", content: `${padding}${fragment}. ${evidence}` };
    const citation = { citation_id: 1, source_id: source.id, excerpt: fragment };
    const [result] = alignCitationExcerptsWithClaims("Green plants consume carbon dioxide and release oxygen under the influence of light.[1]", [citation], [source], question);
    expect(result.excerpt).toBe(evidence);
    expect(source.content.includes(result.excerpt)).toBe(true);
  });

  it.each([
    ["A truck consumes diesel fuel.", "What fuel does the generator consume?", "The generator consumes diesel fuel."],
    ["Scrubbers capture CO2 during operation.", "What gas do plants capture?", "Plants capture CO2 during photosynthesis."],
    ["Plants release CO2 during respiration.", "What gas do plants capture?", "Plants capture CO2 during photosynthesis."],
    ["It consumes diesel fuel.", "What fuel does the generator consume?", "It consumes diesel fuel."],
    ["Factories consume diesel fuel.", "What gas do plants capture?", "Plants capture CO2 during photosynthesis. Factories consume diesel fuel."],
    ["Plants use mechanisms to increase the CO2 concentration.", "What gas do plants capture?", "Plants capture CO2 during photosynthesis."],
  ])("rejects unrelated subjects, reversed roles and ambiguous context: %s", (content, query, claim) => {
    expect(repair(content, query, claim)).toBe("");
  });

  it("preserves literal CO2 without inventing alias equivalence", () => {
    const sentence = "Plants capture CO2 during photosynthesis.";
    expect(repair(sentence, "What gas do plants capture?", sentence)).toBe(sentence);
    expect(repair(sentence, "What gas do plants capture?", "Plants capture carbon dioxide during photosynthesis.")).toBe("");
  });

  it.each([
    "Plants do not capture CO2 during photosynthesis.",
    "It is incorrect that plants capture CO2 during photosynthesis.",
    "Scientists rejected the claim that plants capture CO2 during photosynthesis.",
    "If plants capture CO2 during photosynthesis, this result would follow.",
    "Scientists wrongly demonstrated that plants capture CO2 during photosynthesis.",
    "Plants capture CO2 during photosynthesis only in the fictional example.",
  ])("rejects negation and nonassertive contexts: %s", (sentence) => {
    expect(repair(sentence, "What gas do plants capture?", "Plants capture CO2 during photosynthesis.")).toBe("");
  });

  it("drops the fragment when a reconstructed paraphrase has no extractive support", () => {
    const source = { id: "public-source", content: `${padding}${evidence}` };
    const citation = { citation_id: 1, source_id: source.id, excerpt: fragment };
    const result = alignCitationExcerptsWithClaims("Plants take in carbon dioxide as a reactant.[1]", [citation], [source], question);
    expect(result).toEqual([]);
  });

  // Persisted answer/excerpt from 2026-10-13T00-40-59-714Z. The raw provider
  // response and original CITATIONS block were not retained. This is not a
  // replay of provider generation or the full 74,999-character source.
  const retainedAnswer = "According to the provided text, plants take in **carbon dioxide** (CO₂) as a reactant for photosynthesis [1]. The source describes the fixation of carbon dioxide where it combines with ribulose 1,5-bisphosphate to initiate the process [1]. In C4 plants specifically, carbon dioxide is added to phosphoenolpyruvate to form organic acids before being fixed again by RuBisCO [1].\n\nExplore next: What specific conditions cause plants to close their stomata and how does that affect the balance of CO₂ and oxygen in the leaf?";
  const retainedExcerpt = "ced by the light reactions of photosynthesis, will increase, causing an increase of photorespiration by the oxygenase activity of ribulose-1,5-bisphosphate carboxylase/oxygenase (RuBisCO) and decrease in carbon fixation. Some plants have ev";

  it("rejects the actual persisted website fragment rather than claiming a paraphrase is extractively proven", () => {
    const source = { id: "website", content: `${retainedExcerpt}\n${evidence}` };
    expect(alignCitationExcerptsWithClaims(retainedAnswer, [{ citation_id: 1, source_id: source.id, excerpt: retainedExcerpt }], [source], question)).toEqual([]);
  });

  it("fails before returning or caching a provider answer with unrepairable evidence", async () => {
    dispatch.mockResolvedValue({ answer: `${retainedAnswer}\n\nCITATIONS:\n[1] "${retainedExcerpt}"`, tokensUsed: 4, modelUsed: "mock-provider" });
    const args = {
      notebook: { id: "fragment-rejection-regression", title: "Photosynthesis" },
      sources: [{ id: "website", title: "Photosynthesis", type: "website", content: `${retainedExcerpt}\n${evidence}` }],
      notes: [], message: question, allowWebFallback: false,
    };
    dispatch.mockClear();
    await expect(chatWithNotebook(args)).rejects.toMatchObject({ code: "GROUNDING_UNAVAILABLE" });
    await expect(chatWithNotebook(args)).rejects.toMatchObject({ code: "GROUNDING_UNAVAILABLE" });
    expect(dispatch).toHaveBeenCalledTimes(4);
    expect(dispatch.mock.calls[1][0].messages.at(-1).content).toContain("previous answer failed evidence validation");
    expect(dispatch.mock.calls[3][0].temperature).toBe(0);
  });

  it("accepts a complete historical sentence after an incomplete source line and JSON decoding", async () => {
    // Both provider responses are mocked. This is not a replay of Qwen output.
    dispatch.mockReset();
    dispatch.mockResolvedValueOnce({ answer: `${retainedAnswer}\n\nCITATIONS:\n[1] "${retainedExcerpt}"`, tokensUsed: 4, modelUsed: "first-model" });
    dispatch.mockResolvedValueOnce({ answer: JSON.stringify({ status: "supported", sentences: [{ sourceIndex: 1, text: evidence }] }), tokensUsed: 7, modelUsed: "repair-model" });
    const args = {
      notebook: { id: "one-repair-regression", title: "Photosynthesis" },
      sources: [{ id: "authorized-website", title: "Photosynthesis", type: "website", content: `${retainedExcerpt}\n${evidence}` }],
      notes: [], message: question, allowWebFallback: false,
    };
    const result = await chatWithNotebook(args);
    expect(result.citations[0].excerpt).toBe(evidence);
    expect(result.answer.replace(/\[1\]/g, "")).toBe(evidence);
    expect(result.tokensUsed).toBe(11);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("returns a literal repaired citation when the extractive assertion is validated", async () => {
    dispatch.mockResolvedValue({ answer: `Green plants consume carbon dioxide and release oxygen under the influence of light.[1]\n\nCITATIONS:\n[1] "${retainedExcerpt}"`, tokensUsed: 4, modelUsed: "mock-provider" });
    const result = await chatWithNotebook({
      notebook: { id: "validated-extractive-regression", title: "Photosynthesis" },
      sources: [{ id: "website", title: "Photosynthesis", type: "website", content: `${retainedExcerpt}\n${evidence}` }],
      notes: [], message: question, allowWebFallback: false,
    });
    expect(result.citations[0].excerpt).toBe(evidence);
    expect(result.groundedSources).toEqual(["website"]);
  });

  it.each([
    "Plants do not capture CO2 during photosynthesis.",
    "Plants might capture CO2 during photosynthesis.",
    "Scrubbers capture CO2 during operation.",
  ])("rejects an unsupported second attempt without a third dispatch: %s", async (claim) => {
    dispatch.mockReset();
    const sourceContent = `${retainedExcerpt}\nPlants capture CO2 during photosynthesis.`;
    const response = (answer) => ({ answer: `${answer}[1]\n\nCITATIONS:\n[1] "${retainedExcerpt}"`, tokensUsed: 4, modelUsed: "mock-provider" });
    dispatch.mockResolvedValueOnce(response(retainedAnswer));
    dispatch.mockResolvedValueOnce(response(claim));
    await expect(chatWithNotebook({
      notebook: { id: `strict-retry-${claim}`, title: "Photosynthesis" },
      sources: [{ id: "website", title: "Photosynthesis", type: "website", content: sourceContent }],
      notes: [], message: "What gas do plants capture?", allowWebFallback: false,
    })).rejects.toMatchObject({ code: "GROUNDING_UNAVAILABLE" });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
