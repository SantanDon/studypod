import type { LocalSource } from '@/services/localStorageService';
import type { Citation } from '@/types/message';

export const revisionGuide = {
  title: 'Weekly revision planner',
  description: 'Ask what to do on Friday, then follow the citation.',
  questions: ['What should I do on Friday?', 'How do I pick topics?', 'When do I revisit mistakes?'],
  content: [
    'Monday — Pick topics. List three questions from your last lesson. Circle the question you feel least ready to answer.',
    'Tuesday — Try answering the circled question from memory. Open your notes and underline the passage that corrects or completes your answer.',
    'Wednesday — Revisit mistakes. Cover the correction, answer again, and compare your wording with the original passage.',
    'Thursday — Write a new example for each topic and explain it aloud.',
    'Friday — Close your notes and take a three-question practice quiz. Mark each answer against its source and move one unfinished topic into next week.',
  ].join('\n\n'),
};

const ignored = new Set('a an and are at be can could did do does find for from how i in is it me my of on passage please should the to what when where which with would'.split(' '));
const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const terms = (text: string) => tokens(text).filter(word => !ignored.has(word));

export function findGuestPassage(question: string, sources: LocalSource[]): Citation | undefined {
  const phrase = terms(question);
  const query = [...new Set(phrase)];
  if (!query.length) return;
  let best: Citation | undefined;
  let highest = 0;
  for (const source of sources) {
    for (const [index, line] of (source.content || '').split('\n').entries()) {
      const lineTerms = terms(line);
      const words = new Set(lineTerms);
      const matches = query.filter(term => words.has(term)).length;
      if (matches < Math.ceil(query.length / 2)) continue;
      const containsPhrase = phrase.length > 1 && lineTerms.some((word, start) =>
        word === phrase[0] && phrase.every((term, offset) => lineTerms[start + offset] === term));
      const score = matches * 2 + Number(containsPhrase);
      if (score <= highest) continue;
      highest = score;
      best = { citation_id: 1, source_id: source.id, source_title: source.title,
        source_type: source.type, excerpt: line.trim(), chunk_lines_from: index + 1, chunk_lines_to: index + 1 };
    }
  }
  return best;
}
