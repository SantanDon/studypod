// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { withAudiobookReadingContext } from '../../../src/lib/audio/readingContext.ts';

const state = vi.hoisted(() => ({
  helpers: {
    getUserById: vi.fn(), getNotebookById: vi.fn(), getSourcesByNotebookId: vi.fn(),
    getChatMessagesByNotebookId: vi.fn(), getApiKeyByHash: vi.fn(), touchApiKey: vi.fn(),
  },
  inserts: [],
  transaction: vi.fn(),
}));
vi.mock('../db/database.js', () => ({
  dbHelpers: state.helpers,
  schema: { chatMessages: { table: 'chat_messages' } },
  getDatabase: vi.fn(async () => ({ transaction: state.transaction })),
}));
const { default: router } = await import('../routes/notebooks.js');
const secret = 'local-chat-route-tests-secret-with-more-than-32-characters';
let priorSecret;
beforeEach(() => {
  priorSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  vi.clearAllMocks();
  state.inserts.length = 0;
  state.helpers.getUserById.mockResolvedValue({ id: 'owner' });
  state.helpers.getNotebookById.mockResolvedValue({ id: 'book', title: 'Notebook' });
  state.helpers.getSourcesByNotebookId.mockResolvedValue([
    { id: 'source-1', title: 'Owned source', type: 'text', content: 'Grounded content' },
  ]);
  state.helpers.getChatMessagesByNotebookId.mockImplementation(async () => state.inserts);
  state.transaction.mockImplementation(async callback => callback({ insert: () => ({ values: async row => { state.inserts.push(row); } }) }));
});
afterEach(() => {
  if (priorSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = priorSecret;
});
const session = () => jwt.sign({ userId: 'owner' }, secret, { algorithm: 'HS256' });
function dispatch({ method = 'POST', url, token, body = {} }) {
  return new Promise((resolve, reject) => {
    const req = { method, url, originalUrl: url, headers: token ? { authorization: `Bearer ${token}` } : {}, body };
    const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { resolve({ status: this.statusCode, body: value }); return this; } };
    router.handle(req, res, error => error ? reject(error) : resolve({ status: 404 }));
  });
}

