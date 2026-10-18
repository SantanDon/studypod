// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { extractHtmlContent } from '../services/extractionService.js';

const paragraph = 'The Cedar station contains 17 blue trays. Its observations are collected every Tuesday morning.';
describe('website source content isolation', () => {
  it('extracts a nested article once and excludes surrounding navigation', () => {
    const result = extractHtmlContent('<body><div role="navigation">Account Search Languages</div><main><article><h1>Cedar study</h1><p>'+paragraph+'</p><h2>Method</h2><p>Count every tray.</p></article></main></body>');
    expect(result.title).toBe('Cedar study');
    expect(result.content.match(/17 blue trays/g)).toHaveLength(1);
    expect(result.content).not.toContain('Account Search');
    expect(result.content).toContain('## Method\n\nCount every tray.');
  });
  it('isolates Wikipedia article prose from language selectors and tools', () => {
    const result = extractHtmlContent('<title>Cedar - Wikipedia</title><body><main><h1>Cedar</h1><div>160 languages Tools Search</div><div class="mw-parser-output"><p>'+paragraph+'</p><h2>Observations<span class="mw-editsection">edit</span></h2><p>Measurements are recorded.</p></div></main></body>');
    expect(result.content).toBe('# Cedar\n\n'+paragraph+'\n\n## Observations\n\nMeasurements are recorded.');
    expect(result.title).toBe('Cedar - Wikipedia');
  });
  it('keeps plain pages without semantic article containers readable', () => {
    const result = extractHtmlContent('<body><h1>Cedar</h1><p>'+paragraph+'</p><p>Second paragraph.</p><script>untrusted()</script></body>');
    expect(result.content).toContain(paragraph+'\n\nSecond paragraph.');
    expect(result.content).not.toContain('untrusted');
  });
});
