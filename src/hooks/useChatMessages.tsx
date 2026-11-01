import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuthState } from "@/hooks/useAuthState";
import { useAuth } from "@/hooks/useAuth";
import { useGuest } from "@/hooks/useGuest";
import { EnhancedChatMessage } from "@/types/message";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { shouldReportNetworkError } from "@/lib/utils/networkError";
import {
  localStorageService,
  LocalUser,
} from "@/services/localStorageService";
import { ApiService } from "@/services/apiService";
import { generateAIResponse } from "@/services/chatAiService";
import { validateCitations, validateAIResponse } from "@/lib/extraction/contentValidator";
import { mapPersistedMessage } from "@/lib/chat/persistedMessage";
import { buildLocalConversation, isObviouslyIncompleteLocalAnswer, isPracticeContext, localLearningSystemPrompt } from "@/lib/chat/localLearningGuidance";
import { isOllamaEnabled } from "@/config/ollamaConfig";
import { getLocalModelSettings, isCompatibleLocalModelSelected } from "@/config/localModelConfig";
import { chatCompletion } from "@/lib/ai/ollamaService";
import { getQuoteGroundingIssue } from "@/lib/chat/quoteGrounding";

export type ChatMessageRequest = {
  notebookId: string;
  role: "user" | "assistant";
  content: string;
  saveAsNote?: boolean;
  responseStyle?: 'dense' | 'conversational';
  sourceIds?: string[];
};

type ScopedPracticeFollowup = {
  prompt: string;
  sourceIds: string[];
  assistantQuestion: string;
};

type LocalChatStage = "context" | "generation" | "quote_repair" | "citation_repair";

const logLocalChatStageFailure = (
  stage: LocalChatStage,
  startedAt: number,
  model: string,
  promptChars: number | undefined,
  completedStageMs: Partial<Record<LocalChatStage, number>>,
) => {
  // Model labels are useful for local diagnostics, but only log a plain identifier.
  const safeModel = /^[a-z0-9][a-z0-9._:/-]{0,99}$/i.test(model) ? model : "custom";
  console.error("Local chat stage failed", {
    stage,
    elapsedMs: Date.now() - startedAt,
    completedStageMs: { ...completedStageMs },
    model: safeModel,
    ...(promptChars === undefined ? {} : { promptChars }),
  });
};

const isPracticeAnswerOrRecheck = (message: string): boolean => {
  const text = message.trim();
  if (!text || /^(?:new topic|instead|unrelated|switch topics?|tell me|explain|describe|what|why|how|can you|could you|please|also|now)\b/i.test(text)) return false;
  if (/\b(?:my answer|my response|check (?:the )?source|recheck|check if|is (?:my answer|that|this) (?:right|correct)|did i get|grade my answer)\b/i.test(text)) return true;
  return !text.includes('?');
};


