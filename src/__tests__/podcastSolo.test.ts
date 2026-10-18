import { beforeEach, it, expect, vi } from "vitest";
import { generatePodcastScript } from "@/lib/podcastGenerator";
import { chatCompletion } from "@/lib/ai/ollamaService";
vi.mock("@/lib/ai/ollamaService",()=>({chatCompletion:vi.fn()}));
vi.mock("@/config/ollamaModels",()=>({getModelForTask:()=>"mock-model"}));
beforeEach(()=>{vi.clearAllMocks();});
it("compiles a source-faithful solo script for the chosen host",async()=>{
  vi.mocked(chatCompletion).mockResolvedValue('{"passageIds":["p1"]}');
  const source="No results exist yet. This experiment is planned for next year.";
  const script=await generatePodcastScript(source,{format:'solo',host1Name:'Priya'});
  expect(script.segments.every(s=>s.speaker==='Priya')).toBe(true);
  expect(script.segments.some(s=>s.text===source)).toBe(true);
  expect(script.title).toBe('Guided source discussion');
});
it("rejects malformed JSON before any solo narration",async()=>{
  vi.mocked(chatCompletion).mockResolvedValue('oops');
  await expect(generatePodcastScript('A source.',{format:'solo'})).rejects.toThrow(/not valid episode JSON/);
});
it("rejects invented model-written solo dialogue",async()=>{
  vi.mocked(chatCompletion).mockResolvedValue('{"title":"Results","segments":[{"speaker":"Alex","text":"The planned trial succeeded."}]}');
  await expect(generatePodcastScript('The trial is only planned.',{format:'solo'})).rejects.toThrow(/model-written narration/);
});
