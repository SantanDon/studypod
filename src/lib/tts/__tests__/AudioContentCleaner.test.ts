import { describe, test, expect } from 'vitest';
import { AudioContentCleaner } from '../AudioContentCleaner';

describe('AudioContentCleaner', () => {
  test('preserveContext=true retains first paragraph after heading', () => {
    const input = `# Title\n\nFirst paragraph that should stay.\n\nSome *markdown* content.`;
    const output = AudioContentCleaner.cleanForAudio(input, true);
    expect(output).toBe(input);
  });

  test('preserveContext=false cleans markdown', () => {
    const input = `# Title\n\nSome *markdown* **text**.\n\n[Link](https://example.com)`;
    const output = AudioContentCleaner.cleanForAudio(input, false);
    expect(output).not.toMatch(/\*|\[/);
    expect(output).not.toContain('Link');
  });

  describe('cleanForTTS', () => {
    test('expands common abbreviations', () => {
      const input = 'Some concepts e.g. machine learning and i.e. deep learning etc.';
      const output = AudioContentCleaner.cleanForTTS(input);
      expect(output).toContain('for example');
      expect(output).toContain('that is');
      expect(output).toContain('and so on');
      expect(output).not.toContain('e.g.');
      expect(output).not.toContain('i.e.');
    });

    test('removes URLs', () => {
      const input = 'Check https://example.com/page for more info.';
      const output = AudioContentCleaner.cleanForTTS(input);
      expect(output).not.toContain('https://');
    });

    test('collapses whitespace', () => {
      const input = 'This   has  extra   spaces.';
      const output = AudioContentCleaner.cleanForTTS(input);
      expect(output).toBe('This has extra spaces.');
    });

    test('handles empty and short text', () => {
      expect(AudioContentCleaner.cleanForTTS('')).toBe('');
      expect(AudioContentCleaner.cleanForTTS('Hi')).toBe('Hi');
    });
  });

  describe('cleanSegment', () => {
    test('strips markdown then preprocesses in one pass', () => {
      const input = '**Key point:** e.g. neural networks are important.';
      const output = AudioContentCleaner.cleanSegment(input);
      expect(output).not.toMatch(/\*{1,3}/);
      expect(output).toContain('for example');
    });
  });
});
