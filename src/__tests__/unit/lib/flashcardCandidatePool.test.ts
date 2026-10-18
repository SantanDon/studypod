import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('@/lib/ai/ollamaService',()=>({chatCompletion:vi.fn(),FAST_MODELS:{summarize:'mock'}}));
import {chatCompletion} from '@/lib/ai/ollamaService';
import {generateFlashcards} from '@/lib/flashcards/flashcardGenerator';
const model=vi.mocked(chatCompletion);
const sentences=['The Cedar experiment uses exactly 17 blue trays.','Each tray contains three bean seedlings.','Water is measured every morning.','The seedlings receive light for six hours daily.','Plants use carbon dioxide and water to produce sugars and release oxygen.','Researchers compare growth after fourteen days.'];
const record=(i:number,answer:string)=>JSON.stringify({type:'fact',evidence:sentences[i],answer});
beforeEach(()=>model.mockReset());afterEach(()=>vi.restoreAllMocks());
it('over-selects a bounded pool, rejects invalid choices, and returns only requested grounded cards',async()=>{
 model.mockResolvedValue([record(0,'17 blue trays'),record(1,'three bean seedlings'),record(2,'every morning'),record(3,'six hours'),record(4,'carbon dioxide and water'),record(5,'fourteen days')].join('\n'));
 const cards=await generateFlashcards(sentences.join(' '),3,'source','Cedar');
 expect(model.mock.calls[0][0].messages[1].content).toContain('Select 6 distinct');expect(model).toHaveBeenCalledTimes(1);expect(cards.map(c=>c.back)).toEqual(['17 blue trays','every morning','six hours']);
 for(const c of cards)expect(sentences).toContain(c.front.slice('Complete the source statement: '.length).replace('____',c.back));
});
it('does not request extra unique sentences from a short source',async()=>{
 model.mockResolvedValue([record(0,'17 blue trays'),record(2,'every morning')].join('\n'));
 expect(await generateFlashcards([sentences[0],sentences[2]].join(' '),2,'source','Cedar')).toHaveLength(2);
 expect(model.mock.calls[0][0].messages[1].content).toContain('Select 2 distinct');
});
it('caps pools at fifty even for maximum requested output',async()=>{
 const source=Array.from({length:60},(_,i)=>`The instrument number ${i} measures light during every clear afternoon.`).join(' ');
 model.mockResolvedValue('{}');await expect(generateFlashcards(source,50,'source','Cedar')).rejects.toThrow('Only 0 of 50');
 expect(model.mock.calls[0][0].messages[1].content).toContain('Select 50 distinct');expect(model).toHaveBeenCalledTimes(1);
});
it('bounds correction by remaining distinct sentences and retains the shared deadline',async()=>{
 model.mockResolvedValueOnce([record(0,'17 blue trays'),record(1,'three bean seedlings'),record(2,'every morning')].join('\n')).mockResolvedValueOnce(record(1,'bean seedlings'));
 expect(await generateFlashcards(sentences.slice(0,3).join(' '),3,'source','Cedar')).toHaveLength(3);
 expect(model.mock.calls[1][0].messages[1].content).toContain('Select 1 distinct');expect(model.mock.calls[1][0].deadlineAt).toBe(model.mock.calls[0][0].deadlineAt);
});

it('fails without a provider call when no complete source sentence exists',async()=>{
 await expect(generateFlashcards('A sufficiently long source paragraph that lacks all sentence terminal punctuation',3,'source','Cedar')).rejects.toThrow('no complete sentences');
 expect(model).not.toHaveBeenCalled();
});
it('uses only one source sentence and never requests extra missing evidence after exhausting it',async()=>{
 const evidence='The Cedar experiment uses exactly 17 blue trays during the planned greenhouse experiment.';
 model.mockResolvedValue(['17 blue trays','blue trays','The Cedar experiment uses exactly 17 blue'].map(answer=>JSON.stringify({type:'fact',evidence,answer})).join('\n'));
 await expect(generateFlashcards(evidence,3,'source','Cedar')).rejects.toThrow('Only 1 of 3');
 expect(model.mock.calls[0][0].messages[1].content).toContain('Select 1 distinct');expect(model).toHaveBeenCalledTimes(1);
});
it('does not count repeated evidence sentences as additional candidate capacity',async()=>{
 model.mockResolvedValue(record(0,'17 blue trays'));
 await expect(generateFlashcards([sentences[0],sentences[0]].join(' '),2,'source','Cedar')).rejects.toThrow('Only 0 of 2');
 expect(model.mock.calls[0][0].messages[1].content).toContain('Select 1 distinct');expect(model).toHaveBeenCalledTimes(1);
});
