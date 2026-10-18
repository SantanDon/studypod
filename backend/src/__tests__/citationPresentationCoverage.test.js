import { describe, expect, it, vi } from "vitest";
vi.mock("../services/titanProvider.js", () => ({ dispatchToTitan: vi.fn() }));
import { literalRetryCoverageQuestion as coverage, buildLiteralRetrySentenceCatalog as catalog, buildLiteralRetryEvidenceWindows as windows, renderLiteralWindowRetry as render, getSafeGroundingFailureReason as reason, buildLiteralRetryMessages } from "../services/aiChatService.js";
const question = "What is Plato’s Republic about? Give a concise explanation grounded in this notebook’s source.";
const source = { id:"owned-book", title:"Republic", type:"text", content:"Plato's Republic connects politics with philosophy. Give a concise explanation grounded in this notebook about illustrations. Photosynthesis converts light energy." };
const refs = [{ id:source.id, index:1, title:source.title, type:source.type }];
const rows = catalog(refs,[source],source.content,question);
const choices = windows(refs,[source],rows);
const first = choices.find(row=>row.startSentenceIndex===1 && row.endSentenceIndex===1).evidenceId;
const attempt = (q=question, answer=JSON.stringify({status:"supported",evidenceIds:[first]})) => render(answer,refs,[source],rows,q);
const failure = fn => { try { fn(); return "unexpected-success"; } catch(error) { return reason(error); } };
describe("literal retry presentation instructions",()=>{
 it("replaces full notebook context with source metadata while retaining history and current question",()=>{
  const history = { role:"assistant", content:"Earlier discussion for resolving this reference." };
  const original = [{role:"system",content:"Original answer instructions"}, history, {role:"user",content:`FULL_CONTEXT_SENTINEL ${source.content}\n${question}`}];
  const retry = buildLiteralRetryMessages(original, [{...refs[0],content:"FORBIDDEN_BODY",extra:"FORBIDDEN_EXTRA"}], question);
  expect(retry[1]).toEqual(history);
  expect(retry.at(-1).content).toContain(question);
  expect(retry.at(-1).content).toContain('"id":"owned-book"');
  expect(JSON.stringify(retry)).not.toMatch(/FULL_CONTEXT_SENTINEL|FORBIDDEN_BODY|FORBIDDEN_EXTRA|connects politics with philosophy/);
  expect(original.at(-1).content).toContain("FULL_CONTEXT_SENTINEL");
 });
 it("removes a complete trailing presentation instruction only",()=>{
  expect(coverage(question)).toBe("What is Plato’s Republic");
  expect(coverage("what is Plato republic about")).toBe("what is Plato republic");
 });
 it("accepts exact owned thematic evidence despite presentation words elsewhere in the book",()=>{
  const result=attempt();
  expect(result.answer).toContain("Plato's Republic connects politics with philosophy");
  expect(result.answer).toMatch(/\[2\]/);
  expect(result.sourceRefs.map(ref=>ref.id)).toEqual([source.id]);
 });
 it("retains substantive second-topic obligations",()=>{
  const q="What is Plato’s Republic about? Give a concise explanation of photosynthesis.";
  expect(coverage(q)).toBe(q);
  expect(failure(()=>attempt(q))).toBe("retry_question_coverage");
 });
 it("rejects instruction-only or unrelated requests",()=>{
  expect(failure(()=>attempt("Give a concise explanation."))).toBe("retry_query_anchor");
  expect(failure(()=>attempt("Explain photosynthesis."))).toBe("retry_query_anchor");
 });
 it("keeps provider-declared insufficiency and unknown diagnostics fail closed",()=>{
  expect(failure(()=>attempt(question,JSON.stringify({status:"insufficient"})))).toBe("retry_insufficient");
  expect(reason({groundingReason:"private generated text"})).toBe("unclassified");
 });
 it.each(["retry_query_anchor","retry_source_coverage","retry_question_coverage"])("allows fixed reason %s",value=>expect(reason({groundingReason:value})).toBe(value));
});
