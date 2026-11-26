// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { chatWithNotebook } from '../services/aiChatService.js';
import { locateCitationLines } from '../services/citationLines.js';
const dispatch = vi.hoisted(() => vi.fn());
vi.mock('../services/titanProvider.js', () => ({ dispatchToTitan: dispatch }));

describe('notebook citations point into original source text', () => {
  it('returns the original line span for a custom notebook question', async () => {
    const quote = 'The spare spectrometer is stored in the amber cabinet.';
    dispatch.mockResolvedValue({ answer: quote + '[1]\nCITATIONS:\n[1] "' + quote + '"', tokensUsed: 1, modelUsed: 'offline-mock' });
    const result = await chatWithNotebook({
      notebook: { id: 'custom-field-equipment', title: 'Field equipment' },
      sources: [{ id: 'field-inventory', title: 'Equipment inventory', type: 'text', content: 'Field log\r\n\r\nStorage record\r\nThe spare spectrometer is stored\r\nin the amber cabinet.\r\nEnd of record.' }],
      notes: [], message: 'Where is the spare spectrometer stored?', allowWebFallback: false,
    });
    expect(result.citations).toEqual([expect.objectContaining({ chunk_lines_from: 4, chunk_lines_to: 5 })]);
  });
  it('accepts literal special characters and Unicode at the start', () => {
    expect(locateCitationLines('Header\n\u{1F9EA} (sample [B])', '\u{1F9EA} (sample [B])')).toEqual({ chunk_lines_from: 2, chunk_lines_to: 2 });
  });
  it('omits coordinates for missing, repeated, and overlapping passages', () => {
    expect(locateCitationLines('Header\nFirst\nFirst', 'First')).toEqual({});
    expect(locateCitationLines('banana', 'ana')).toEqual({});
    expect(locateCitationLines('Header\nFirst', 'Second')).toEqual({});
  });
});
