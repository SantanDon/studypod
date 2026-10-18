import { describe, expect, it } from 'vitest';
import { buildPodcastSourceContext } from '@/lib/podcastSourceContext';

describe('podcast evidence budgeting preserves source identity and limitations', () => {
  it('retains the tail limitation of an unstructured source instead of only its opening', () => {
    const source = { id:'one', title:'Pilot report', content:'START_FACT '+ 'Background words. '.repeat(1500) + ' LIMITATION: no control group; no causal conclusion.' };
    const result=buildPodcastSourceContext([source],{maxChars:2000});
    expect(result).toContain('START_FACT'); expect(result).toContain('no causal conclusion');
    expect(result).toContain('excerpt gap'); expect(result.length).toBeLessThanOrEqual(2000);
  });
  it('represents every selected source instead of silently truncating the last ones', () => {
    const sources=Array.from({length:10},(_,i)=>({id:String(i),title:`SOURCE_TITLE_${i}`,content:`FACT_${i} `+'context '.repeat(300)}));
    const result=buildPodcastSourceContext(sources,{maxChars:6000});
    for(let i=0;i<10;i++){expect(result).toContain(`SOURCE_TITLE_${i}`);expect(result).toContain(`FACT_${i}`);}
    expect(result.length).toBeLessThanOrEqual(6000);
  });
  it('asks for a narrower selection when each source cannot receive a useful excerpt', () => {
    const sources=Array.from({length:20},(_,i)=>({id:String(i),title:'Fixture',content:'Original source text.'}));
    expect(()=>buildPodcastSourceContext(sources,{maxChars:1000})).toThrow('fewer sources');
  });
  it.each([NaN,Infinity,0,499,100001,1000.5])('rejects an invalid budget %s',maxChars=>expect(()=>buildPodcastSourceContext([{content:'A useful source.'}],{maxChars})).toThrow('budget'));
  it('keeps full short source text without inventing podcast commentary',()=>{
    const text='Average attendance40→58. No control group; causality not established.';
    const result=buildPodcastSourceContext([{id:'short',title:'Measured pilot',content:text}]);
    expect(result).toContain(text);expect(result).not.toContain('fascinating');
  });
});
