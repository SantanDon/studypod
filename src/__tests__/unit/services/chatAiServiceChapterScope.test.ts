import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSources, search, chatCompletion, buildChatHistoryMessages } = vi.hoisted(() => ({
  getSources: vi.fn(),
  search: vi.fn(),
  chatCompletion: vi.fn(),
  buildChatHistoryMessages: vi.fn(() => []),
}));

vi.mock('@/services/localStorageService', () => ({ localStorageService: { getSources } }));
vi.mock('@/lib/search/semanticSearch', () => ({ search }));
vi.mock('@/utils/chatHistoryBuilder', () => ({ buildChatHistoryMessages }));
vi.mock('@/lib/ai/ollamaService', () => ({ chatCompletion }));

import { generateAIResponse } from '@/services/chatAiService';
import { withAudiobookReadingContext } from '@/lib/audio/readingContext';

const source = (content: string, id = 'book-source', title = 'The Republic') => ({
  id, notebook_id: 'notebook', title, type: 'ebook',
  content, processing_status: 'completed', created_at: '', updated_at: '',
});

const readerQuestion = () => withAudiobookReadingContext('What does the argument say?', {
  audiobookId: 'audio', sourceId: 'book-source', bookTitle: 'The Republic',
  chapterId: 'book-1', chapterIndex: 0, chapterCount: 1, chapterTitle: 'Book I',
  progressPercent: 40, isPlaying: false,
});

