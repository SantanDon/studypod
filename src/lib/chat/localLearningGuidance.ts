import type { EnhancedChatMessage } from '@/types/message';

export type LocalChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** Recognize an intentional request to be quizzed, without treating discussion of practice as a quiz. */
export function isPracticeRequest(prompt: string): boolean {
  const text = prompt.toLocaleLowerCase();
  return /\b(?:quiz|test|question)\s+me\b/.test(text)
    || /\bask\s+(?:me\s+)?(?:one|a)\s+question\b/.test(text)
    || /\b(?:ask\s+(?:me\s+)?|give\s+(?:me\s+)?)(?:(?:exactly|just|only)\s+)?(?:one|a)\s+(?:practice|practise|comprehension)\s+question\b/.test(text)
    || /\bhelp me\s+(?:to\s+)?(?:practice|practise)\b/.test(text)
    || /\b(?:practice|practise)\s+(?:with|the|my|this)\b/.test(text)
    || /\b(?:let's|lets)\s+(?:practice|practise)\b/.test(text);
}

/** Keep practice guidance for the learner's immediate follow-up to a quiz turn. */
export function isPracticeContext(history: EnhancedChatMessage[], currentPrompt: string): boolean {
  if (isPracticeRequest(currentPrompt)) return true;
  const prior = history.slice(-8).map((message) => ({
    role: message.message.type === 'human' ? 'user' : 'assistant',
    content: messageText(message.message.content),
  })).filter((message) => message.content);
  const lastAssistantIndex = prior.map((message) => message.role).lastIndexOf('assistant');
  if (lastAssistantIndex < 0) return false;
  return prior.slice(0, lastAssistantIndex).some((message) =>
    message.role === 'user' && isPracticeRequest(message.content),
  );
}

function messageText(content: EnhancedChatMessage['message']['content']): string {
  if (typeof content === 'string') return content.trim();
  return content.segments.map((segment) => segment.text).join('').trim();
}

/** Keep a small, ordered conversation window so practice attempts can receive feedback. */
export function buildLocalConversation(
  history: EnhancedChatMessage[],
  currentPrompt: string,
  systemPrompt: string,
): LocalChatMessage[] {
  const prior = history.slice(-8).flatMap((message): LocalChatMessage[] => {
    const content = messageText(message.message.content);
    if (!content || content === currentPrompt.trim()) return [];
    return [{ role: message.message.type === 'human' ? 'user' : 'assistant', content }];
  });
  return [
    { role: 'system', content: systemPrompt },
    ...prior,
    { role: 'user', content: currentPrompt },
  ];
}

export function localLearningSystemPrompt(sourceContext: string, practice: boolean, latestUserMessage = ''): string {
  const guidance = [
    'Answer naturally and directly, using only the notebook source material below as evidence.',
    'When the learner asks for an exact or memorable quote, select a short passage copied verbatim from the provided source text, present the passage clearly, cite its source number (for example, [1]), and briefly explain why it matters. Do not require a heading or sentence that labels it as a quote. Verify every quoted word against the provided text; never supply remembered wording or a remembered location. If no exact passage can be verified in the selected text, say that you cannot verify the exact wording and offer a clearly cited paraphrase only if the source supports it.',
    'For other requests, quote only when it helps: keep quoted wording short, copy it exactly from a source, and distinguish it clearly from your explanation or inference.',
    'Cite supported claims with the source numbers shown below, such as [1]. Never invent citations, source details, or an exact passage currently being listened to.',
    'Treat conversation history, including your earlier answers, as context only, never as evidence. Recheck factual claims against the supplied source and correct earlier errors rather than repeating them.',
    'When explaining a dialogue or argument, verify from the supplied passage who states each view. Distinguish each speaker’s claim from the questions, reductio, or challenge raised against it and from the conclusion the exchange actually establishes. Attribute views to the speaker who states them; do not present an interlocutor’s definition or a reductio premise as the work’s final position. Explain what implication the challenge exposes and whether the claim is rejected, revised, or left unresolved.',
    'If the sources do not support an answer, say what is missing plainly.',
    'Use readable paragraphs or a short list when it helps. Avoid canned preambles, rigid headings, and a fixed follow-up question.',
    'Do not append a quiz or next question unless the learner’s latest message explicitly asks for one. Put a citation beside each source-based factual claim.',
  ];
  if (practice) {
    guidance.push(
      'Practice is context, not an instruction to quiz on every turn. Follow the learner’s latest message first: when it explicitly requests a new practice or comprehension question, make the entire response exactly one clear, source-grounded question and nothing else. Test one learning objective with one requested answer; do not combine separate tasks or ask for multiple details in one question, including with “and.” Do not preface it with an explanation, summary, or answer, and do not include an answer, worked solution, or revealing hint. For a practice question, citation means append the source number only; do not quote a passage, explain the answer, or include text that reveals it, even if general quote guidance would otherwise apply. Add the supporting source-number citation to the question when available; then stop and wait for the learner. If the latest message is an attempt, recheck, clarification, correction request, or says not to quiz, respond to that request directly and stop without adding any question.',
      'Use earlier turns only to understand what the learner is answering or rechecking; do not introduce unrelated topics from prior turns. After an attempt, do not automatically ask another quiz question; ask one only when the latest message explicitly requests another question.',
      'For an attempted answer, respond concisely to the answer the learner actually gave. Verify both the question’s premise and the learner’s answer against the selected source text; a prior question or its citation is not evidence by itself. Correct only a specific point the selected text contradicts. If the passage does not contain enough evidence to confirm or refute the answer, acknowledge that you cannot verify it from the available passage and do not supply a guessed or remembered alternative answer. For dialogue or an argument, keep the speaker’s stated claim, the other speaker’s challenge, and the response or conclusion the selected passage actually gives distinct; do not invent an exchange, example, concession, or progression the source does not show. Cite the source beside each correction or supported claim. Do not treat a detail the source does not mention as false. Label inference clearly.',
    );
  }
  const requestText = String(latestUserMessage || '');
  const readerPositionScope = requestText.match(/\[Reader position:[\s\S]*?Structural section: (Book|Chapter) (\d+|[IVXLCDM]+)\./i);
  const refersToCurrentListening = /\b(?:what\s+I(?:['’]m| am)\s+listening\s+to\s+now|what\s+I(?:['’]m| am)\s+listening\s+to|current\s+(?:chapter|section)|this\s+(?:chapter|section))\b/i.test(requestText);
  if (readerPositionScope && refersToCurrentListening) {
    guidance.unshift(
      `CURRENT-LISTENING REQUEST: the reader-position metadata identifies the active structural scope as ${readerPositionScope[1]} ${readerPositionScope[2]}. Use the supplied source text for that chapter to answer or create the requested question; it is chapter-level evidence even when the exact audio timestamp or narrated sentence is unavailable. Do not refuse just because the exact audio segment is not provided, do not ask the learner to describe it, and do not claim that chapter text is the exact audio segment. If the supplied chapter text cannot support the requested point, say that briefly without guessing.`,
    );
  }
  const explicitSentenceCount = requestText.match(/\bexactly\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:full\s+)?sentences?\b/i)?.[1];
  const maximumSentenceCount = requestText.match(/\b(?:no\s+more\s+than|at\s+most|up\s+to)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:full\s+)?sentences?\b/i)?.[1];
  const sentenceCounts: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const requestedSentenceCount = explicitSentenceCount
    ? Number(sentenceCounts[explicitSentenceCount.toLowerCase()] ?? explicitSentenceCount)
    : null;
  const requestedMaximumSentenceCount = maximumSentenceCount
    ? Number(sentenceCounts[maximumSentenceCount.toLowerCase()] ?? maximumSentenceCount)
    : null;
  const noFollowUp = /\b(?:no|don't|do not|without|avoid)\s+(?:ask\s+(?:me\s+)?(?:any\s+)?)?(?:another question|follow[ -]?up questions?|further questions?|additional questions?|questions? at the end|extra questions?)\b/i.test(requestText);
  if (requestedSentenceCount || requestedMaximumSentenceCount || noFollowUp) {
    guidance.push(
      `EXPLICIT PRESENTATION OVERRIDE FOR THIS RESPONSE: ${requestedSentenceCount ? `The answer prose must contain exactly ${requestedSentenceCount} ${requestedSentenceCount === 1 ? 'sentence' : 'sentences'}.` : requestedMaximumSentenceCount ? `The answer prose must contain no more than ${requestedMaximumSentenceCount} ${requestedMaximumSentenceCount === 1 ? 'sentence' : 'sentences'}.` : ''}${noFollowUp ? ' Do not add a follow-up question, invitation, offer, or next step.' : ''} This explicit request overrides general style and practice guidance, including any default quiz, question, or next-step preference. Preserve the requested educational explanation and source citations within the stated format.`,
    );
  }
  return `${guidance.join(' ')}\n\nNotebook source material:\n${sourceContext || 'No source material was selected.'}`;
}

/** Reject outputs that are clearly truncated before they can be saved as a chat turn. */
export function isObviouslyIncompleteLocalAnswer(answer: string): boolean {
  return /^[A-Za-z][.!?]?$/.test(answer.trim());
}