describe('authenticated browser-local chat contract', () => {
  it('requires a signed-in session and rejects a source outside the owned notebook', async () => {
    expect((await dispatch({ url: '/book/local-chat/context', body: { sourceIds: ['source-1'] } })).status).toBe(401);
    state.helpers.getSourcesByNotebookId.mockResolvedValueOnce([]);
    const result = await dispatch({ url: '/book/local-chat/context', token: session(), body: { sourceIds: ['foreign-source'] } });
    expect(result).toEqual({ status: 400, body: { error: 'One or more sources are unavailable in this notebook' } });
    expect(state.helpers.getSourcesByNotebookId).toHaveBeenCalledWith('book', 'owner');
  });

  it('returns bounded owned context and persists both turn rows under authenticated identity', async () => {
    const context = await dispatch({ url: '/book/local-chat/context', token: session(), body: { sourceIds: ['source-1'] } });
    expect(context).toEqual({ status: 200, body: { notebookId: 'book', sources: [{ id: 'source-1', title: 'Owned source', type: 'text', content: 'Grounded content' }] } });
    const result = await dispatch({
      url: '/book/local-chat/turn', token: session(),
      body: { turnId: '11111111-1111-4111-8111-111111111111', question: 'Explain this', answer: 'It was observed [1].', sourceIds: ['source-1'], citationMap: [{ citationId: 1, sourceId: 'source-1' }], userId: 'attacker', notebookId: 'foreign-book' },
    });
    expect(result.status).toBe(201);
    expect(state.transaction).toHaveBeenCalledOnce();
    expect(state.inserts).toHaveLength(2);
    expect(state.inserts.map(({ role, userId, notebookId }) => ({ role, userId, notebookId }))).toEqual([
      { role: 'user', userId: 'owner', notebookId: 'book' },
      { role: 'assistant', userId: 'owner', notebookId: 'book' },
    ]);
    expect(JSON.parse(state.inserts[1].groundedSources).citations).toEqual([{ citation_id: 1, source_id: 'source-1', source_title: 'Owned source', source_type: 'text', excerpt: 'Grounded content' }]);
    expect(result.body.messages.map(({ id, role }) => ({ id, role }))).toEqual(state.inserts.map(({ id, role }) => ({ id, role })));
    expect(state.helpers.getChatMessagesByNotebookId).toHaveBeenCalledWith('book', 'owner');
  });

  it('persists the exact scoped citation passage with source line coordinates', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([{
      id: 'source-1', title: 'Republic EPUB', type: 'epub',
      content: 'INTRODUCTION AND ANALYSIS\nFront matter text.\nBOOK I.\nCephalus says wealth helps a just person avoid deception and unpaid debts.\nBOOK II.\nLater discussion.',
    }]);
    const excerpt = 'Cephalus says wealth helps a just person avoid deception and unpaid debts.';
    const result = await dispatch({
      url: '/book/local-chat/turn', token: session(),
      body: {
        turnId: '55555555-5555-4555-8555-555555555555', question: 'Check my answer about Book I',
        answer: 'Cephalus connects wealth with avoiding deception and unpaid debts [1].',
        sourceIds: ['source-1'], citationMap: [{ citationId: 1, sourceId: 'source-1', excerpt }],
      },
    });
    expect(result.status).toBe(201);
    expect(JSON.parse(state.inserts[1].groundedSources).citations).toEqual([{
      citation_id: 1, source_id: 'source-1', source_title: 'Republic EPUB', source_type: 'epub',
      excerpt, chunk_lines_from: 4, chunk_lines_to: 4,
    }]);
  });

  it('rejects a citation excerpt that is not present verbatim in its selected source', async () => {
    const result = await dispatch({
      url: '/book/local-chat/turn', token: session(),
      body: {
        turnId: '66666666-6666-4666-8666-666666666666', question: 'Explain this', answer: 'Claim [1].',
        sourceIds: ['source-1'], citationMap: [{ citationId: 1, sourceId: 'source-1', excerpt: 'Invented passage.' }],
      },
    });
    expect(result).toEqual({ status: 400, body: { error: 'Citation excerpt must be a bounded passage from its selected source' } });
    expect(state.transaction).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
  });

  it('scopes an explicit book before applying the per-source context limit', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([{
      id: 'source-1', title: 'Republic EPUB', type: 'epub',
      content: `${'unrelated front matter '.repeat(1500)}\nBOOK I.\nSocrates: I went down yesterday to the Piraeus.\n${'Book I discussion. '.repeat(1400)}\nBOOK II.\nGlaucon: I will begin with the nature of justice.`,
    }]);
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1'], message: 'In BOOK I of The Republic, explain the opening discussion of justice.' },
    });
    expect(result.status).toBe(200);
    expect(result.body.sectionScope).toEqual({ requestedSection: { kind: 'book', number: 1 }, matched: true });
    expect(result.body.sources[0].content).toContain('Socrates: I went down yesterday to the Piraeus.');
    expect(result.body.sources[0].content).not.toContain('unrelated front matter');
    expect(result.body.sources[0].content).not.toContain('BOOK II.');
    expect(result.body.sources[0].content.length).toBeLessThanOrEqual(18_000);
  });

  it('uses the audiobook source id to disambiguate identical chapter headings across books', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([
      { id: 'source-1', title: 'Other book', type: 'epub', content: 'BOOK I\nUnrelated argument from another book.' },
      { id: 'source-2', title: 'The Republic', type: 'epub', content: 'BOOK I\nSocrates discusses justice with Cephalus.' },
    ]);
    const message = withAudiobookReadingContext('What is discussed here?', {
      audiobookId: 'audio-1', sourceId: 'source-2', bookTitle: 'The Republic',
      chapterId: 'book-1', chapterIndex: 0, chapterCount: 1, chapterTitle: 'Book I',
      progressPercent: 40, isPlaying: false,
    });
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1', 'source-2'], message },
    });
    expect(result.status).toBe(200);
    expect(result.body.sectionScope).toEqual({ requestedSection: { kind: 'audio-chapter', title: 'Book I' }, matched: true });
    expect(result.body.sources.map(source => source.id)).toEqual(['source-2']);
    expect(result.body.sources[0].content).toContain('Socrates discusses justice with Cephalus.');
    expect(result.body.sources[0].content).not.toContain('Unrelated argument');
  });

  it('fails closed when the audiobook source conflicts with the explicitly selected sources', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([
      { id: 'source-1', title: 'Other book', type: 'epub', content: 'BOOK I\nUnrelated argument.' },
      { id: 'source-2', title: 'The Republic', type: 'epub', content: 'BOOK I\nSocrates discusses justice.' },
    ]);
    const message = withAudiobookReadingContext('What is discussed here?', {
      audiobookId: 'audio-1', sourceId: 'source-2', bookTitle: 'The Republic',
      chapterId: 'book-1', chapterIndex: 0, chapterCount: 1, chapterTitle: 'Book I',
      progressPercent: 40, isPlaying: false,
    });
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1'], message },
    });
    expect(result.status).toBe(200);
    expect(result.body.sectionScope.matched).toBe(false);
    expect(result.body.sources).toEqual([]);
  });

  it('selects late chapter evidence across sources within a shared budget and preserves citation order', async () => {
    const early = 'Opening material discusses unrelated themes and background.\n\n';
    const lateA = 'The rare moonstone principle explains why the evidence changes the judgment.';
    const lateB = 'A rare moonstone example confirms the evidence in a separate passage.';
    state.helpers.getSourcesByNotebookId.mockResolvedValue([
      { id: 'source-1', title: 'First book', type: 'epub', content: `CHAPTER III.\n${early.repeat(900)}${lateA}\nCHAPTER IV.\nWrong chapter evidence.` },
      { id: 'source-2', title: 'Second book', type: 'epub', content: `CHAPTER III.\n${early.repeat(900)}${lateB}\nCHAPTER IV.\nWrong chapter evidence.` },
    ]);
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1', 'source-2'], message: 'In Chapter III, explain the rare moonstone evidence.' },
    });
    expect(result.status).toBe(200);
    expect(result.body.sectionScope).toEqual({ requestedSection: { kind: 'chapter', number: 3 }, matched: true });
    expect(result.body.sources.map(source => source.id)).toEqual(['source-1', 'source-2']);
    expect(result.body.sources[0].content).toContain(lateA);
    expect(result.body.sources[1].content).toContain(lateB);
    expect(result.body.sources.every(source => !source.content.includes('Wrong chapter evidence'))).toBe(true);
    expect(result.body.sources.reduce((total, source) => total + source.content.length, 0)).toBeLessThanOrEqual(6_000);
  });

  it('uses only the exact titled section named by an audiobook Ask request', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([{
      id: 'source-1', title: 'The Republic', type: 'epub',
      content: 'INTRODUCTION ANALYSIS\nOpening material about the translator.\n\nTRANSCRIBER\nThe transcriber corrected several errors in the earlier edition.\nThe notes also restore missing names.\n\nAPPENDIX\nUnrelated appendix material.',
    }]);
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1'], message: 'What changes did the transcriber make to this edition? Answer briefly about this chapter, with a citation.\n\n[Audio listening context:\nBook: The Republic\nPosition: chapter "Transcriber", 0:02 into the chapter\nAnswer from this source and cite the relevant passage.\n]\n\n[Reader position: audio segment 2 of 2 “Transcriber” in “The Republic”; paused. This is navigation metadata, not source evidence.]' },
    });
    expect(result.status).toBe(200);
    expect(result.body.sectionScope).toEqual({ requestedSection: { kind: 'audio-chapter', title: 'Transcriber' }, matched: true });
    expect(result.body.sources[0].content).toContain('The transcriber corrected several errors');
    expect(result.body.sources[0].content).not.toContain('INTRODUCTION ANALYSIS');
    expect(result.body.sources[0].content).not.toContain('APPENDIX');
  });

  it('matches the Republic source heading for Persons of the Dialogue', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([{
      id: 'source-1', title: 'The Republic', type: 'pdf',
      content: 'INTRODUCTION ANALYSIS\nOpening material.\n\n--- BOOK I ---\n\nPERSONS OF THE DIALOGUE.\nSocrates, who is the narrator.\nGlaucon.\nAdeimantus.\nPolemarchus.\nCephalus.\nThrasymachus.\nCleitophon.\nAnd others who are mute auditors.\nThe scene is laid in the house of Cephalus at the Piraeus.\n\n--- BOOK II ---\nWrong chapter material.',
    }]);
    const message = withAudiobookReadingContext('Who are the people listed in this chapter?', {
      audiobookId: 'audio-1', sourceId: 'source-1', bookTitle: 'The Republic',
      chapterId: 'persons', chapterIndex: 0, chapterCount: 2, chapterTitle: 'Persons of the Dialogue',
      progressPercent: 8, isPlaying: false,
    });
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1'], message },
    });
    expect(result.status).toBe(200);
    expect(result.body.sectionScope).toEqual({ requestedSection: { kind: 'audio-chapter', title: 'Persons of the Dialogue' }, matched: true });
    expect(result.body.sources[0].content).toContain('Socrates, who is the narrator.');
    expect(result.body.sources[0].content).toContain('Glaucon.');
    expect(result.body.sources[0].content).not.toContain('INTRODUCTION ANALYSIS');
    expect(result.body.sources[0].content).not.toContain('Wrong chapter material');
  });

  it('skips the Gutenberg title-page duplicate before the actual Persons heading', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([{
      id: 'source-1', title: 'The Republic', type: 'ebook',
      content: 'The Idea of Good.\n\n--- PERSONS OF THE DIALOGUE. ---\n\nTHE REPUBLIC.\n\nPERSONS OF THE DIALOGUE.\n\nSocrates, who is the narrator.\nGlaucon.\nAdeimantus.\n\n--- BOOK I ---\nWrong chapter material.',
    }]);
    const message = withAudiobookReadingContext('Who are the people listed in this chapter?', {
      audiobookId: 'audio-1', sourceId: 'source-1', bookTitle: 'The Republic',
      chapterId: 'persons', chapterIndex: 0, chapterCount: 2, chapterTitle: 'PERSONS OF THE DIALOGUE',
      progressPercent: 8, isPlaying: false,
    });
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1'], message },
    });
    expect(result.status).toBe(200);
    expect(result.body.sectionScope).toEqual({ requestedSection: { kind: 'audio-chapter', title: 'PERSONS OF THE DIALOGUE' }, matched: true });
    expect(result.body.sources[0].content).toContain('Socrates, who is the narrator.');
    expect(result.body.sources[0].content).toContain('Glaucon.');
    expect(result.body.sources[0].content).not.toContain('The Idea of Good.');
    expect(result.body.sources[0].content).not.toContain('Wrong chapter material.');
  });

  it('matches audiobook chapter titles when apostrophe typography differs from the source heading', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([{
      id: 'source-1', title: 'The Republic', type: 'epub',
      content: 'INTRODUCTION ANALYSIS\nTranslator background.\n\n--- Transcriber’s Notes ---\n\nTranscriber’s Notes\nThe transcriber corrected several errors in this edition.\n\nAPPENDIX\nUnrelated material.',
    }]);
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1'], message: 'What changed in this edition?\n\n[Audio listening context:\nBook: The Republic\nPosition: chapter "Transcriber\'s Notes", 0:02 into the chapter\nAnswer from this source and cite the relevant passage.\n]' },
    });
    expect(result.status).toBe(200);
    expect(result.body.sectionScope).toEqual({ requestedSection: { kind: 'audio-chapter', title: "Transcriber's Notes" }, matched: true });
    expect(result.body.sources[0].content).toContain('The transcriber corrected several errors');
    expect(result.body.sources[0].content).not.toContain('INTRODUCTION ANALYSIS');
    expect(result.body.sources[0].content).not.toContain('APPENDIX');
  });

  it('keeps manual follow-ups scoped to the exact active audiobook section', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([{
      id: 'source-1', title: 'The Republic', type: 'epub',
      content: 'INTRODUCTION ANALYSIS\nBroad opening discussion.\n\n--- Transcriber’s Notes ---\n\nTranscriber’s Notes\nThe transcriber granted public-domain status to the new cover art.\n\nAPPENDIX\nUnrelated material.',
    }]);
    const title = 'Transcriber’s Notes';
    const message = withAudiobookReadingContext('What exactly do these notes say?', {
      audiobookId: 'audio-1', sourceId: 'source-1', bookTitle: 'The Republic',
      chapterId: 'notes', chapterIndex: 1, chapterCount: 2, chapterTitle: title,
      progressPercent: 24.6, isPlaying: false,
    });
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1'], message },
    });
    expect(result.status).toBe(200);
    expect(result.body.sectionScope).toEqual({ requestedSection: { kind: 'audio-chapter', title }, matched: true });
    expect(result.body.sources[0].content).toContain('The transcriber granted public-domain status');
    expect(result.body.sources[0].content).not.toContain('INTRODUCTION ANALYSIS');
    expect(result.body.sources[0].content).not.toContain('APPENDIX');
  });

  it('does not treat app metadata naming Chapter IV as a learner request for numbered Chapter IV', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([{
      id: 'source-1', title: 'The Republic', type: 'epub',
      content: 'CHAPTER IV\nWrong structural chapter.\n\nChapter IV: Transcriber’s Notes\nThe editor explains the transcription choices.\n\nAPPENDIX\nUnrelated material.',
    }]);
    const title = 'Chapter IV: Transcriber’s Notes';
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1'], message: `What does this section explain?\n\n[Reader position: audio segment 1 of 1 “reading section: Transcriber’s Notes” in “The Republic”; paused.\nAudiobook section title (encoded): ${encodeURIComponent(title)}\nThis is navigation metadata, not source evidence. Use only source text available in the notebook; do not invent excerpts or assume access to the exact passage.]` },
    });
    expect(result.status).toBe(200);
    expect(result.body.sectionScope).toEqual({ requestedSection: { kind: 'audio-chapter', title }, matched: true });
    expect(result.body.sources[0].content).toContain('The editor explains the transcription choices.');
    expect(result.body.sources[0].content).not.toContain('Wrong structural chapter');
  });

  it('fails closed when an audiobook chapter title has no exact heading in the selected source', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([{
      id: 'source-1', title: 'The Republic', type: 'epub', content: 'INTRODUCTION ANALYSIS\nOnly introductory material is available.',
    }]);
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1'], message: 'What changed?\n\n[Audio listening context:\nBook: The Republic\nPosition: chapter "Transcriber", 0:02 into the chapter\nAnswer from this source and cite the relevant passage.\n]' },
    });
    expect(result.status).toBe(200);
    expect(result.body.sectionScope).toEqual({ requestedSection: { kind: 'audio-chapter', title: 'Transcriber' }, matched: false });
    expect(result.body.sources[0].content).toBe('');
  });

  it('fails closed when a chapter title occurs in multiple separate source sections', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([{
      id: 'source-1', title: 'Book', type: 'ebook',
      content: 'Transcriber’s Notes\nFirst note.\n\nOther section.\n\nTranscriber’s Notes\nSecond note.',
    }]);
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1'], message: 'Question\n\n[Audio listening context:\nPosition: chapter "Transcriber’s Notes", 0:02 into the chapter\n]' },
    });
    expect(result.status).toBe(200);
    expect(result.body.sectionScope).toEqual({ requestedSection: { kind: 'audio-chapter', title: 'Transcriber’s Notes' }, matched: false });
    expect(result.body.sources[0].content).toBe('');
  });

  it('keeps the final source word whole when local context reaches its character limit', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([{
      id: 'source-1', title: 'Long source', type: 'text', content: 'wordfragment '.repeat(2_000),
    }]);
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1'] },
    });
    expect(result.status).toBe(200);
    expect(result.body.sources[0].content.length).toBeLessThanOrEqual(18_000);
    expect(result.body.sources[0].content).toMatch(/wordfragment$/);
  });

  it('fails closed when an explicit requested book is absent from selected sources', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([{
      id: 'source-1', title: 'Republic outline', type: 'text', content: 'A general outline with no structural book headings.',
    }]);
    const result = await dispatch({
      url: '/book/local-chat/context', token: session(),
      body: { sourceIds: ['source-1'], message: 'Explain Book I of The Republic.' },
    });
    expect(result.status).toBe(200);
    expect(result.body.sectionScope).toEqual({ requestedSection: { kind: 'book', number: 1 }, matched: false });
    expect(result.body.sources).toEqual([{ id: 'source-1', title: 'Republic outline', type: 'text', content: '' }]);
  });

  it.each([
    ['unsupported marker', 'Claim [99].', [{ citationId: 99, sourceId: 'source-1' }]],
    ['unmapped marker', 'Claim [1].', []],
    ['unused mapping', 'Claim without a citation.', [{ citationId: 1, sourceId: 'source-1' }]],
    ['duplicate mapping', 'Claim [1].', [{ citationId: 1, sourceId: 'source-1' }, { citationId: 1, sourceId: 'source-1' }]],
  ])('rejects %s without writing a partial turn', async (_label, answer, citationMap) => {
    const result = await dispatch({ url: '/book/local-chat/turn', token: session(), body: {
      turnId: '11111111-1111-4111-8111-111111111111', question: 'Explain this', answer, sourceIds: ['source-1'], citationMap,
    } });
    expect(result.status).toBe(400);
    expect(state.transaction).not.toHaveBeenCalled();
    expect(state.inserts).toHaveLength(0);
  });

  it('replays one committed pair when the first response is lost', async () => {
    const body = {
      turnId: '22222222-2222-4222-8222-222222222222', question: 'Explain this', answer: 'It was observed [1].',
      sourceIds: ['source-1'], citationMap: [{ citationId: 1, sourceId: 'source-1' }],
    };
    // Model a server commit whose response never reaches the browser: discard the
    // first HTTP result, then retry the exact retained request identity and payload.
    await dispatch({ url: '/book/local-chat/turn', token: session(), body });
    expect(state.inserts).toHaveLength(2);
    const retry = await dispatch({ url: '/book/local-chat/turn', token: session(), body });
    expect(retry.status).toBe(200);
    expect(retry.body.messages).toHaveLength(2);
    expect(retry.body.messages.map((row) => row.role)).toEqual(['user', 'assistant']);
    expect(new Date(retry.body.messages[0].createdAt).getTime()).toBeLessThan(new Date(retry.body.messages[1].createdAt).getTime());
    expect(state.transaction).toHaveBeenCalledOnce();
    expect(state.inserts).toHaveLength(2);
  });

  it('rejects replay when the selected source set changes under the same turn identity', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([
      { id: 'source-1', title: 'First source', type: 'text', content: 'First content' },
      { id: 'source-2', title: 'Second source', type: 'text', content: 'Second content' },
    ]);
    const body = {
      turnId: '33333333-3333-4333-8333-333333333333', question: 'Explain this', answer: 'The same answer.',
      citationMap: [],
    };
    await dispatch({ url: '/book/local-chat/turn', token: session(), body: { ...body, sourceIds: ['source-1'] } });
    expect(JSON.parse(state.inserts[1].groundedSources).sourceIds).toEqual(['source-1']);

    const replay = await dispatch({ url: '/book/local-chat/turn', token: session(), body: { ...body, sourceIds: ['source-2'] } });
    expect(replay).toEqual({ status: 409, body: { error: 'This turnId was already used for a different local chat turn' } });
    expect(state.transaction).toHaveBeenCalledOnce();
    expect(state.inserts).toHaveLength(2);
  });

  it('normalizes source selection order for an otherwise exact replay', async () => {
    state.helpers.getSourcesByNotebookId.mockResolvedValue([
      { id: 'source-1', title: 'First source', type: 'text', content: 'First content' },
      { id: 'source-2', title: 'Second source', type: 'text', content: 'Second content' },
    ]);
    const body = {
      turnId: '44444444-4444-4444-8444-444444444444', question: 'Explain this', answer: 'The same answer.',
      citationMap: [],
    };
    await dispatch({ url: '/book/local-chat/turn', token: session(), body: { ...body, sourceIds: ['source-2', 'source-1'] } });
    expect(JSON.parse(state.inserts[1].groundedSources).sourceIds).toEqual(['source-1', 'source-2']);
    const replay = await dispatch({ url: '/book/local-chat/turn', token: session(), body: { ...body, sourceIds: ['source-1', 'source-2'] } });
    expect(replay.status).toBe(200);
    expect(state.transaction).toHaveBeenCalledOnce();
    expect(state.inserts).toHaveLength(2);
  });

  it('does not expose another notebook or silently truncate oversized selected context', async () => {
    state.helpers.getNotebookById.mockResolvedValueOnce(null);
    expect(await dispatch({ url: '/foreign/local-chat/context', token: session(), body: {} })).toEqual({ status: 404, body: { error: 'Notebook not found' } });
    const oversized = Array.from({ length: 31 }, (_, i) => `source-${i}`);
    expect((await dispatch({ url: '/book/local-chat/context', token: session(), body: { sourceIds: oversized } })).status).toBe(400);
  });
});