describe('chat audiobook structural chapter scope', () => {
  beforeEach(() => {
    getSources.mockReset();
    search.mockReset();
    buildChatHistoryMessages.mockReset().mockReturnValue([]);
    chatCompletion.mockReset().mockResolvedValue('grounded answer');
  });

  it('sends only the matching structural section as cited evidence', async () => {
    getSources.mockReturnValue([source([
      'Introduction', 'Critias tells the story of Atlantis.',
      'BOOK II. Thrasymachus is pacified, but Glaucon insists on continuing.',
      '', '--- BOOK I ---', 'PERSONS OF THE DIALOGUE.', 'Socrates discusses justice with Cephalus.',
      '', '--- BOOK II ---', 'Socrates and Glaucon discuss justice.',
    ].join('\n'))]);

    await generateAIResponse(readerQuestion(), { id: 'user', email: 'test@example.com', created_at: '' }, 'notebook');

    const submitted = chatCompletion.mock.calls[0][0].messages.at(-1).content;
    expect(submitted).toContain('[1] Source: "The Republic"');
    expect(submitted).toContain('Socrates discusses justice');
    expect(submitted).not.toContain('Critias tells the story');
    expect(submitted).not.toContain('Thrasymachus is pacified');
    expect(submitted).not.toContain('Socrates and Glaucon discuss justice');
    expect(search).not.toHaveBeenCalled();
  });

  it('excludes unscoped prior chat turns from chapter-grounded answers', async () => {
    getSources.mockReturnValue([source([
      'INTRODUCTION', 'Critias tells the story of Atlantis.',
      '', '--- BOOK I ---', 'Socrates discusses justice with Cephalus.',
      '', '--- BOOK II ---', 'Glaucon discusses justice.',
    ].join('\n'))]);
    buildChatHistoryMessages.mockReturnValue([
      { role: 'user', content: 'What does the introduction say about Atlantis?' },
      { role: 'assistant', content: 'Critias tells the story of Atlantis.' },
    ]);

    await generateAIResponse(readerQuestion(), { id: 'user', email: 'test@example.com', created_at: '' }, 'notebook');

    const messages = chatCompletion.mock.calls[0][0].messages;
    expect(messages.map((message: { content: string }) => message.content).join('\n')).not.toContain('Atlantis');
    expect(messages.at(-1).content).toContain('Socrates discusses justice with Cephalus');
  });

  it('matches the wrapped Book II dialogue heading, not prose mentioning Book II', async () => {
    getSources.mockReturnValue([source([
      'BOOK II. Thrasymachus is pacified, but Glaucon insists on continuing.',
      'Introduction continues with commentary on the dialogue.',
      '', '--- BOOK I ---', 'Book I dialogue text.',
      '', '--- BOOK II ---', 'Socrates and Glaucon discuss justice.',
      '--- BOOK III ---', 'The next structural section.',
    ].join('\n'))]);
    const bookTwoQuestion = withAudiobookReadingContext('What is discussed?', {
      audiobookId: 'audio', sourceId: 'book-source', bookTitle: 'The Republic',
      chapterId: 'book-2', chapterIndex: 1, chapterCount: 13, chapterTitle: 'Book II',
      progressPercent: 0, isPlaying: false,
    });

    await generateAIResponse(bookTwoQuestion, { id: 'user', email: 'test@example.com', created_at: '' }, 'notebook');

    const submitted = chatCompletion.mock.calls[0][0].messages.at(-1).content;
    expect(submitted).toContain('Socrates and Glaucon discuss justice');
    expect(submitted).not.toContain('Thrasymachus is pacified');
    expect(submitted).not.toContain('Book I dialogue text');
    expect(submitted).not.toContain('The next structural section');
  });

  it('finds a relevant passage after the former 12,000-character opening cutoff', async () => {
    const lateChapterText = `BOOK I\n\n${'An ordinary discussion continues. '.repeat(500)}\n\nSocrates defines justice through the distinctive idea of reciprocity.`;
    getSources.mockReturnValue([source(lateChapterText)]);
    const lateQuestion = withAudiobookReadingContext('How does Socrates define reciprocity?', {
      audiobookId: 'audio', sourceId: 'book-source', bookTitle: 'The Republic',
      chapterId: 'book-1', chapterIndex: 0, chapterCount: 1, chapterTitle: 'Book I',
      progressPercent: 40, isPlaying: false,
    });

    await generateAIResponse(lateQuestion, { id: 'user', email: 'test@example.com', created_at: '' }, 'notebook');

    const submitted = chatCompletion.mock.calls[0][0].messages.at(-1).content;
    expect(lateChapterText.indexOf('reciprocity')).toBeGreaterThan(12000);
    expect(submitted).toContain('Socrates defines justice through the distinctive idea of reciprocity.');
    expect(submitted).not.toContain('An ordinary discussion continues.');
  });

  it('keeps selected chapter passages within 6,000 total characters and preserves source citation numbering', async () => {
    getSources.mockReturnValue([
      source(`BOOK I\n\n${'Justice and fairness are discussed in this passage. '.repeat(80)}`, 'source-one', 'First source'),
      source(`BOOK I\n\n${'Justice and fairness are discussed in this passage. '.repeat(80)}`, 'source-two', 'Second source'),
    ]);

    await generateAIResponse(readerQuestion(), { id: 'user', email: 'test@example.com', created_at: '' }, 'notebook');

    const submitted = chatCompletion.mock.calls[0][0].messages.at(-1).content;
    const evidence = submitted.split('Notebook evidence:\n')[1].split('\n\nUser question:')[0];
    const sourceContents = [...evidence.matchAll(/Content: ([\s\S]*?)(?=\n\n\[\d+\] Source:|$)/g)].map((match) => match[1]);
    expect(sourceContents).toHaveLength(2);
    expect(sourceContents.reduce((total, content) => total + content.length, 0)).toBeLessThanOrEqual(6000);
    expect(evidence).toContain('[1] Source: "First source"');
    expect(evidence).toContain('[2] Source: "Second source"');
  });

  it('fails closed with an honest message when the selected structural section is absent', async () => {
    getSources.mockReturnValue([source('Introduction: Plato presents the Republic. Atlantis appears later.')]);

    const result = await generateAIResponse(readerQuestion(), { id: 'user', email: 'test@example.com', created_at: '' }, 'notebook');

    expect(result).toContain("couldn't identify a Book I section");
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });
});
