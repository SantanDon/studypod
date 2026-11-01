import { describe, expect, it } from 'vitest';
import { isPracticeRequest, localLearningSystemPrompt } from '@/lib/chat/localLearningGuidance';

describe('local notebook practice intent', () => {
  it('recognizes a wrapped request for one practice question', () => {
    expect(isPracticeRequest("I'm listening ... My question: Ask me one practice question about the opening Book I discussion of justice. Only one question, cite the source, and do not reveal the answer. Answer from this source..."))
      .toBe(true);
  });

  it('recognizes a bounded exactly-one comprehension request', () => {
    expect(isPracticeRequest('Please ask me exactly one comprehension question about Book I.'))
      .toBe(true);
  });

  it('does not treat discussion of practice questions as a request to quiz', () => {
    expect(isPracticeRequest('Explain how practice questions help with studying.')).toBe(false);
    expect(isPracticeRequest('The teacher discussed one practice question from Book I.')).toBe(false);
  });
});

describe('local notebook quote guidance', () => {
  it('requires requested quotes to be exact, supported, and cited', () => {
    const sourceText = '[1] Lecture notes\nJustice is the virtue of the soul.';
    const prompt = localLearningSystemPrompt(sourceText, false);

    expect(prompt).toContain('When the learner asks for an exact or memorable quote');
    expect(prompt).toContain('copied verbatim from the provided source text');
    expect(prompt).toContain('cite its source number (for example, [1])');
    expect(prompt).toContain('briefly explain why it matters');
    expect(prompt).toContain('Do not require a heading or sentence that labels it as a quote');
    expect(prompt).toContain('Verify every quoted word against the provided text');
    expect(prompt).toContain('never supply remembered wording or a remembered location');
    expect(prompt).toContain('say that you cannot verify the exact wording');
    expect(prompt).toContain('clearly cited paraphrase only if the source supports it');
    expect(prompt).not.toContain('When useful, quote');
  });

  it('keeps quote and practice requests subject to latest-turn intent', () => {
    const prompt = localLearningSystemPrompt('[1] Source\nA short exact passage.', true);

    expect(prompt).toContain('Follow the learner’s latest message first');
    expect(prompt).toContain('Do not append a quiz or next question unless the learner’s latest message explicitly asks for one');
    expect(prompt).toContain('If the latest message is an attempt, recheck, clarification, correction request, or says not to quiz, respond to that request directly and stop without adding any question');
  });

  it('adds a scoped exact-sentence and no-follow-up override from the latest request', () => {
    const prompt = localLearningSystemPrompt('[1] Source\nA short passage.', true, "Explain active recall in exactly two sentences, and don't ask me any follow-up questions.");

    expect(prompt).toContain('The answer prose must contain exactly 2 sentences.');
    expect(prompt).toContain('Do not add a follow-up question, invitation, offer, or next step.');
    expect(prompt).toContain('This explicit request overrides general style and practice guidance');
    expect(prompt).toContain('Preserve the requested educational explanation and source citations within the stated format.');
  });

  it('does not apply an explicit presentation override to ordinary tutoring requests', () => {
    const prompt = localLearningSystemPrompt('[1] Source\nA short passage.', true, 'Explain active recall and quiz me on it.');

    expect(prompt).not.toContain('EXPLICIT PRESENTATION OVERRIDE FOR THIS RESPONSE');
    expect(prompt).toContain('make the entire response exactly one clear, source-grounded question and nothing else');
  });

  it('keeps an explicitly requested Book I comprehension question question-only and cited', () => {
    const prompt = localLearningSystemPrompt('[1] Republic, Book I\nSocrates challenges Polemarchus’ account of justice.', true, 'Ask exactly one comprehension question about Book I.');

    expect(prompt).toContain('make the entire response exactly one clear, source-grounded question and nothing else');
    expect(prompt).toContain('Do not preface it with an explanation, summary, or answer');
    expect(prompt).toContain('do not include an answer, worked solution, or revealing hint');
    expect(prompt).toContain('Add the supporting source-number citation to the question when available');
    expect(prompt).toContain('then stop and wait for the learner');
    expect(prompt).toContain('Cite the source beside each correction or supported claim');
  });

  it('treats cite-the-passage as a citation request, not permission to reveal a quiz answer', () => {
    const request = 'In Book I, ask one practice question about Cephalus and wealth. Cite the passage, withhold the answer, and wait for my attempt.';
    const prompt = localLearningSystemPrompt(
      '[1] Republic, Book I\nCephalus says wealth helps a just person avoid deceiving others and leaving debts unpaid.',
      true,
      request,
    );

    expect(isPracticeRequest(request)).toBe(true);
    expect(prompt).toContain('make the entire response exactly one clear, source-grounded question and nothing else');
    expect(prompt).toContain('citation means append the source number only');
    expect(prompt).toContain('do not quote a passage, explain the answer, or include text that reveals it');
    expect(prompt).toContain('even if general quote guidance would otherwise apply');
    expect(prompt).toContain('Add the supporting source-number citation to the question when available; then stop and wait for the learner');
  });

  it('keeps the observed Cephalus and Polemarchus quiz to one answerable task', () => {
    const prompt = localLearningSystemPrompt(
      '[1] Republic, Book I\nCephalus defines justice; Socrates challenges the account. Polemarchus responds with a different account.',
      true,
      'Ask one question: According to Cephalus, what is justice and how does Polemarchus react to it?',
    );

    expect(prompt).toContain('Test one learning objective with one requested answer');
    expect(prompt).toContain('do not combine separate tasks or ask for multiple details in one question, including with “and.”');
    expect(prompt).toContain('make the entire response exactly one clear, source-grounded question and nothing else');
  });

  it('uses the available chapter text for an implicit current-listening question without claiming timestamp access', () => {
    const source = '[1] Republic, Book I\nCephalus says wealth helps a just person avoid deceiving others and leaving debts unpaid.';
    const request = 'Ask me one practice question about what I’m listening to now. Cite the source, withhold the answer, and wait for my attempt.\n\n[Reader position: audio segment 4 of 4 “Book I” in “Republic”, 38% through the audiobook, paused. Structural section: Book I. This is navigation metadata, not source evidence. Use only source text available in the notebook; do not invent excerpts or assume access to the exact passage.]';
    const prompt = localLearningSystemPrompt(source, true, request);

    expect(isPracticeRequest(request)).toBe(true);
    expect(prompt).toContain('identifies the active structural scope as Book I');
    expect(prompt).toContain('Use the supplied source text for that chapter to answer or create the requested question');
    expect(prompt).toContain('it is chapter-level evidence even when the exact audio timestamp or narrated sentence is unavailable');
    expect(prompt).toContain('do not ask the learner to describe it');
    expect(prompt).toContain('do not claim that chapter text is the exact audio segment');
    expect(prompt).toContain('make the entire response exactly one clear, source-grounded question and nothing else');
    expect(prompt).toContain('do not quote a passage, explain the answer, or include text that reveals it');
  });

  it('keeps attempted-answer feedback brief and tied to the dialogue the source shows', () => {
    const prompt = localLearningSystemPrompt(
      '[1] Republic, Book I\nPolemarchus states an account of justice. Socrates challenges it.',
      true,
      'Simonides says justice is giving each person what is owed.',
    );

    expect(prompt).toContain('respond concisely to the answer the learner actually gave');
    expect(prompt).toContain('keep the speaker’s stated claim, the other speaker’s challenge, and the response or conclusion the selected passage actually gives distinct');
    expect(prompt).toContain('do not invent an exchange, example, concession, or progression the source does not show');
    expect(prompt).toContain('Correct only a specific point the selected text contradicts');
  });

  it('does not reject an unsupported Cephalus answer or invent a substitute', () => {
    const prompt = localLearningSystemPrompt(
      '[1] Republic, Book I excerpt selected for this turn; it does not include the passage about Cephalus’s wealth.',
      true,
      'His wealth helps him avoid deceiving others and leaving debts unpaid. Please check my answer in no more than two sentences; do not ask another question.',
    );

    expect(prompt).toContain('Verify both the question’s premise and the learner’s answer against the selected source text');
    expect(prompt).toContain('a prior question or its citation is not evidence by itself');
    expect(prompt).toContain('acknowledge that you cannot verify it from the available passage');
    expect(prompt).toContain('do not supply a guessed or remembered alternative answer');
    expect(prompt).toContain('The answer prose must contain no more than 2 sentences.');
    expect(prompt).toContain('Do not add a follow-up question, invitation, offer, or next step.');
  });
});

describe('source-grounded dialogue guidance', () => {
  it('separates a speaker’s stated claim from a Socratic reductio and its conclusion', () => {
    const prompt = localLearningSystemPrompt('[1] Republic, Book I\nThe dialogue tests Polemarchus’ definition of justice.', false);

    expect(prompt).toContain('Distinguish each speaker’s claim from the questions, reductio, or challenge raised against it');
    expect(prompt).toContain('verify from the supplied passage who states each view');
    expect(prompt).toContain('Treat conversation history, including your earlier answers, as context only, never as evidence');
    expect(prompt).toContain('do not present an interlocutor’s definition or a reductio premise as the work’s final position');
    expect(prompt).toContain('whether the claim is rejected, revised, or left unresolved');
  });
});
