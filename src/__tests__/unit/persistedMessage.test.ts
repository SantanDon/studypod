import { describe, expect, it } from 'vitest';
import { mapPersistedMessage } from '@/lib/chat/persistedMessage';

describe('persisted chat evidence', () => {
  it('restores citation IDs and full excerpts after server reload', () => {
    const citation = { citation_id: '1', source_id: 's1', source_title: 'Cedar', source_type: 'text', excerpt: '17 blue trays', chunk_lines_from: 2 };
    const result = mapPersistedMessage({ id: 'm1', role: 'assistant', content: '17 trays [1]', groundedSources: JSON.stringify({ version: 1, sourceIds: ['s1'], citations: [citation] }) });
    expect(result.message.content).toEqual({ segments: [{ text: '17 trays [1]' }], citations: [{ ...citation, citation_id: 1 }] });
  });
  it.each(['["s1"]', '{invalid', '{"version":1,"citations":[null,{}]}'])('keeps legacy or invalid metadata readable: %s', (groundedSources) => {
    expect(mapPersistedMessage({ id: 'm', role: 'assistant', content: 'Readable answer', groundedSources }).message.content).toBe('Readable answer');
  });
  it('does not turn user text into assistant evidence', () => {
    expect(mapPersistedMessage({ id: 'u', role: 'user', content: 'Question', groundedSources: { version: 1, citations: [{ citation_id: 1, source_id: 's' }] } }).message).toEqual({ type: 'human', content: 'Question' });
  });
});
