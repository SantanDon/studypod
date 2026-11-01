import { type ReactElement, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateAIResponse, validateCitations } from '@/lib/extraction/contentValidator';
import { buildLocalConversation, isPracticeContext, isPracticeRequest, localLearningSystemPrompt } from '@/lib/chat/localLearningGuidance';
import type { EnhancedChatMessage } from '@/types/message';

const mocks = vi.hoisted(() => ({ toast: vi.fn(), send: vi.fn(), getMessages: vi.fn(), localContext: vi.fn(), saveLocalTurn: vi.fn(), localCompletion: vi.fn(), localEnabled: false }));
vi.mock('@/hooks/useAuthState', () => ({ useAuthState: () => ({ user: { id: 'qa-owner' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { access_token: 'test-session' } }) }));
vi.mock('@/hooks/useGuest', () => ({ useGuest: () => ({ guestId: undefined }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/services/apiService', () => ({ ApiService: { sendChatMessage: mocks.send, getChatMessages: mocks.getMessages, getLocalChatContext: mocks.localContext, saveLocalChatTurn: mocks.saveLocalTurn } }));
vi.mock('@/services/chatAiService', () => ({ generateAIResponse: vi.fn() }));
vi.mock('@/lib/extraction/contentValidator', () => ({ validateCitations: vi.fn(), validateAIResponse: vi.fn() }));
vi.mock('@/config/ollamaConfig', () => ({ isOllamaEnabled: () => mocks.localEnabled }));
vi.mock('@/config/localModelConfig', () => ({ getLocalModelSettings: () => ({ model: 'test-local-model' }), isCompatibleLocalModelSelected: () => false }));
vi.mock('@/lib/ai/ollamaService', () => ({ chatCompletion: mocks.localCompletion }));
import { useChatMessages } from '@/hooks/useChatMessages';

const clients: QueryClient[] = [];
const draft = { notebookId: 'owned-notebook', content: 'Explain the experiment', sourceIds: ['owned-source'], responseStyle: 'dense' as const };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useChatMessages(draft.notebookId), { wrapper });
}
function failure(status: number, code: string | undefined, message: string) {
  return Object.assign(new Error(message), { status, code });
}
beforeEach(() => {
  mocks.localEnabled = false;
  mocks.toast.mockReset();
  mocks.send.mockReset();
  mocks.localContext.mockReset();
  mocks.saveLocalTurn.mockReset();
  mocks.localCompletion.mockReset();
  vi.mocked(validateCitations).mockReset().mockResolvedValue({ isValid: true, issues: [], verifiedCitations: [], confidenceScore: 1 });
  vi.mocked(validateAIResponse).mockReset().mockResolvedValue({ isGrounded: true, hallucinationRisk: 'low', issues: [], confidenceScore: 1 });
  mocks.getMessages.mockReset().mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });

describe('signed-in chat failure and retry', () => {
  it('recognizes tutoring requests without turning discussion of practice into a quiz', () => {
    expect(isPracticeRequest('Help me practise the main idea from these sources. Ask one question at a time.')).toBe(true);
    expect(isPracticeRequest('Quiz me on the main idea.')).toBe(true);
    expect(isPracticeRequest('Explain how practice questions help memory.')).toBe(false);
  });

  it('keeps practice guidance for a recheck after a practice question', () => {
    const history: EnhancedChatMessage[] = [
      { id: 'practice-prompt', message: { type: 'human', content: 'Help me practise the main idea. Ask one question at a time.' } },
      { id: 'practice-question', message: { type: 'ai', content: 'What is the central claim? [1]' } },
      { id: 'practice-attempt', message: { type: 'human', content: 'It is about repeated results.' } },
      { id: 'practice-feedback', message: { type: 'ai', content: 'The source says they repeated twice [1].' } },
    ];
    expect(isPracticeContext(history, 'Please recheck my answer and do not give me another quiz.')).toBe(true);
    expect(isPracticeContext([], 'Explain how practice questions help memory.')).toBe(false);
  });

  it('builds natural practice guidance that withholds the answer until an attempt', () => {
    const prompt = localLearningSystemPrompt('[1] Notes\nThe finding was repeated twice.', true);
    expect(prompt).toContain('Practice is context, not an instruction to quiz on every turn');
    expect(prompt).toContain('when it explicitly requests a new practice or comprehension question');
    expect(prompt).toContain('If the latest message is an attempt, recheck, clarification, correction request, or says not to quiz, respond to that request directly and stop without adding any question');
    expect(prompt).not.toContain('The learner requested practice. Ask exactly one');
    expect(prompt).toContain('Test one learning objective with one requested answer');
    expect(prompt).toContain('Follow the learner’s latest message first');
    expect(prompt).toContain('If the latest message is an attempt, recheck, clarification, correction request');
    expect(prompt).toContain('do not introduce unrelated topics from prior turns');
    expect(prompt).toContain('After an attempt, do not automatically ask another quiz question');
    expect(prompt).toContain('Cite the source beside each correction or supported claim');
    expect(prompt).toContain('Do not append a quiz or next question unless the learner’s latest message explicitly asks for one');
    expect(prompt).toContain('For an attempted answer, respond concisely to the answer the learner actually gave');
    expect(prompt).toContain('Verify both the question’s premise and the learner’s answer against the selected source text');
    expect(prompt).toContain('Correct only a specific point the selected text contradicts');
    expect(prompt).toContain('acknowledge that you cannot verify it from the available passage');
    expect(prompt).toContain('do not supply a guessed or remembered alternative answer');
    expect(prompt).toContain('do not invent an exchange, example, concession, or progression the source does not show');
    expect(prompt).toContain('Avoid canned preambles, rigid headings');
    expect(prompt).not.toContain('Explore next:');
  });

  it('includes recent learner attempts in order when generating a local practice turn', async () => {
    mocks.localEnabled = true;
    mocks.getMessages.mockResolvedValue([
      { id: 'question', role: 'assistant', content: 'What evidence supports the finding?' },
      { id: 'attempt', role: 'user', content: 'It was repeated twice [1].' },
    ]);
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [
      { id: 'owned-source', title: 'Lab notes', type: 'text', content: 'The finding was repeated twice.' },
    ] });
    mocks.localCompletion.mockResolvedValue('You identified the repeated finding [1]. What does repetition suggest here?');
    const view = setup();
    await waitFor(() => expect(mocks.getMessages).toHaveBeenCalled());
    await waitFor(() => expect(view.result.current.messages).toHaveLength(2));
    const practice = { ...draft, content: 'Help me practise the main idea. Ask one question at a time and wait for my answer before revealing the answer.' };
    await act(async () => { await view.result.current.sendMessageAsync(practice); });
    const sent = mocks.localCompletion.mock.calls[0][0].messages;
    expect(sent.map((message: { role: string }) => message.role)).toEqual(['system', 'assistant', 'user', 'user']);
    expect(sent[1].content).toBe('What evidence supports the finding?');
    expect(sent[2].content).toBe('It was repeated twice [1].');
    expect(sent[0].content).toContain('Follow the learner’s latest message first');
    expect(sent[0].content).toContain('do not introduce unrelated topics from prior turns');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('reuses an explicit chapter scope for one immediate practice answer, then drops it on an unrelated turn', async () => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sectionScope: { matched: true }, sources: [
      { id: 'owned-source', title: 'Republic Book I', type: 'text', content: 'Cephalus says wealth helps a person avoid deceiving others and leaving unpaid debts.' },
    ] });
    mocks.localCompletion
      .mockResolvedValueOnce('How does Cephalus connect wealth with justice? [1]')
      .mockResolvedValueOnce('Your answer captures Cephalus’s point about avoiding unpaid debts [1].')
      .mockResolvedValueOnce('Aristotle discusses virtue as a habit.');
    const view = setup();
    const chapterQuestion = { ...draft, content: 'In Book I of the Republic, quiz me on Cephalus’s view of wealth.' };

    await act(async () => { await view.result.current.sendMessageAsync(chapterQuestion); });
    const learnerAnswer = { ...draft, content: 'My answer: wealth helps avoid deceiving others and unpaid debts; check source.' };
    await act(async () => { await view.result.current.sendMessageAsync(learnerAnswer); });

    expect(mocks.localContext.mock.calls[0][3]).toBe(chapterQuestion.content);
    expect(mocks.localContext.mock.calls[1]).toEqual([
      draft.notebookId, ['owned-source'], 'test-session', chapterQuestion.content,
    ]);
    const followupMessages = mocks.localCompletion.mock.calls[1][0].messages;
    expect(followupMessages.map((message: { role: string }) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(followupMessages[0].content).toContain('Cephalus says wealth helps a person avoid deceiving others');
    expect(followupMessages[2].content).toBe('How does Cephalus connect wealth with justice? [1]');
    expect(followupMessages[3].content).toBe(learnerAnswer.content);
    expect(mocks.saveLocalTurn.mock.calls[1][1].question).toBe(learnerAnswer.content);
    expect(mocks.saveLocalTurn.mock.calls[1][1].citationMap).toEqual([{
      citationId: 1,
      sourceId: 'owned-source',
      excerpt: 'Cephalus says wealth helps a person avoid deceiving others and leaving unpaid debts.',
    }]);

    const unrelated = { ...draft, content: 'Explain Aristotle’s account of virtue.' };
    await act(async () => { await view.result.current.sendMessageAsync(unrelated); });
    expect(mocks.localContext.mock.calls[2][3]).toBe(unrelated.content);
  });

  it('rejects a one-character local completion before saving it', async () => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [] });
    mocks.localCompletion.mockResolvedValue('T');
    const view = setup();
    await act(async () => {
      await expect(view.result.current.sendMessageAsync(draft)).rejects.toThrow('incomplete answer; no message was saved');
    });
    expect(mocks.saveLocalTurn).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('uses authenticated notebook context, local-only inference, and durable turn persistence when opted in', async () => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [
      { id: 'owned-source', title: 'Lab notes', type: 'text', content: 'The sample was heated to 80 C.' },
      { id: 'other-source', title: 'Other notes', type: 'text', content: 'The control was cooled.' },
    ] });
    mocks.localCompletion.mockResolvedValue('The control was cooled [2].');
    vi.mocked(validateCitations).mockResolvedValue({ isValid: true, issues: [], verifiedCitations: [{ citation: '[2]', sourceId: 'other-source', found: true }], confidenceScore: 1 });
    mocks.saveLocalTurn.mockResolvedValue({ answer: 'The control was cooled [2].', messages: [] });
    const view = setup();
    await act(async () => {
      await expect(view.result.current.sendMessageAsync(draft)).resolves.toMatchObject({ response: 'The control was cooled [2].' });
    });
    expect(mocks.localContext).toHaveBeenCalledWith(draft.notebookId, ['owned-source'], 'test-session', draft.content);
    expect(mocks.localCompletion).toHaveBeenCalledWith(expect.objectContaining({ localOnly: true, messages: expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('The sample was heated to 80 C.') })]) }));
    expect(mocks.saveLocalTurn).toHaveBeenCalledWith(draft.notebookId, expect.objectContaining({ question: draft.content, answer: 'The control was cooled [2].', sourceIds: ['owned-source', 'other-source'], citationMap: [{ citationId: 2, sourceId: 'other-source', excerpt: 'The control was cooled.' }] }), 'test-session');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('maps a quoted Book I citation to the matching chapter passage instead of front matter', async () => {
    mocks.localEnabled = true;
    const chapterPassage = 'Cephalus says wealth helps a person avoid deceiving others and leaving unpaid debts.';
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sectionScope: { matched: true }, sources: [{
      id: 'republic', title: 'The Republic', type: 'text',
      content: `INTRODUCTION AND ANALYSIS\n${'This introduction discusses justice and the structure of the book. '.repeat(2)}\nBOOK I\n${chapterPassage}`,
    }] });
    mocks.localCompletion.mockResolvedValue(`Cephalus says, “${chapterPassage.slice('Cephalus says '.length)}” [1]`);
    const view = setup();
    await act(async () => { await view.result.current.sendMessageAsync({
      ...draft, content: 'In Book I, explain Cephalus’s point and cite the passage.',
    }); });

    expect(mocks.saveLocalTurn.mock.calls[0][1].citationMap).toEqual([{
      citationId: 1, sourceId: 'republic', excerpt: chapterPassage,
    }]);
  });

  it.each(['VI', 'VII', 'VIII', 'IX', 'X'])('keeps a quoted Book %s citation inside its Roman-numbered section', async (book) => {
    mocks.localEnabled = true;
    const passage = `Book ${book} studies the limits of knowledge and education.`;
    const nextBook = book === 'X' ? 'XI' : 'X';
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sectionScope: { matched: true }, sources: [{
      id: 'republic', title: 'The Republic', type: 'text',
      content: `BOOK V\nA neighboring book discusses justice and education.\nBOOK ${book}\n${passage}\nBOOK ${nextBook}\nThe next book discusses another argument.`,
    }] });
    mocks.localCompletion.mockResolvedValue(`The relevant passage says, “${passage}” [1]`);
    const view = setup();
    await act(async () => { await view.result.current.sendMessageAsync({
      ...draft, content: `In Book ${book}, explain its topic and cite the passage.`,
    }); });

    expect(mocks.saveLocalTurn.mock.calls[0][1].citationMap).toEqual([{
      citationId: 1, sourceId: 'republic', excerpt: passage,
    }]);
  });

  it('matches an exact multi-sentence citation across PDF line wrapping', async () => {
    mocks.localEnabled = true;
    const wrappedQuote = 'Socrates says that the good man is not permitted to harm anyone. He adds that harming makes people worse.';
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [{
      id: 'republic', title: 'The Republic', type: 'text',
      content: `INTRODUCTION\n${'Justice and harm are discussed in the introduction. '.repeat(2)}\nBOOK I\nSocrates says that the good man is not permitted to harm anyone.\nHe adds that harming makes people worse.`,
    }] });
    mocks.localCompletion.mockResolvedValue(`Socrates explains, “${wrappedQuote}” [1]`);
    const view = setup();
    await act(async () => { await view.result.current.sendMessageAsync({
      ...draft, content: 'In Book I, explain why Socrates questions harming enemies and cite the passage.',
    }); });

    expect(mocks.saveLocalTurn.mock.calls[0][1].citationMap).toEqual([{
      citationId: 1, sourceId: 'republic', excerpt: wrappedQuote.replace('anyone. He', 'anyone.\nHe'),
    }]);
  });

  it('matches an exact quoted passage when the model changes punctuation', async () => {
    mocks.localEnabled = true;
    const sourceQuote = 'Then according to your argument, it is just to injure those who do no wrong?';
    const modelQuote = 'Then according to your argument it is just to injure those who do no wrong?';
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [{
      id: 'republic', title: 'The Republic', type: 'text', content: `BOOK I\n${sourceQuote}\nNay, Socrates; the doctrine is immoral.`,
    }] });
    mocks.localCompletion.mockResolvedValue(`“${modelQuote}”\n“Nay, Socrates; the doctrine is immoral.” [1]`);
    const view = setup();
    await act(async () => { await view.result.current.sendMessageAsync({
      ...draft, content: 'In Book I, why question harming enemies? Explain briefly and cite the passage.',
    }); });

    expect(mocks.saveLocalTurn.mock.calls[0][1].citationMap).toEqual([{
      citationId: 1, sourceId: 'republic', excerpt: sourceQuote,
    }]);
  });

  it('does not persist a citation when its claim has only weak or ambiguous overlap with the source', async () => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [{
      id: 'republic', title: 'The Republic', type: 'text',
      content: 'INTRODUCTION AND ANALYSIS discusses justice and virtue in the work.\nBOOK I\nThe opening conversation tests competing definitions of justice.',
    }] });
    mocks.localCompletion.mockResolvedValue('The book discusses justice and virtue [1].');
    const view = setup();
    await act(async () => {
      await expect(view.result.current.sendMessageAsync({ ...draft, content: 'In Book I, explain the book discusses justice and virtue [1].' })).rejects.toThrow('could not be matched to a strong passage');
    });
    expect(mocks.saveLocalTurn).not.toHaveBeenCalled();
  });

  it('matches inflected paraphrase terms to the supporting contiguous Republic passage', async () => {
    mocks.localEnabled = true;
    const passage = 'And he does not harm anyone, either friend or enemy? Certainly not. Can the just by justice make men unjust?';
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [{
      id: 'republic', title: 'The Republic', type: 'text', content: `BOOK I\n${passage}`,
    }] });
    const answer = 'Socrates argues harming anyone makes them less virtuous, whereas justice cannot produce injustice [1].';
    mocks.localCompletion.mockResolvedValue(answer);
    const view = setup();

    await act(async () => { await view.result.current.sendMessageAsync({
      ...draft, content: 'In Book I, in two sentences, why does Socrates reject harming enemies? Cite the source.',
    }); });

    expect(mocks.localCompletion).toHaveBeenCalledTimes(1);
    expect(mocks.saveLocalTurn.mock.calls[0][1].answer).toBe(answer);
    expect(mocks.saveLocalTurn.mock.calls[0][1].citationMap).toEqual([{
      citationId: 1, sourceId: 'republic', excerpt: passage,
    }]);
  });

  it('keeps original line breaks in paraphrase excerpts sent for persistence', async () => {
    mocks.localEnabled = true;
    const passage = 'Socrates says justice cannot make people unjust.\nHe therefore rejects harming anyone, even an enemy.';
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [{
      id: 'republic', title: 'The Republic', type: 'text', content: `BOOK I\n${passage}`,
    }] });
    mocks.localCompletion.mockResolvedValue('Socrates rejects harming enemies because justice cannot make people unjust [1].');
    const view = setup();

    await act(async () => { await view.result.current.sendMessageAsync({
      ...draft, content: 'In Book I, why does Socrates reject harming enemies? Cite the source.',
    }); });

    expect(mocks.saveLocalTurn.mock.calls[0][1].citationMap).toEqual([{
      citationId: 1, sourceId: 'republic', excerpt: passage,
    }]);
  });

  it('rejects unverified local citations before persistence and never falls back to cloud', async () => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [{ id: 'owned-source', title: 'Lab notes', type: 'text', content: 'The sample was heated.' }] });
    mocks.localCompletion.mockResolvedValue('The sample was heated [99].');
    vi.mocked(validateCitations).mockResolvedValue({ isValid: false, issues: ['Citation "[99]" does not match any available source'], verifiedCitations: [{ citation: '[99]', sourceId: '', found: false }], confidenceScore: 0 });
    const view = setup();
    await act(async () => {
      await expect(view.result.current.sendMessageAsync(draft)).rejects.toThrow('cannot be matched to the selected sources');
    });
    expect(mocks.saveLocalTurn).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('repairs one unverified memorable quote and persists only the exact cited repair', async () => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [
      { id: 'owned-source', title: 'Republic Book I', type: 'text', content: `${'Socrates describes the journey back from Piraeus and the people who joined him. '.repeat(12)}The opening exchange asks what justice is and tests definitions offered by Cephalus.` },
    ] });
    mocks.localCompletion.mockResolvedValueOnce('“Justice is whatever Cephalus says” [1]')
      .mockResolvedValueOnce('“The opening exchange asks what justice is and tests definitions offered by Cephalus.” [1] What makes this a test of a definition?');
    const quoteRequest = { ...draft, content: 'In Book I of the Republic, find a memorable exact quote about justice from this chapter, explain it briefly, and end with one check-your-understanding question.' };
    const view = setup();

    await act(async () => {
      await expect(view.result.current.sendMessageAsync(quoteRequest)).resolves.toMatchObject({
        response: '“The opening exchange asks what justice is and tests definitions offered by Cephalus.” [1] What makes this a test of a definition?',
      });
    });

    expect(mocks.localCompletion).toHaveBeenCalledTimes(2);
    expect(mocks.localCompletion.mock.calls.every(([request]) => request.localOnly)).toBe(true);
    expect(mocks.localCompletion.mock.calls[1][0].messages.at(-1).content).toContain('Answer my original request again');
    expect(mocks.localCompletion.mock.calls[1][0].messages.at(-1).content).toContain('Preserve any check-your-understanding question explicitly requested');
    expect(mocks.localCompletion.mock.calls[1][0].messages.at(-1).content).toContain('[1] The opening exchange asks what justice is and tests definitions offered by Cephalus.');
    expect(mocks.localCompletion.mock.calls[1][0].messages.at(-1).content).not.toContain('Socrates describes the journey back from Piraeus');
    expect(mocks.localCompletion.mock.calls[1][0].messages.at(-1).content).toContain('do not add a question if I did not ask for one');
    expect(mocks.localCompletion.mock.calls[1][0].messages.some((message) => message.content.includes('Observation unlocks every secret of nature'))).toBe(false);
    expect(mocks.saveLocalTurn).toHaveBeenCalledOnce();
    expect(mocks.saveLocalTurn.mock.calls[0][1].answer).toBe('“The opening exchange asks what justice is and tests definitions offered by Cephalus.” [1] What makes this a test of a definition?');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('repairs a missing requested citation using relevant source evidence and keeps the learning question', async () => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [
      { id: 'owned-source', title: 'Republic Book I', type: 'text', content: 'Cephalus says justice means speaking the truth and repaying what one has borrowed.' },
    ] });
    mocks.localCompletion.mockResolvedValueOnce('Cephalus offers a definition of justice as telling the truth and repaying debts. What might make that definition incomplete?')
      .mockResolvedValueOnce('Cephalus defines justice as telling the truth and repaying debts [1]. What might make that definition incomplete?');
    const citationRequest = { ...draft, content: 'In Book I, explain Cephalus’s definition of justice from this source and cite the relevant passage. End with one question for me.' };
    const view = setup();

    await act(async () => {
      await expect(view.result.current.sendMessageAsync(citationRequest)).resolves.toMatchObject({
        response: 'Cephalus defines justice as telling the truth and repaying debts [1]. What might make that definition incomplete?',
      });
    });

    expect(mocks.localCompletion).toHaveBeenCalledTimes(2);
    expect(mocks.localCompletion.mock.calls.every(([request]) => request.localOnly)).toBe(true);
    expect(mocks.localCompletion.mock.calls[1][0].messages.at(-1).content).toContain('explicit request for a source citation');
    expect(mocks.localCompletion.mock.calls[1][0].messages.at(-1).content).toContain('[1] Cephalus says justice means speaking the truth and repaying what one has borrowed.');
    expect(mocks.localCompletion.mock.calls[1][0].messages.at(-1).content).toContain('preserve any learning question I explicitly requested');
    expect(mocks.saveLocalTurn).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('does not save a factual answer when citation repair fails', async () => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [
      { id: 'owned-source', title: 'Republic Book I', type: 'text', content: 'Cephalus says justice means speaking the truth and repaying what one has borrowed.' },
    ] });
    mocks.localCompletion.mockResolvedValueOnce('Cephalus gives a definition of justice. What do you think?')
      .mockResolvedValueOnce('Cephalus gives a definition of justice. What do you think?');
    const view = setup();

    await act(async () => {
      await expect(view.result.current.sendMessageAsync({ ...draft, content: 'Explain justice and cite the relevant passage.' }))
        .rejects.toThrow('could not add a source-supported citation');
    });

    expect(mocks.localCompletion).toHaveBeenCalledTimes(2);
    expect(mocks.saveLocalTurn).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('rejects a fabricated quote introduced by citation repair', async () => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [
      { id: 'owned-source', title: 'Republic Book I', type: 'text', content: 'Cephalus says justice means speaking the truth and repaying what one has borrowed.' },
    ] });
    mocks.localCompletion.mockResolvedValueOnce('The source supports this point [1].')
      .mockResolvedValueOnce('Cephalus says, “justice means obeying every command without question” [1].');
    const view = setup();

    await act(async () => {
      await expect(view.result.current.sendMessageAsync({ ...draft, content: 'Explain Cephalus’s view and cite the relevant passage.' }))
        .rejects.toThrow('quote that could not be verified');
    });

    expect(mocks.localCompletion).toHaveBeenCalledTimes(2);
    expect(mocks.saveLocalTurn).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('rejects a fabricated quote after the single repair attempt without saving or calling cloud', async () => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [
      { id: 'owned-source', title: 'Lab notes', type: 'text', content: 'Careful observation is the beginning of reliable knowledge.' },
    ] });
    mocks.localCompletion.mockResolvedValue('“Observation unlocks every secret of nature” [1]');
    const quoteRequest = { ...draft, content: 'Find a memorable exact quote from these notes.' };
    const view = setup();

    await act(async () => {
      await expect(view.result.current.sendMessageAsync(quoteRequest)).rejects.toThrow('could not verify an exact quote');
    });

    expect(mocks.localCompletion).toHaveBeenCalledTimes(2);
    expect(mocks.localCompletion.mock.calls.every(([request]) => request.localOnly)).toBe(true);
    expect(mocks.saveLocalTurn).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('persists an explicit uncertainty note when source text cannot support verification', async () => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [] });
    mocks.localCompletion.mockResolvedValue('The answer is 42.');
    const view = setup();
    await act(async () => { await view.result.current.sendMessageAsync(draft); });
    expect(mocks.saveLocalTurn.mock.calls[0][1].answer).toContain('do not provide enough material to verify');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('does not generate an unsaved local answer for save-as-note requests', async () => {
    mocks.localEnabled = true;
    const view = setup();
    await act(async () => {
      await expect(view.result.current.sendMessageAsync({ ...draft, saveAsNote: true })).rejects.toThrow('Save as note is not supported for local chat yet.');
    });
    expect(mocks.localContext).not.toHaveBeenCalled();
    expect(mocks.localCompletion).not.toHaveBeenCalled();
    expect(mocks.saveLocalTurn).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each(['inference', 'persistence'])('does not fall back to cloud chat when local %s fails', async (failureStage) => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [] });
    if (failureStage === 'inference') mocks.localCompletion.mockRejectedValue(new Error('Local inference failed'));
    else {
      mocks.localCompletion.mockResolvedValue('A local answer.');
      mocks.saveLocalTurn.mockRejectedValue(new Error('Local turn persistence failed'));
    }
    const view = setup();
    await act(async () => {
      await expect(view.result.current.sendMessageAsync(draft)).rejects.toThrow(failureStage === 'inference' ? 'Local inference failed' : 'Local turn persistence failed');
    });
    expect(mocks.localCompletion).toHaveBeenCalledOnce();
    expect(mocks.saveLocalTurn).toHaveBeenCalledTimes(failureStage === 'inference' ? 0 : 1);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('logs safe local generation diagnostics and preserves the original failure', async () => {
    mocks.localEnabled = true;
    const originalError = new Error('Local inference failed');
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [{
      id: 'private-source', title: 'Private notes', type: 'text', content: 'PRIVATE SOURCE CONTENT',
    }] });
    mocks.localCompletion.mockRejectedValue(originalError);
    const view = setup();

    await act(async () => {
      await expect(view.result.current.sendMessageAsync({ ...draft, content: 'PRIVATE QUESTION TEXT' })).rejects.toBe(originalError);
    });

    const diagnostic = vi.mocked(console.error).mock.calls.find(([message]) => message === 'Local chat stage failed');
    expect(diagnostic?.[1]).toMatchObject({
      stage: 'generation',
      elapsedMs: expect.any(Number),
      completedStageMs: { context: expect.any(Number) },
      model: 'test-local-model',
      promptChars: expect.any(Number),
    });
    const diagnosticText = JSON.stringify(diagnostic?.[1]);
    expect(diagnosticText).not.toContain('PRIVATE QUESTION TEXT');
    expect(diagnosticText).not.toContain('PRIVATE SOURCE CONTENT');
  });

  it('retries an uncertain local save with the same generated answer and request identity', async () => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [] });
    mocks.localCompletion.mockResolvedValue('A generated answer.');
    mocks.saveLocalTurn.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ answer: 'A generated answer.' });
    const view = setup();
    await act(async () => { await expect(view.result.current.sendMessageAsync(draft)).rejects.toThrow('Failed to fetch'); });
    const retryToast = mocks.toast.mock.calls.at(-1)![0];
    expect(retryToast.action).toBeDefined();
    await act(async () => { await view.result.current.sendMessageAsync(draft); });
    expect(mocks.localCompletion).toHaveBeenCalledOnce();
    expect(mocks.localContext).toHaveBeenCalledOnce();
    expect(mocks.saveLocalTurn).toHaveBeenCalledTimes(2);
    expect(mocks.saveLocalTurn.mock.calls[0][1]).toEqual(mocks.saveLocalTurn.mock.calls[1][1]);
    expect(mocks.saveLocalTurn.mock.calls[0][1]).toMatchObject({ question: draft.content, turnId: expect.any(String) });
    expect(mocks.saveLocalTurn.mock.calls[0][1].answer).toContain('A generated answer.');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('retries a rejected local transaction with the same generated payload and never regenerates', async () => {
    mocks.localEnabled = true;
    mocks.localContext.mockResolvedValue({ notebookId: draft.notebookId, sources: [] });
    mocks.localCompletion.mockResolvedValue('A retained answer from the first inference.');
    mocks.saveLocalTurn.mockRejectedValueOnce(failure(500, undefined, 'Local turn persistence failed'))
      .mockResolvedValueOnce({ answer: 'A retained answer from the first inference.' });
    const view = setup();

    await act(async () => {
      await expect(view.result.current.sendMessageAsync(draft)).rejects.toThrow('Local turn persistence failed');
    });
    await act(async () => { await view.result.current.sendMessageAsync(draft); });

    expect(mocks.localCompletion).toHaveBeenCalledOnce();
    expect(mocks.localContext).toHaveBeenCalledOnce();
    expect(mocks.saveLocalTurn).toHaveBeenCalledTimes(2);
    expect(mocks.saveLocalTurn.mock.calls[0][1]).toEqual(mocks.saveLocalTurn.mock.calls[1][1]);
    expect(mocks.saveLocalTurn.mock.calls[0][1]).toMatchObject({
      turnId: expect.any(String),
      answer: expect.stringContaining('A retained answer from the first inference.'),
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    [503, 'PROVIDER_UNAVAILABLE', 'AI providers are temporarily unavailable.', 'AI Temporarily Unavailable', true],
    [503, 'DATABASE_TEMPORARILY_UNAVAILABLE', 'The notebook database is temporarily unavailable.', 'Notebook Temporarily Unavailable', true],
    [503, 'OTHER_SERVICE_UNAVAILABLE', 'Another service is unavailable.', 'Temporarily Unavailable', true],
    [503, undefined, 'Service temporarily unavailable.', 'Temporarily Unavailable', true],
    [503, undefined, 'PROVIDER_UNAVAILABLE', 'AI Temporarily Unavailable', true],
    [500, undefined, 'Source 503 failed processing', 'Error', false],
  ])('classifies status %s and code %s without claiming an unrelated provider outage', async (status, code, message, title, retry) => {
    mocks.send.mockRejectedValue(failure(status, code, message));
    const view = setup();
    await act(async () => { await expect(view.result.current.sendMessageAsync(draft)).rejects.toThrow(message); });
    const toast = mocks.toast.mock.calls.at(-1)![0];
    expect(toast.title).toBe(title);
    expect(!!toast.action).toBe(retry);
    if (title !== 'AI Temporarily Unavailable') expect(toast.description).not.toContain('AI providers are currently unreachable');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('keeps offline guidance and retry when the network is disconnected', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mocks.send.mockRejectedValue(new TypeError('Failed to fetch'));
    const view = setup();
    await act(async () => { await expect(view.result.current.sendMessageAsync(draft)).rejects.toThrow('Failed to fetch'); });
    const toast = mocks.toast.mock.calls.at(-1)![0];
    expect(toast.title).toBe("You're Offline");
    expect(toast.description).toContain('Your draft is saved');
    expect(toast.action).toBeDefined();
  });

  it('retries the original long draft and selected sources after a database 503', async () => {
    const longDraft = { ...draft, content: 'Compare the evidence without omitting the final detail. '.repeat(1200) + 'Final detail: 17 blue trays.' };
    mocks.send.mockRejectedValueOnce(failure(503, 'DATABASE_TEMPORARILY_UNAVAILABLE', 'Database busy'))
      .mockResolvedValueOnce({ answer: 'The final detail is 17 blue trays.' });
    const view = setup();
    await act(async () => { await expect(view.result.current.sendMessageAsync(longDraft)).rejects.toThrow('Database busy'); });
    const toast = mocks.toast.mock.calls.at(-1)![0];
    expect(toast.title).toBe('Notebook Temporarily Unavailable');
    expect(toast.description).toContain('Your draft is still available');
    const retry = toast.action as ReactElement<{ onClick: () => void }>;
    act(() => retry.props.onClick());
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.result.current.isSending).toBe(false));
    expect(mocks.send.mock.calls[1]).toEqual(mocks.send.mock.calls[0]);
    expect(mocks.send.mock.calls[1][1]).toEqual({ message: longDraft.content, sourceIds: ['owned-source'], responseStyle: 'dense', saveAsNote: undefined });
  });
});
