import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditDiscussionSentences, discussionSentences, verifySentenceAudit } from '@/lib/audio/podcastSentenceAudit';
import { DiscussionSupportError, IncompleteDiscussionVerdictError, type DiscussionSection } from '@/lib/audio/podcastDiscussionPlan';
import { generatePodcastScript } from '@/lib/podcastGenerator';
import { chatCompletion } from '@/lib/ai/ollamaService';

vi.mock('@/lib/ai/ollamaService', () => ({chatCompletion: vi.fn()}));
vi.mock('@/config/ollamaModels', () => ({getModelForTask: () => 'local-test'}));
const text = 'Children may watch the battle only if there is no danger.';
const passages = [{id:'p1', sourceId:'book', text}, {id:'p2', sourceId:'other', text:'The pilot has not yet measured outcomes.'}];
const section = (): DiscussionSection => ({title:'A condition matters',turns:[
  {speaker:'host1',kind:'explanation',text:'The proposal allows children to watch a battle only if there is no danger.',evidence:[{passageId:'p1',quote:text}]},
  {speaker:'host2',kind:'explanation',text:'Their participation is conditional on safety.',evidence:[{passageId:'p1',quote:text}]},
  {speaker:'host1',kind:'question',text:'What condition limits watching the battle?',evidence:[{passageId:'p1',quote:text}]},
]});
const approval = (sentences = discussionSentences(section())) => ({checks:sentences.map(sentence=>({id:sentence.id,evidence:[{passageId:'p1',quote:text}],reason:'The source requires no danger.',supported:true}))});
beforeEach(()=>vi.resetAllMocks());

describe('sentence evidence gate',()=>{
  it('partitions every turn including trailing fragments without losing punctuation or words',()=>{
    const candidate=section();candidate.turns[0].text='“First?” Second; conditional on safety. Final fragment';
    const actual=discussionSentences(candidate).filter(s=>s.turnIndex===0);
    expect(actual.map(s=>s.text).join(' ')).toBe(candidate.turns[0].text);
    expect(actual.map(s=>s.id)).toEqual(['0:0','0:1','0:2']);
  });
  it('keeps decimal quantities intact when dividing a spoken turn for review',()=>{
    const candidate=section();
    candidate.turns[0].text='The rate rose from 2.75 to 3.5 percent. It then fell to 2.0 percent.';
    const actual=discussionSentences(candidate).filter(sentence=>sentence.turnIndex===0);
    expect(actual.map(sentence=>[sentence.id,sentence.text])).toEqual([
      ['0:0','The rate rose from 2.75 to 3.5 percent.'],
      ['0:1','It then fell to 2.0 percent.'],
    ]);
  });
  it('rejects missing, duplicate, foreign, malformed and truncated verdicts',()=>{
    const sentences=discussionSentences(section()), valid=approval();
    for(const value of [{checks:valid.checks.slice(1)},{checks:[valid.checks[0],valid.checks[0],valid.checks[2]]},
      {checks:valid.checks.map(c=>({...c,id:'other'}))},{checks:valid.checks.map(c=>({...c,supported:'yes'}))}]){
      expect(()=>verifySentenceAudit(JSON.stringify(value),sentences,passages)).toThrow(IncompleteDiscussionVerdictError);
    }
    expect(()=>verifySentenceAudit('{"checks":',sentences,passages)).toThrow(IncompleteDiscussionVerdictError);
  });
  it('rejects model approvals with fabricated, missing, or other-turn citation excerpts',()=>{
    for(const evidence of [[],[{passageId:'p1',quote:'Children always watch battles.'}],[{passageId:'p2',quote:passages[1].text}]]){
      const value=approval();value.checks[0].evidence=evidence;
      expect(()=>verifySentenceAudit(JSON.stringify(value),discussionSentences(section()),passages)).toThrow(DiscussionSupportError);
    }
  });
  it('retains a specific unsupported-clause reason for automatic repair even with a genuine quote',()=>{
    const value=approval();value.checks[1].supported=false;value.checks[1].reason='The no-danger condition was removed.';
    try{verifySentenceAudit(JSON.stringify(value),discussionSentences(section()),passages);throw Error('Expected rejection');}
    catch(error){expect(error).toBeInstanceOf(DiscussionSupportError);expect((error as DiscussionSupportError).supportFeedback[0]).toContain('Sentence 1:0');}
  });
  it('accepts complete supported evidence and permits whitespace differences only',()=>{
    const value=approval();value.checks[0].evidence[0].quote=text.replace('only if','only\nif');
    expect(()=>verifySentenceAudit(JSON.stringify(value),discussionSentences(section()),passages)).not.toThrow();
  });
  it('allows a verbose complete reason but bounds excessive reviewer output',()=>{
    const value=approval();value.checks[0].reason='Source comparison. '.repeat(50);
    expect(()=>verifySentenceAudit(JSON.stringify(value),discussionSentences(section()),passages)).not.toThrow();
    value.checks[0].reason='x'.repeat(2001);
    expect(()=>verifySentenceAudit(JSON.stringify(value),discussionSentences(section()),passages)).toThrow(IncompleteDiscussionVerdictError);
  });
  it('retries incomplete audits once and never accepts an incomplete second response',async()=>{
    const review=vi.fn().mockResolvedValue('{"checks":[]}');
    await expect(auditDiscussionSentences(section(),passages,review)).rejects.toThrow(IncompleteDiscussionVerdictError);
    expect(review).toHaveBeenCalledTimes(2);
  });
  it('audits all batches after a rejection so repairs receive the complete issue list',async()=>{
    const candidate=section();candidate.turns[0].text=Array.from({length:10},(_,i)=>`Claim ${i}.`).join(' ');
    const review=vi.fn(async (_system,payload)=>{
      const {sentences}=JSON.parse(payload);const value=approval(sentences);value.checks[0].supported=false;return JSON.stringify(value);
    });
    await expect(auditDiscussionSentences(candidate,passages,review)).rejects.toThrow(DiscussionSupportError);
    expect(review).toHaveBeenCalledTimes(2);
  });
});

it('repairs a sentence rejected after the paragraph reviewer approves, then rechecks before compilation',async()=>{
  let drafts=0,audits=0;
  vi.mocked(chatCompletion).mockImplementation(async request=>{
    const payload=JSON.parse(request.messages[1].content);
    if(payload.sentences){
      const value=approval(payload.sentences);audits++;
      if(audits===1){value.checks[0].supported=false;value.checks[0].reason='Dropped the no-danger condition.';}
      return JSON.stringify(value);
    }
    if(payload.turns)return JSON.stringify({verdicts:payload.turns.map((_:unknown,turnIndex:number)=>({turnIndex,supported:true}))});
    drafts++;const candidate=section();
    if(drafts===1)candidate.turns[0].text='The proposal always lets children watch battles.';
    else expect(payload.supportFeedback.join(' ')).toContain('Dropped the no-danger condition');
    return JSON.stringify(candidate);
  });
  const result=await generatePodcastScript(`SOURCE: Battle\nSOURCE_ID: "book"\n\n${text}`,{type:'deep-dive'});
  expect(drafts).toBe(2);expect(audits).toBe(2);
  expect(result.segments[0].text).toContain('only if there is no danger');
});
