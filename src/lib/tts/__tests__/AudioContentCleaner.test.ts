import { AudioContentCleaner } from '../AudioContentCleaner';

describe('AudioContentCleaner', () => {
  test('preserveContext=true retains first paragraph after heading', () => {
    const input = `# Title\n\nFirst paragraph that should stay.\n\nSome *markdown* content.`;
    const output = AudioContentCleaner.cleanForAudio(input, true);
    // Since preserveContext returns original text, expect unchanged
    expect(output).toBe(input);
  });

  test('preserveContext=false cleans markdown', () => {
    const input = `# Title\n\nSome *markdown* **text**.\n\n[Link](https://example.com)`;
    const output = AudioContentCleaner.cleanForAudio(input, false);
    // Expect markdown symbols removed
    expect(output).not.toMatch(/\*|\[/);
    expect(output).not.toContain('Link');
  });
});
