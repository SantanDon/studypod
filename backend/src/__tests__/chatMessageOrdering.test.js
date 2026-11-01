import { describe, expect, it } from 'vitest';
import { sortChatMessages } from '../utils/chatMessageOrdering.js';

describe('sortChatMessages', () => {
  it('puts user rows before assistant rows when legacy timestamps tie, deterministically', () => {
    const timestamp = new Date('2026-10-21T10:00:00.000Z');
    const input = [
      { id: 'z-assistant', role: 'assistant', createdAt: timestamp },
      { id: 'z-user', role: 'user', createdAt: timestamp },
      { id: 'a-user', role: 'user', createdAt: timestamp },
      { id: 'older-assistant', role: 'assistant', createdAt: new Date(timestamp.getTime() - 1) },
    ];

    expect(sortChatMessages(input).map(({ id }) => id)).toEqual([
      'older-assistant', 'a-user', 'z-user', 'z-assistant',
    ]);
    expect(input[0].id).toBe('z-assistant');
  });
});
