import { describe, expect, it, vi } from "vitest";
import { buildLiteralRetrySentenceCatalog as catalog, buildLiteralRetryEvidenceWindows as windows, renderLiteralWindowRetry as render, chatWithNotebook } from "../services/aiChatService.js";
const dispatch = vi.hoisted(() => vi.fn());
vi.mock("../services/titanProvider.js", () => ({ dispatchToTitan: dispatch }));
const content = "Chloroplasts absorb light in photosynthesis. Background history describes old equipment. Glucose stores chemical energy in photosynthesis.";
const source = {id:"owned-video",title:"Photosynthesis",type:"youtube",content};
const refs = [{id:source.id,index:1,title:source.title,type:source.type}];
const question = "Explain what glucose and chloroplasts do in photosynthesis.";
const rows = catalog(refs,[source],content,question);
const choices = windows(refs,[source],rows);
const id = position => choices.find(row=>row.startSentenceIndex===position&&row.endSentenceIndex===position).evidenceId;
const envelope = ids => JSON.stringify({status:"supported",evidenceIds:ids});
const run = (ids, q=question, r=refs, sources=[source], c=rows) => render(envelope(ids),r,sources,c,q);
describe("bounded multi-window literal retry",()=>{
 it("quotes two disjoint roles with separate aliases for one owned source",()=>{
  const result=run([id(1),id(3)]);
  expect(result.answer).toContain("Chloroplasts absorb light in photosynthesis[2]");
  expect(result.answer).toContain("Glucose stores chemical energy in photosynthesis[3]");
  expect(result.sourceRefs.map(ref=>ref.id)).toEqual([source.id,source.id]);
  expect(result.sourceRefs.map(ref=>ref.index)).toEqual([2,3]);
 });
 it.each([[999],[-1],[0],[1.5],["1"],[],[id(1),id(1)],[id(1),id(3),id(1),id(3)]])("rejects malformed unknown or duplicate IDs %j",ids=>expect(()=>run(ids)).toThrow());
 it("rejects missing requested entity and unrelated evidence",()=>{
  expect(()=>run([id(1)])).toThrow();
  expect(()=>run([id(2)])).toThrow();
 });
 it("rejects overlapping windows and provider-written claims",()=>{
  const joined=choices.find(row=>row.startSentenceIndex===1&&row.endSentenceIndex===2);
  expect(()=>run([joined.evidenceId,id(1)])).toThrow();
  expect(()=>render(JSON.stringify({status:"supported",evidenceIds:[id(1),id(3)],answer:"Invented result"}),refs,[source],rows,question)).toThrow();
 });
 it("rejects foreign ownership, missing catalog and tampered exact text",()=>{
  expect(()=>run([id(1)],question,refs,[{...source,id:"foreign"}])).toThrow();
  expect(()=>run([id(1)],question,refs,[source],[])).toThrow();
  const tampered=rows.map(row=>({...row,text:row.text+" Invented result."}));
  expect(()=>run([id(1)],question,refs,[source],tampered)).toThrow();
 });
 it("does not hide a requested second source",()=>{
  const other={id:"other",title:"Second",type:"text",content:"Photosynthesis uses light."};
  expect(()=>run([id(1),id(3)],"Cite both sources about glucose and chloroplasts in photosynthesis.",[...refs,{id:other.id,index:2,title:other.title,type:other.type}],[source,other])).toThrow();
 });
 it("enforces aggregate sentence and excerpt budgets across separate windows",()=>{
  const exercise=(parts,select)=>{
   const local={...source,content:parts.join(" ")};
   const localRows=catalog(refs,[local],local.content,"photosynthesis");
   const localChoices=windows(refs,[local],localRows);
   const ids=select.map(([start,end])=>localChoices.find(row=>row.startSentenceIndex===start&&row.endSentenceIndex===end).evidenceId);
   return ()=>render(envelope(ids),refs,[local],localRows,"photosynthesis");
  };
  const sentence=n=>"Photosynthesis "+String(n)+" is described.";
  expect(exercise([1,2,3,4].map(sentence),[[1,2],[3,4]])).not.toThrow();
  expect(exercise([1,2,3,4,5].map(sentence),[[1,3],[4,5]])).toThrow();
  const padded=(letter,length)=>"Photosynthesis "+letter.repeat(length-16)+".";
  expect(exercise([padded("a",191),padded("b",192)],[[1,1],[2,2]])).not.toThrow();
  expect(exercise([padded("a",192),padded("b",192)],[[1,1],[2,2]])).toThrow();
 });
 it("preserves citation aliases through actual final chat output and de-duplicates grounded sources",async()=>{
  dispatch.mockReset();
  dispatch.mockResolvedValueOnce({answer:"An unsupported answer.[1]",tokensUsed:2,modelUsed:"mock"});
  dispatch.mockImplementationOnce(async request=>{
   const prompt=request.messages.at(-1).content;
   expect(prompt).toContain('"evidenceIds":[1]');
   const parsed=JSON.parse(prompt.split("=== ADMISSIBLE EVIDENCE WINDOWS: indices and bounds only ===\n")[1].split("\n=== END EVIDENCE DATA ===")[0]);
   const selected=[1,3].map(pos=>parsed.find(([,sourceIndex,start,end])=>sourceIndex===1&&start===pos&&end===pos)[0]);
   return {answer:envelope(selected),tokensUsed:3,modelUsed:"mock-retry"};
  });
  const result=await chatWithNotebook({notebook:{id:"multi-window",title:"Photosynthesis"},sources:[source],notes:[],message:question,allowWebFallback:false});
  expect(result.citations).toHaveLength(2);
  expect(result.citations.map(citation=>citation.source_id)).toEqual([source.id,source.id]);
  expect(new Set(result.citations.map(citation=>String(citation.citation_id))).size).toBe(2);
  expect(result.citations.map(citation=>citation.excerpt)).toEqual([content.split(". ")[0]+".",content.split(". ")[2]]);
  expect(result.sourceRefs.map(ref=>ref.id)).toEqual([source.id,source.id]);
  expect(result.tokensUsed).toBe(5);
  expect(dispatch).toHaveBeenCalledTimes(2);
 });
});
