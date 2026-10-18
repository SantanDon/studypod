import { describe, expect, it, vi } from 'vitest';
import { extractContent } from '@/lib/extraction/documentExtractor';
import { buildPodcastEvidenceContext, generatePodcastScript } from '@/lib/podcastGenerator';
import { indexPodcastEvidence } from '@/lib/audio/podcastEvidencePlan';
import { chatCompletion } from '@/lib/ai/ollamaService';

vi.mock('@/lib/ai/ollamaService', () => ({ chatCompletion: vi.fn() }));
vi.mock('@/config/ollamaModels', () => ({ getModelForTask: () => 'mock-model' }));

function textFile(content: string): File {
  const file = new File([content], 'lesson.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'text', { value: async () => content });
  return file;
}

describe('TXT paragraph preservation', () => {
  it.each(['\n', '\r\n', '\r'])('preserves paragraphs and wrapped lines for %j line endings', async (newline) => {
    const result = await extractContent(textFile(`First paragraph.${newline}Still the first paragraph.${newline}   ${newline}Second paragraph.${newline}${newline}${newline}Third paragraph.`));
    expect(result.content).toBe('First paragraph.\nStill the first paragraph.\n\nSecond paragraph.\n\nThird paragraph.');
    expect(result.metadata.paragraphCount).toBe(3);
  });

  it('preserves existing cleanup while retaining its paragraph separators', async () => {
    const result = await extractContent(textFile('“First”\t paragraph.\u200B\n\n12\n\nSecond — paragraph.'));
    expect(result.content).toBe('"First" paragraph.\n\nSecond - paragraph.');
    expect(result.metadata.paragraphCount).toBe(2);
  });

  it('extracts a 13k TXT upload through the actual podcast chain using complete evidence only', async () => {
    const paragraphs = Array.from({ length: 100 }, (_, index) => `Passage ${index}: The pilot remains planned; no measured outcomes have been reported. All limitations must remain attached to this passage.`);
    const original = paragraphs.join('\r\n\r\n');
    expect(original.length).toBeGreaterThan(13000);
    const extracted = await extractContent(textFile(original));
    expect(extracted.content).toBe(paragraphs.join('\n\n'));
    expect(extracted.metadata.paragraphCount).toBe(100);
    const context = buildPodcastEvidenceContext([{ id: 'upload', title: 'Uploaded lesson', content: extracted.content }]);
    const evidence = indexPodcastEvidence(context);
    expect(context.length).toBeLessThanOrEqual(12000);
    expect(evidence.excerpted).toBe(true);
    for (const passage of evidence.passages) expect(paragraphs).toContain(passage.text);
    vi.mocked(chatCompletion).mockResolvedValue('{"passageIds":["p1"]}');
    const script = await generatePodcastScript(context, { userNotes: 'INSTRUCTION_ONLY_SENTINEL' });
    expect(script.segments.some(segment => segment.text === paragraphs[0])).toBe(true);
    expect(script.segments.some(segment => /SOURCE:|COVERAGE:|INSTRUCTION_ONLY_SENTINEL/.test(segment.text))).toBe(false);
    expect(script.metadata?.sourceCoverage?.excerpted).toBe(true);
  });
});
