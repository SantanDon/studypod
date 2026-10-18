// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createGroundingAcceptanceRecorder } from "../services/groundingAcceptanceEvidence.js";
import { chatWithNotebook } from "../services/aiChatService.js";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("../services/titanProvider.js", () => ({ dispatchToTitan: dispatch }));
let directory;
let env;
const candidate = {
  attempt: "initial", rawAnswer: "Rejected exact answer\nCITATIONS:\n[1] bad", question: "Synthetic question",
  notebookContext: "Synthetic source context", model: "mock-qwen", tokensUsed: 4,
  sourceRefs: [{ index: 1, id: "private-source-id", title: "private title" }],
  contextSources: [{ id: "private-source-id", content: "Synthetic content" }],
  trace: { expectedCitations: [{ citation_id: 1, source_id: "private-source-id", excerpt: "bad" }] },
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "studypod-grounding-"));
  await writeFile(join(directory, "acceptance.db"), "synthetic fixture");
  env = { STUDYPOD_GROUNDING_CAPTURE: "1", STUDYPOD_ACCEPTANCE_SYNTHETIC: "1", STUDYPOD_FULL_ISOLATED: "1",
    STUDYPOD_GROUNDING_RUN_DIR: directory, NODE_ENV: "test", VERCEL: "", TURSO_AUTH_TOKEN: "",
    TURSO_DATABASE_URL: pathToFileURL(join(directory, "acceptance.db")).href };
  dispatch.mockReset();
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
const files = () => readdir(join(directory, "grounding-candidates.private"));

describe("private failed grounding acceptance evidence", () => {
  it.each([
    { STUDYPOD_GROUNDING_CAPTURE: "" }, { STUDYPOD_ACCEPTANCE_SYNTHETIC: "" }, { STUDYPOD_FULL_ISOLATED: "" },
    { NODE_ENV: "production" }, { VERCEL: "1" }, { TURSO_AUTH_TOKEN: "secret" },
    { TURSO_DATABASE_URL: "libsql://remote.invalid" }, { STUDYPOD_GROUNDING_RUN_DIR: "relative" },
    { STUDYPOD_GROUNDING_RUN_DIR: tmpdir() },
  ])("does not write when a guard fails: %j", async (override) => {
    expect(await createGroundingAcceptanceRecorder({ ...env, ...override })(candidate)).toBe(false);
    await expect(files()).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("retains exact bounded fields for at most two attempts and omits identity/history", async () => {
    const record = createGroundingAcceptanceRecorder(env);
    expect(await record({ ...candidate, rawAnswer: "x".repeat(20000), history: "private history", ownerId: "private owner" })).toBe(true);
    expect(await record({ ...candidate, attempt: "repair" })).toBe(true);
    expect(await record(candidate)).toBe(false);
    const names = (await files()).sort();
    const first = JSON.parse(await readFile(join(directory, "grounding-candidates.private", names[0]), "utf8"));
    const secondText = await readFile(join(directory, "grounding-candidates.private", names[1]), "utf8");
    expect(first.rawAnswer).toMatchObject({ text: "x".repeat(16000), length: 20000, truncated: true });
    expect(first.rawAnswer.sha256).toMatch(/^[a-f0-9]{64}$/);
    const second = JSON.parse(secondText);
    expect(second.rawAnswer.text).toBe(candidate.rawAnswer);
    expect(second.notebookContext.text).toBe(candidate.notebookContext);
    expect(second.attempt).toBe("repair");
    expect(secondText).not.toMatch(/private-source-id|private title|private history|private owner/);
  });
  it("returns false for an unwritable output without throwing", async () => {
    await writeFile(join(directory, "grounding-candidates.private"), "occupied");
    expect(await createGroundingAcceptanceRecorder(env)(candidate)).toBe(false);
  });
  it("captures both rejected mock attempts, preserves error/no-cache and identical authorized context", async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const fragment = "ced by the light reactions of photosynthesis, will increase, causing an increase of photorespiration by the oxygenase activity of RuBisCO and decrease in carbon fixation. Some plants have ev";
    const rawAnswer = `Plants take in carbon dioxide as a reactant for photosynthesis.[1]\n\nCITATIONS:\n[1] "${fragment}"`;
    dispatch.mockResolvedValue({ answer: rawAnswer, tokensUsed: 4, modelUsed: "mock-qwen" });
    const args = { notebook: { id: directory, title: "Synthetic" },
      sources: [{ id: "synthetic", title: "Synthetic", type: "text", content: fragment }],
      notes: [], message: "What gas do plants capture?", allowWebFallback: false };
    await expect(chatWithNotebook(args)).rejects.toMatchObject({ code: "GROUNDING_UNAVAILABLE" });
    const firstFiles = await files();
    expect(firstFiles).toHaveLength(2);
    const payloads = await Promise.all(firstFiles.map(async (name) => JSON.parse(await readFile(join(directory, "grounding-candidates.private", name), "utf8"))));
    expect(payloads.map((value) => value.attempt).sort()).toEqual(["initial", "repair"]);
    expect(payloads.every((value) => value.rawAnswer.text === rawAnswer && value.tokensUsed === 4)).toBe(true);
    expect(payloads[0].notebookContext).toEqual(payloads[1].notebookContext);
    const initialMessages = dispatch.mock.calls[0][0].messages;
    const retryMessages = dispatch.mock.calls[1][0].messages;
    expect(retryMessages[0].content).toContain('JSON');
    expect(retryMessages.slice(1, -2)).toEqual(initialMessages.slice(1, -1));
    expect(retryMessages.at(-2).content).toContain(args.message);
    expect(retryMessages.at(-2).content).toContain('synthetic');
    expect(retryMessages.at(-2).content).not.toContain(fragment);
    expect(retryMessages.at(-1).content).toContain(fragment.slice(0, fragment.indexOf('.') + 1));
    expect(retryMessages.at(-1).content).not.toContain('Some plants have ev');
    await expect(chatWithNotebook(args)).rejects.toMatchObject({ code: "GROUNDING_UNAVAILABLE" });
    expect(dispatch).toHaveBeenCalledTimes(4);
  });
  it("writes no raw evidence for a successful validated response", async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    dispatch.mockResolvedValue({ answer: 'Plants capture CO2 during photosynthesis.[1]\n\nCITATIONS:\n[1] "Plants capture CO2 during photosynthesis."', tokensUsed: 4, modelUsed: "mock-qwen" });
    await chatWithNotebook({ notebook: { id: directory, title: "Synthetic" },
      sources: [{ id: "synthetic", title: "Synthetic", type: "text", content: "Plants capture CO2 during photosynthesis." }],
      notes: [], message: "What gas do plants capture?", allowWebFallback: false });
    expect(dispatch).toHaveBeenCalledTimes(1);
    await expect(files()).rejects.toMatchObject({ code: "ENOENT" });
  });
});