const buildQuoteRepairEvidence = (
  sources: Array<{ content?: string | null }>,
  question: string,
  includeAdjacentSentences = false,
) => {
  const ignoredTerms = new Set(['about', 'after', 'again', 'and', 'answer', 'chapter', 'do', 'end', 'explain', 'find', 'for', 'from', 'give', 'have', 'into', 'it', 'one', 'please', 'quote', 'short', 'source', 'that', 'the', 'these', 'this', 'to', 'using', 'what', 'with', 'your']);
  const queryTerms = new Set(
    (question.toLocaleLowerCase().match(/[a-z0-9]{3,}/g) || [])
      .filter((term) => !ignoredTerms.has(term)),
  );
  const candidates: Array<{ sourceIndex: number; sentenceIndex: number; score: number; text: string }> = [];

  for (const [sourceIndex, source] of sources.entries()) {
    const sentences = (source.content || '')
      .split(/\n\s*\n/)
      .flatMap((paragraph): string[] => paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [])
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0 && sentence.length <= 280);

    sentences.forEach((_, sentenceIndex) => {
      const maxWidth = includeAdjacentSentences ? Math.min(3, sentences.length - sentenceIndex) : 1;
      for (let width = 1; width <= maxWidth; width += 1) {
        const text = sentences.slice(sentenceIndex, sentenceIndex + width).join(' ');
        if (text.length < 25 || text.length > 280) continue;
        const sentenceTerms = new Set(text.toLocaleLowerCase().match(/[a-z0-9]{3,}/g) || []);
        const score = [...queryTerms].reduce((total, term) => total + Number(sentenceTerms.has(term)), 0);
        if (score > 0) candidates.push({ sourceIndex, sentenceIndex, score, text });
      }
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.sourceIndex - b.sourceIndex || a.sentenceIndex - b.sentenceIndex);
  const perSource = new Map<number, number>();
  const seenPassages = new Set<string>();
  const evidence: string[] = [];
  for (const candidate of candidates) {
    const sourceCount = perSource.get(candidate.sourceIndex) || 0;
    const normalized = candidate.text.toLocaleLowerCase().replace(/\s+/g, ' ');
    if (sourceCount >= 4 || seenPassages.has(normalized)) continue;
    evidence.push(`[${candidate.sourceIndex + 1}] ${candidate.text}`);
    seenPassages.add(normalized);
    perSource.set(candidate.sourceIndex, sourceCount + 1);
    if (evidence.length >= 12) break;
  }

  return evidence.join('\n');
};

const explicitlyRequestsCitation = (question: string) =>
  /\b(?:cite|citation|citations|cited|reference|references|source number)\b/i.test(question);

const citationMatchTerm = (term: string) => {
  // Normalize only common inflections so “harming enemies” can match the
  // source's “harm ... enemy” without introducing broader semantic matching.
  if (term.length > 5 && term.endsWith('ies')) return `${term.slice(0, -3)}y`;
  if (term.length > 5 && term.endsWith('ing')) {
    const stem = term.slice(0, -3);
    return stem.length > 2 && stem.at(-1) === stem.at(-2) ? stem.slice(0, -1) : stem;
  }
  if (term.length > 4 && term.endsWith('ed')) return term.slice(0, -2);
  if (term.length > 4 && term.endsWith('s') && !term.endsWith('ss')) return term.slice(0, -1);
  return term;
};

const citationPassage = (content: string, answer: string, citationId: number, scopePrompt?: string): string | undefined => {
  const citationMarker = `[${citationId}]`;
  const citationIndex = answer.indexOf(citationMarker);
  const previousCitationIndex = citationIndex > 0
    ? Math.max(...[...answer.slice(0, citationIndex).matchAll(/\[\d+\]/g)].map((match) => (match.index || 0) + match[0].length), 0)
    : 0;
  const citationSegment = answer.slice(previousCitationIndex, citationIndex >= 0 ? citationIndex + citationMarker.length : undefined);
  const citedSentence = answer
    .split(/(?<=[.!?])\s+/)
    .find((sentence) => sentence.includes(`[${citationId}]`))
    ?.replace(new RegExp(`\\[${citationId}\\]`, 'g'), '') || answer;
  const quotedText = [...citationSegment.matchAll(/[“"]([^”"]{20,})[”"]/g)]
    .map((match) => match[1].trim())
    .sort((left, right) => right.length - left.length)[0];
  let scopedContent = content;
  const bookMatch = scopePrompt?.match(/\bbook\s+([ivxlcdm]+|\d+)\b/i);
  const chapterMatch = scopePrompt?.match(/\bchapter\s+(\d+)\b/i);
  const scopeMatch = bookMatch
    ? { kind: 'book', number: bookMatch[1].toLocaleUpperCase() }
    : chapterMatch ? { kind: 'chapter', number: chapterMatch[1] } : undefined;
  if (scopeMatch) {
    const headingPattern = scopeMatch.kind === 'book'
      ? /^\s*BOOK\s+([IVXLCDM]+|\d+)\b(?:\s*[:.-][^\n]*)?\s*$/gim
      : /^\s*CHAPTER\s+(\d+)\b[^\n]*$/gim;
    const headings = [...content.matchAll(headingPattern)];
    if (headings.length) {
      const target = headings.find((heading) => heading[1].toLocaleUpperCase() === scopeMatch.number);
      if (!target || target.index === undefined) return undefined;
      const nextHeading = headings.find((heading) => (heading.index || 0) > target.index!);
      scopedContent = content.slice(target.index + target[0].length, nextHeading?.index);
    }
  }
  let passageCursor = 0;
  const passages = scopedContent
    .split(/(?<=[.!?])\s+|\n+/)
    .flatMap((passage) => {
      const passageIndex = scopedContent.indexOf(passage, passageCursor);
      if (passageIndex < 0) return [];
      passageCursor = passageIndex + passage.length;
      const leadingWhitespace = passage.length - passage.trimStart().length;
      const text = passage.trim();
      const start = passageIndex + leadingWhitespace;
      const end = start + text.length;
      return text.length > 0 && text.length <= 1200 ? [{ text, start, end }] : [];
    });
  if (quotedText) {
    // Keep the quote's ordered words exact while allowing punctuation and
    // whitespace to differ in PDF extraction or model formatting.
    const quoteTokens = quotedText.match(/[\p{L}\p{N}]+/gu) || [];
    if (quoteTokens.length < 4) return undefined;
    const quotePattern = `${quoteTokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]+')}[.!?;:]?`;
    const exactMatch = new RegExp(quotePattern, 'i').exec(scopedContent);
    if (exactMatch) {
      const normalizedQuote = quotedText.toLocaleLowerCase().replace(/\s+/g, ' ');
    return passages.find(({ text }) => text.toLocaleLowerCase().replace(/\s+/g, ' ').includes(normalizedQuote))?.text || exactMatch[0];
    }
  }
  if (quotedText) {
    const normalizedQuote = quotedText.toLocaleLowerCase().replace(/\s+/g, ' ');
    return passages.find(({ text }) => text.toLocaleLowerCase().replace(/\s+/g, ' ').includes(normalizedQuote))?.text;
  }
  const ignored = new Set(['about', 'after', 'also', 'because', 'being', 'from', 'have', 'into', 'that', 'their', 'there', 'these', 'they', 'this', 'those', 'were', 'which', 'with', 'would', 'your']);
  const terms = new Set((citedSentence.toLocaleLowerCase().match(/[a-z0-9]{4,}/g) || [])
    .filter((term) => !ignored.has(term))
    .map(citationMatchTerm));
  if (!terms.size) return undefined;
  // A paraphrased claim may be supported by a short exchange spanning several
  // sentences. Compare small contiguous windows as well as individual lines;
  // keep the returned excerpt verbatim and prefer the narrowest equally strong
  // match so this does not turn into broad source-level matching.
  const candidates = passages.flatMap((passage, start) =>
    Array.from({ length: Math.min(3, passages.length - start) }, (_, offset) => {
      const endPassage = passages[start + offset];
      // Preserve the exact source separators. Joining sentences with a space can
      // create an excerpt the save endpoint correctly rejects as non-verbatim.
      return scopedContent.slice(passage.start, endPassage.end);
    }),
  );
  let best: { text: string; score: number; ratio: number; length: number } | undefined;
  let tiedForBest = false;
  for (const text of candidates) {
    if (text.length < 15) continue;
    const passageTerms = new Set((text.toLocaleLowerCase().match(/[a-z0-9]{4,}/g) || []).map(citationMatchTerm));
    const score = [...terms].reduce((total, term) => total + Number(passageTerms.has(term)), 0);
    const ratio = score / terms.size;
    const length = text.length;
    if (score > (best?.score || 0) || (score === best?.score && ratio > (best?.ratio || 0)) ||
      (score === best?.score && ratio === best?.ratio && length < (best?.length || Infinity))) {
      best = { text, score, ratio, length };
      tiedForBest = false;
    } else if (score === best?.score && ratio === best.ratio && length === best.length && score > 0) {
      tiedForBest = true;
    }
  }
  return best && best.score >= 2 && best.ratio >= 0.25 && !tiedForBest ? best.text : undefined;
};

const hasAvailableSourceCitation = (answer: string, sourceCount: number) =>
  [...answer.matchAll(/\[(\d+)\]/g)].some((match) => {
    const sourceNumber = Number(match[1]);
    return Number.isInteger(sourceNumber) && sourceNumber > 0 && sourceNumber <= sourceCount;
  });

export const useChatMessages = (
  notebookId?: string,
  onRetry?: (request: ChatMessageRequest) => void,
) => {
  const { user } = useAuthState();
  const { guestId } = useGuest();
  const { session } = useAuth();
  const effectiveUserId = user?.id || guestId;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const pendingLocalTurn = useRef<{ key: string; payload: { turnId: string; question: string; answer: string; sourceIds: string[]; citationMap: Array<{ citationId: number; sourceId: string; excerpt?: string }> } } | null>(null);
  const scopedPracticeFollowup = useRef<ScopedPracticeFollowup | null>(null);

  const localTurnKey = (message: { notebookId: string; content: string; sourceIds?: string[] }) =>
    JSON.stringify([message.notebookId, message.content, message.sourceIds || []]);

  const {
    data: messages = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["chat-messages", notebookId],
    queryFn: async ({ signal }) => {
      if (!notebookId) return [];

      let expandedMessages: EnhancedChatMessage[] = [];

      try {
        if (session?.access_token) {
          // Cloud account - fetch from backend API
          const dbMessages = await ApiService.getChatMessages(notebookId, session.access_token, signal);
          
          expandedMessages = dbMessages.map(mapPersistedMessage);
        } else {
          // Guest account - fetch from localStorage
          const storedMessages = localStorageService.getChatMessages(notebookId);
          storedMessages.forEach((item) => {
            if (item.message && typeof item.message === "string" && item.message.trim()) {
              expandedMessages.push({
                id: `${item.id}-user`,
                notebook_id: item.notebook_id,
                message: { type: "human", content: item.message },
                created_at: item.created_at,
              });
            }

            if (item.response && item.response.trim()) {
              expandedMessages.push({
                id: `${item.id}-ai`,
                notebook_id: item.notebook_id,
                message: { type: "ai", content: item.response },
                created_at: item.created_at,
              });
            }
          });
        }
      } catch (err) {
        if (shouldReportNetworkError(err, signal)) console.error("Error fetching chat messages:", err);
      }

      return expandedMessages;
    },
    enabled: !!notebookId && !!effectiveUserId,
    refetchOnMount: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (!notebookId || !effectiveUserId) return;
    queryClient.invalidateQueries({ queryKey: ["chat-messages", notebookId] });
  }, [notebookId, effectiveUserId, queryClient]);

  const sendMessage = useMutation({
    mutationFn: async (messageData: ChatMessageRequest) => {
      if (!effectiveUserId) throw new Error("User not authenticated");

      if (session?.access_token) {
        if (isOllamaEnabled() || isCompatibleLocalModelSelected()) {
          if (messageData.saveAsNote) {
            const error = new Error("Save as note is not supported for local chat yet. No message was sent.") as Error & { code: string };
            error.code = "LOCAL_CHAT_UNSUPPORTED_ACTION";
            throw error;
          }
          const turnKey = localTurnKey(messageData);
          const pending = pendingLocalTurn.current;
          if (pending?.key === turnKey) {
            await ApiService.saveLocalChatTurn(messageData.notebookId, pending.payload, session.access_token);
            pendingLocalTurn.current = null;
            return { response: pending.payload.answer, notebookId: messageData.notebookId };
          }
          const selectedModel = getLocalModelSettings().model || "default";
          const completedStageMs: Partial<Record<LocalChatStage, number>> = {};
          const runLocalStage = async <T,>(stage: LocalChatStage, promptChars: number | undefined, run: () => Promise<T>): Promise<T> => {
            const startedAt = Date.now();
            try {
              const result = await run();
              completedStageMs[stage] = Date.now() - startedAt;
              return result;
            } catch (error) {
              logLocalChatStageFailure(stage, startedAt, selectedModel, promptChars, completedStageMs);
              throw error;
            }
          };
          const carriedScope = scopedPracticeFollowup.current;
          const canCarryScope = !!carriedScope
            && JSON.stringify(carriedScope.sourceIds) === JSON.stringify(messageData.sourceIds || [])
            && isPracticeAnswerOrRecheck(messageData.content);
          if (!canCarryScope) scopedPracticeFollowup.current = null;
          const context = await runLocalStage("context", undefined, () => ApiService.getLocalChatContext(
            messageData.notebookId,
            messageData.sourceIds,
            session.access_token,
            canCarryScope ? carriedScope.prompt : messageData.content,
          ));
          if (context.sectionScope?.matched === false) {
            const error = new Error("The requested chapter was not found in the selected sources. Select the book source or ask about an available chapter. Your draft is preserved.") as Error & { code: string };
            error.code = "REQUESTED_SECTION_NOT_FOUND";
            throw error;
          }
          const sources = context.sources || [];
          const sourceContext = sources.map((source, index) =>
            `[${index + 1}] ${source.title} (${source.type})\n${source.content}`,
          ).join("\n\n");
          const scopedMessages = context.sectionScope
            ? canCarryScope && carriedScope
              ? [
                  { id: 'scoped-practice-request', notebook_id: messageData.notebookId, message: { type: 'human' as const, content: carriedScope.prompt } },
                  { id: 'scoped-practice-question', notebook_id: messageData.notebookId, message: { type: 'ai' as const, content: carriedScope.assistantQuestion } },
                ]
              : []
            : messages;
          const conversation = buildLocalConversation(
            scopedMessages,
            messageData.content,
            localLearningSystemPrompt(sourceContext, canCarryScope || isPracticeContext(scopedMessages, messageData.content), messageData.content),
          );
          let answer = await runLocalStage("generation", conversation.reduce((total, message) => total + message.content.length, 0), () => chatCompletion({
            localOnly: true,
            temperature: 0.2,
            messages: conversation,
          }));
          const quoteSources = sources.map((source) => ({ content: source.content || "" }));
          const quoteIssue = getQuoteGroundingIssue(messageData.content, answer, quoteSources);
          if (quoteIssue) {
            const repairMessages = [
              ...conversation,
              { role: "assistant" as const, content: answer },
              { role: "user" as const, content: `Answer my original request again. ${quoteIssue} Use only the verbatim source passages below as quote candidates; copy the chosen wording exactly, including punctuation, and cite the matching source number. Do not quote or paraphrase these passages as though they prove a claim they do not support. If none is relevant or you cannot verify exact wording, say so honestly without quoting. Keep the explanation brief. Preserve any check-your-understanding question explicitly requested in my original request, but do not add a question if I did not ask for one.\n\nVerbatim source passages:\n${buildQuoteRepairEvidence(quoteSources, messageData.content)}` },
            ];
            answer = await runLocalStage("quote_repair", repairMessages.reduce((total, message) => total + message.content.length, 0), () => chatCompletion({
              localOnly: true,
              temperature: 0.1,
              messages: repairMessages,
            }));
            if (getQuoteGroundingIssue(messageData.content, answer, quoteSources)) {
              throw new Error("The model could not verify an exact quote from your sources. Your draft is preserved; try asking for an explanation instead.");
            }
          }
          if (explicitlyRequestsCitation(messageData.content) && sources.length > 0 && !hasAvailableSourceCitation(answer, sources.length)) {
            const evidence = buildQuoteRepairEvidence(quoteSources, messageData.content, true);
            if (!evidence) {
              throw new Error("I could not find a relevant passage to cite in the selected sources. Your draft is preserved; try selecting a source passage or narrowing the question.");
            }
            const repairMessages = [
              ...conversation,
              { role: "assistant" as const, content: answer },
              { role: "user" as const, content: `Revise your answer to satisfy my explicit request for a source citation. Keep its useful explanation and preserve any learning question I explicitly requested. Add a numeric [N] citation only to a factual claim directly supported by a passage labeled [N] below. Do not invent a citation or quote. If no passage supports the claim, say that honestly.\n\nVerbatim source passages:\n${evidence}` },
            ];
            answer = await runLocalStage("citation_repair", repairMessages.reduce((total, message) => total + message.content.length, 0), () => chatCompletion({
              localOnly: true,
              temperature: 0.1,
              messages: repairMessages,
            }));
            if (!hasAvailableSourceCitation(answer, sources.length)) {
              throw new Error("The model could not add a source-supported citation. Your draft is preserved; try narrowing the question to a relevant passage.");
            }
          }
          if (!answer.trim()) throw new Error("Local model returned an empty answer; no message was saved.");
          if (isObviouslyIncompleteLocalAnswer(answer)) {
            throw new Error("Local model returned an incomplete answer; no message was saved. Please retry.");
          }
          if (/[Ss]ource:\s*\w+/.test(answer)) {
            throw new Error("Local answer used unsupported citation syntax; no message was saved.");
          }
          const citationValidation = await validateCitations(answer, sources.map((source) => ({
            id: source.id, title: source.title, content: source.content || "",
          })), false);
          if (!citationValidation.isValid) {
            throw new Error("Local answer contains a citation that cannot be matched to the selected sources; no message was saved.");
          }
          const buildCitationMap = () => {
            const citationIds = [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])))];
            const citationMap: Array<{ citationId: number; sourceId: string; excerpt: string }> = [];
            for (const citationId of citationIds) {
              const source = sources[citationId - 1];
              if (!source) return undefined;
              const excerpt = citationPassage(source.content || '', answer, citationId, canCarryScope ? carriedScope?.prompt : messageData.content);
              if (!excerpt) return undefined;
              citationMap.push({ citationId, sourceId: source.id, excerpt });
            }
            return citationMap;
          };
          let citationMap = buildCitationMap();
          if (!citationMap && explicitlyRequestsCitation(messageData.content) && sources.length > 0) {
            const evidence = buildQuoteRepairEvidence(quoteSources, messageData.content, true);
            if (!evidence) throw new Error("Local citation could not be matched to a strong passage in the selected source; no message was saved.");
            const repairMessages = [
              ...conversation,
              { role: "assistant" as const, content: answer },
              { role: "user" as const, content: `Revise your answer so every [N] citation points to a passage below that directly supports the nearby claim. Keep the answer brief and preserve its requested format. Use only the numbered passages below; do not invent a citation, quote, or supporting detail. If none of these passages supports the answer, say that you cannot verify it from the selected source.

Source passages:
${evidence}` },
            ];
            answer = await runLocalStage("citation_repair", repairMessages.reduce((total, message) => total + message.content.length, 0), () => chatCompletion({
              localOnly: true,
              temperature: 0.1,
              messages: repairMessages,
            }));
            if (!answer.trim() || !hasAvailableSourceCitation(answer, sources.length)) {
              throw new Error("The model could not provide a source-supported citation. Your draft is preserved; try narrowing the question to a relevant passage.");
            }
            if (/[Ss]ource:\s*\w+/.test(answer)) {
              throw new Error("The repaired answer used unsupported citation syntax. Your draft is preserved; try again.");
            }
            const hasVisibleQuote = /“[^”]{15,}”|"[^"\n]{15,}"|^\s*>\s*\S/m.test(answer);
            const repairedQuoteIssue = hasVisibleQuote
              ? getQuoteGroundingIssue(
                  `${messageData.content} Find an exact quote from the selected source.`,
                  answer,
                  quoteSources,
                )
              : null;
            if (repairedQuoteIssue) {
              throw new Error("The repaired answer included a quote that could not be verified in your sources. Your draft is preserved; try again without a quote.");
            }
            const repairedValidation = await validateCitations(answer, sources.map((source) => ({
              id: source.id, title: source.title, content: source.content || "",
            })), false);
            if (!repairedValidation.isValid || !(citationMap = buildCitationMap())) {
              throw new Error("The model could not match its citation to a strong passage in the selected source. Your draft is preserved; try narrowing the question to a relevant passage.");
            }
          }
          if (!citationMap) throw new Error("Local citation could not be matched to a strong passage in the selected source; no message was saved.");
          const sourceContents = sources.map((source) => source.content || "");
          const aiValidation = await validateAIResponse(answer, sourceContents, messageData.content);
          if (sourceContents.every((content) => !content.trim())) {
            answer += "\n\n⚠️ Note: The selected notebook sources do not provide enough material to verify this answer.";
          } else if (aiValidation.hallucinationRisk !== "low") {
            answer += `\n\n⚠️ Note: This response has a ${aiValidation.hallucinationRisk} support risk. Please verify important information directly from your sources.`;
          }
          const payload = {
            turnId: globalThis.crypto.randomUUID(),
            question: messageData.content,
            answer,
            sourceIds: sources.map((source) => source.id),
            citationMap,
          };
          pendingLocalTurn.current = { key: turnKey, payload };
          await ApiService.saveLocalChatTurn(messageData.notebookId, payload, session.access_token);
          pendingLocalTurn.current = null;
          scopedPracticeFollowup.current = context.sectionScope?.matched === true && answer.includes('?')
            ? { prompt: messageData.content, sourceIds: [...(messageData.sourceIds || [])], assistantQuestion: answer }
            : null;
          return { response: answer, notebookId: messageData.notebookId };
        }
        // Cloud account - send via backend generic API
        const result = await ApiService.sendChatMessage(
          messageData.notebookId, 
          { 
            message: messageData.content, 
            saveAsNote: messageData.saveAsNote,
            responseStyle: messageData.responseStyle,
            sourceIds: messageData.sourceIds,
          }, 
          session.access_token
        );
        return { response: result.answer, notebookId: messageData.notebookId };
      }

      // Guest account - local processing
      let aiResponse = await generateAIResponse(
        messageData.content,
        user as unknown as LocalUser,
        messageData.notebookId,
        "chat",
        undefined,
        messageData.sourceIds,
      );

      const allSources = localStorageService.getSources(messageData.notebookId);
      const sources = messageData.sourceIds?.length
        ? allSources.filter((source) => messageData.sourceIds?.includes(source.id))
        : allSources;
      const sourcesForValidation = sources.map(s => ({
        id: s.id,
        title: s.title,
        content: s.content || ""
      }));

      try {
        const citationValidation = await validateCitations(aiResponse, sourcesForValidation, false);
        const sourceContents = sourcesForValidation.map(s => s.content);
        const aiValidation = await validateAIResponse(aiResponse, sourceContents, messageData.content);

        if (!citationValidation.isValid && citationValidation.issues.some(issue => issue.includes("does not match any available source"))) {
          aiResponse += "\n\n⚠️ Note: Some citations in this response may not correspond to available sources in your notebook.";
        }

        if (aiValidation.hallucinationRisk !== 'low' && aiValidation.issues.length > 0) {
          aiResponse += `\n\n⚠️ Note: This response has a ${aiValidation.hallucinationRisk} hallucination risk. Please verify important information directly from your sources.`;
        }
      } catch (validationError) {
        console.error("Response validation failed:", validationError);
      }

      const conversationPair = localStorageService.createChatMessage({
        notebook_id: messageData.notebookId,
        message: messageData.content,
        response: aiResponse,
      });

      return { conversationPair, notebookId: messageData.notebookId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", data.notebookId] });
    },
    onError: (error, variables) => {
      console.error("❌ Chat message error:", error);
      const msg = error instanceof Error ? error.message : "Failed to send message";
      const { status: httpStatus, code: errorCode } = error as Error & { status?: number; code?: string };
      // True offline: no network connectivity
      const isTrueOffline = typeof navigator !== "undefined" && !navigator.onLine;
      // A 503 can also come from the notebook database or another service.
      const isProviderUnavailable = errorCode === 'PROVIDER_UNAVAILABLE'
        || (!errorCode && msg.includes('PROVIDER_UNAVAILABLE'));
      const isDatabaseUnavailable = errorCode === 'DATABASE_TEMPORARILY_UNAVAILABLE';
      const isLocalChatUnsupported = errorCode === 'LOCAL_CHAT_NOT_SUPPORTED';
      const canRetry = isTrueOffline || isProviderUnavailable || isDatabaseUnavailable || httpStatus === 503
        || (!!pendingLocalTurn.current && pendingLocalTurn.current.key === localTurnKey(variables));
      const isImageBlock = msg.includes('image') || msg.includes('attachment');

      const description = isTrueOffline
        ? "You appear to be offline. Your draft is saved — retry when your connection is restored."
        : isProviderUnavailable
          ? "AI providers are currently unreachable. Your draft is still available, so you can retry when the connection recovers."
          : isDatabaseUnavailable
            ? "The notebook database is temporarily unavailable. Your draft is still available. Please retry shortly."
          : isImageBlock
            ? "This AI model processes text only. Images and files cannot be read."
            : msg;

      toast({
        title: isLocalChatUnsupported ? "Local Chat Not Available Yet"
          : isTrueOffline ? "You're Offline"
          : isProviderUnavailable ? "AI Temporarily Unavailable"
            : isDatabaseUnavailable ? "Notebook Temporarily Unavailable"
              : httpStatus === 503 ? "Temporarily Unavailable"
                : isImageBlock ? "Attachment Not Supported" : "Error",
        description: isLocalChatUnsupported ? msg : description,
        variant: "destructive",
        action: canRetry
          ? (
              <ToastAction
                altText="Retry sending message"
                onClick={() => {
                  if (!variables) return;
                  if (onRetry) onRetry(variables);
                  else sendMessage.mutate(variables);
                }}
              >
                Retry
              </ToastAction>
            )
          : undefined,
      });
    },
  });

  const deleteChatHistory = useMutation({
    mutationFn: async (notebookId: string) => {
      if (!effectiveUserId) throw new Error("User not authenticated");
      if (session?.access_token) {
        await ApiService.deleteChatHistory(notebookId, session.access_token);
      } else {
        const messages = localStorageService.getChatMessages(notebookId);
        for (const message of messages) {
          localStorageService.deleteChatMessage(message.id);
        }
      }
      return notebookId;
    },
    onSuccess: (notebookId) => {
      toast({ title: "Chat history cleared", description: "All messages have been deleted successfully." });
      queryClient.setQueryData(["chat-messages", notebookId], []);
      queryClient.invalidateQueries({ queryKey: ["chat-messages", notebookId] });
    },
    onError: (error) => {
      console.error("Failed to delete chat history:", error);
      toast({ title: "Error", description: "Failed to clear chat history. Please try again.", variant: "destructive" });
    },
  });

  return {
    messages,
    isLoading,
    error,
    sendMessage: sendMessage.mutate,
    sendMessageAsync: sendMessage.mutateAsync,
    isSending: sendMessage.isPending,
    deleteChatHistory: deleteChatHistory.mutate,
    isDeletingChatHistory: deleteChatHistory.isPending,
  };
};
