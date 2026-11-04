import { LocalUser, localStorageService } from "@/services/localStorageService";
import { OllamaTask } from "@/config/ollamaModels";
import { search } from "@/lib/search/semanticSearch";
import { getContextualPrompt, formatPrompt } from "@/config/prompts";
import { buildChatHistoryMessages } from "@/utils/chatHistoryBuilder";
import { isSourceUsableForGroundedChat } from "@/lib/sources/sourceProcessing";
import { getAudiobookChapterScope, getAudiobookSourceId, getVisibleChatQuestion } from "@/lib/audio/readingContext";

const extractStructuralSection = (content: string, requestedSection: string): string | undefined => {
  const requested = requestedSection.match(/^(Book|Chapter)\s+(\d+|[IVXLCDM]+)$/i);
  if (!requested) return undefined;
  const kind = requested[1].toLowerCase();
  const ordinal = requested[2].toUpperCase();
  // Whole-source extracts may wrap real structural headings in --- delimiters.
  // Keep suffixes out of the match: introductory prose often starts with a
  // phrase like "BOOK II. Thrasymachus..." but is not a chapter boundary.
  const heading = new RegExp(
    `^\\s{0,3}(?:#{1,6}\\s*)?(?:${kind}\\s+${ordinal}\\s*\\.?|---\\s*${kind}\\s+${ordinal}\\s*\\.?\\s*---)\\s*$`,
    "i",
  );
  const boundary = new RegExp(
    `^\\s{0,3}(?:#{1,6}\\s*)?(?:${kind}\\s+(?:\\d+|[IVXLCDM]+)\\s*\\.?|---\\s*${kind}\\s+(?:\\d+|[IVXLCDM]+)\\s*\\.?\\s*---)\\s*$`,
    "i",
  );
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return undefined;
  let end = lines.findIndex((line, index) => index > start && boundary.test(line));
  if (end < 0) end = lines.length;
  const section = lines.slice(start, end).join("\n").trim();
  return section.length > 0 ? section : undefined;
};

const CHAPTER_CONTEXT_CHAR_LIMIT = 6000;
const QUESTION_STOP_WORDS = new Set([
  "about", "after", "also", "because", "does", "from", "have", "into", "more", "most", "only",
  "other", "should", "that", "their", "them", "there", "these", "they", "this", "through",
  "what", "when", "where", "which", "while", "with", "would", "your",
]);

const chapterQuestionTerms = (question: string): string[] => [...new Set(
  (question.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
    .filter((term) => !QUESTION_STOP_WORDS.has(term)),
)];

const paragraphRelevance = (paragraph: string, terms: string[]): number => {
  if (terms.length === 0) return 0;
  const words = new Set(paragraph.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
  return terms.reduce((score, term) => score + Number(words.has(term)), 0);
};

const excerptAroundQuestionTerm = (text: string, terms: string[], budget: number): string => {
  if (text.length <= budget) return text;
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const matchPositions = terms.map((term) => normalized.indexOf(term)).filter((position) => position >= 0);
  if (matchPositions.length === 0) return text.slice(0, budget);
  const match = Math.min(...matchPositions);
  const start = Math.max(0, Math.min(match - Math.floor(budget / 3), text.length - budget));
  return text.slice(start, start + budget);
};

/** Select one contiguous, query-relevant chapter window while keeping source text verbatim. */
const selectChapterWindow = (section: string, terms: string[], budget: number): string => {
  if (budget <= 0) return "";
  const paragraphs = section.split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean);
  if (paragraphs.length === 0) return "";
  const scores = paragraphs.map((paragraph) => paragraphRelevance(paragraph, terms));
  const bestScore = Math.max(...scores);
  const seed = bestScore > 0 ? scores.indexOf(bestScore) : 0;
  let start = seed;
  let end = seed;
  let selected = paragraphs[seed];
  if (selected.length > budget) return excerptAroundQuestionTerm(selected, terms, budget);

  // Expand only to adjacent paragraphs, preserving a single contiguous window.
  while (true) {
    const left = start > 0 ? paragraphs[start - 1] : undefined;
    const right = end + 1 < paragraphs.length ? paragraphs[end + 1] : undefined;
    if (!left && !right) break;
    const candidates = [
      ...(left ? [{ side: "left" as const, text: left, score: scores[start - 1] }] : []),
      ...(right ? [{ side: "right" as const, text: right, score: scores[end + 1] }] : []),
    ].sort((a, b) => b.score - a.score);
    const candidate = candidates.find((item) => selected.length + 2 + item.text.length <= budget);
    if (!candidate) break;
    if (candidate.side === "left") start -= 1;
    else end += 1;
    selected = paragraphs.slice(start, end + 1).join("\n\n");
  }
  return selected;
};

const selectChapterEvidence = (
  sections: Array<{ source: ReturnType<typeof localStorageService.getSources>[number]; section: string }>,
  question: string,
): Array<{ source: (typeof sections)[number]["source"]; section: string }> => {
  const terms = chapterQuestionTerms(question);
  let remaining = CHAPTER_CONTEXT_CHAR_LIMIT;
  return sections.flatMap((entry, index) => {
    const budget = Math.floor(remaining / (sections.length - index));
    const section = selectChapterWindow(entry.section, terms, budget);
    remaining -= section.length;
    return section ? [{ source: entry.source, section }] : [];
  });
};

function formatSourcesForPrompt(
  sources: ReturnType<typeof localStorageService.getSources>,
  maxSources = 5,
): string {
  return sources
    .slice(0, maxSources)
    .map((source, index) => {
      let content = source.content || "";
      if (source.metadata && typeof source.metadata === "object" && "chunks" in source.metadata) {
        const chunks = source.metadata.chunks as unknown[];
        if (Array.isArray(chunks) && chunks.length > 0) {
          const chunkTexts = chunks
            .map((chunk) =>
              typeof chunk === "string"
                ? chunk
                : String(
                    (chunk as Record<string, unknown>)?.content ||
                      (chunk as Record<string, unknown>)?.text ||
                      "",
                  ),
            )
            .filter((text) => text.trim().length > 0);
          if (chunkTexts.length > 0) content = `${chunkTexts.join(" ")} ${content}`;
        }
      }

      return `[${index + 1}] Source: "${source.title}" (${source.type})\nContent: ${content.substring(0, 3000)}`;
    })
    .join("\n\n");
}

// Function to generate AI response using Ollama with ultra-fast processing and semantic search
export async function generateAIResponse(
  userMessage: string,
  _user: LocalUser,
  notebookId: string,
  _task: OllamaTask = "chat",
  onChunk?: (chunk: string) => void,
  sourceIds: string[] = [],
): Promise<string> {
  try {
    const requestedSourceIds = new Set(sourceIds);
    const allSources = localStorageService.getSources(notebookId);
    const sources = (requestedSourceIds.size > 0
      ? allSources.filter((source) => requestedSourceIds.has(source.id))
      : allSources
    ).filter(isSourceUsableForGroundedChat);

    if (requestedSourceIds.size > 0 && sources.length === 0) {
      const error = new Error("The selected source has no usable extracted text yet.");
      error.name = "NoUsableSourcesError";
      throw error;
    }

    const hasSourcesInNotebook = sources.length > 0;
    const historyMessages = buildChatHistoryMessages(notebookId);
    const recentUserMessages = historyMessages
      .filter((message) => message.role === "user")
      .slice(-3)
      .map((message) => getVisibleChatQuestion(message.content))
      .join("\n\n");

    // Reader-position metadata conditions the model response, but must not
    // affect which source passages retrieval selects.
    const retrievalQuestion = getVisibleChatQuestion(userMessage);
    const readerChapterScope = getAudiobookChapterScope(userMessage);
    const readerSourceId = getAudiobookSourceId(userMessage);
    let semanticQuery = retrievalQuestion;
    if (recentUserMessages) {
      semanticQuery = `${recentUserMessages}\n\nFollow-up question: ${retrievalQuestion}`.slice(0, 800);
    }

    let relevantContext = "";

    if (readerChapterScope) {
      const chapterSources = readerSourceId
        ? sources.filter((source) => source.id === readerSourceId)
        : sources;
      const chapterSections = chapterSources
        .map((source) => ({ source, section: extractStructuralSection(source.content || "", readerChapterScope) }))
        .filter((entry): entry is { source: (typeof sources)[number]; section: string } => Boolean(entry.section));
      if (chapterSections.length === 0) {
        return `I couldn't identify a ${readerChapterScope} section in the available source text, so I can't answer using that chapter context. Choose a source with extracted chapter headings or ask without the reader chapter context.`;
      }
      relevantContext = selectChapterEvidence(chapterSections, retrievalQuestion)
        .map(({ source, section }, index) => `[${index + 1}] Source: "${source.title}" (${source.type})\nContent: ${section}`)
        .join("\n\n");
    } else if (requestedSourceIds.size > 0) {
      // Explicit scopes must remain closed-book. Do not let semantic search add
      // notes or unrelated notebook sources behind the user's back.
      const scopedResults = await search(semanticQuery, {
        notebookId,
        types: ["source"],
        sourceIds: [...requestedSourceIds],
        limit: 5,
        useSemanticSearch: true,
        minScore: 0.05,
      });

      if (scopedResults.length > 0) {
        relevantContext = scopedResults
          .map((result, index) => {
            const contextContent = result.content.substring(0, 1500);
            return `[${index + 1}] Source: "${result.title}" (${result.type})\nContent: ${contextContent}\nRelevance Score: ${(result.score || 0).toFixed(3)}\n---`;
          })
          .join("\n\n");
      } else {
        // Keep the explicit source as a safe fallback when retrieval has no match.
        relevantContext = formatSourcesForPrompt(sources, sources.length);
      }
    } else {
      try {
        const searchResults = await search(semanticQuery, {
          notebookId,
          types: ["source", "note"],
          limit: 5,
          useSemanticSearch: true,
          minScore: 0.05,
        });

        if (searchResults.length > 0) {
          relevantContext = searchResults
            .map((result, index) => {
              const contextContent = result.content.substring(0, 1500);
              return `[${index + 1}] Source: "${result.title}" (${result.type})\nContent: ${contextContent}\nRelevance Score: ${(result.score || 0).toFixed(3)}\n---`;
            })
            .join("\n\n");
        }
      } catch (searchError) {
        console.warn("Semantic search failed, using source retrieval:", searchError);
        if (hasSourcesInNotebook) relevantContext = formatSourcesForPrompt(sources);
      }
    }

    // Generic follow-ups such as "what is this about?" can legitimately score
    // below retrieval thresholds. If usable notebook text exists, keep the
    // turn grounded by falling back to the source text itself.
    if (!relevantContext && hasSourcesInNotebook) {
      relevantContext = formatSourcesForPrompt(sources);
    }

    const hasContext = relevantContext.length > 0;
    const promptConfig = getContextualPrompt(hasContext, false);

    try {
      const { chatCompletion } = await import("@/lib/ai/ollamaService");
      const userContent = hasContext
        ? formatPrompt(promptConfig.userTemplate, {
            context: relevantContext,
            question: userMessage,
          })
        : userMessage;

      const messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }> = [
        { role: "system", content: promptConfig.system },
        // Prior notebook turns may have been grounded in another source or
        // chapter. They carry no source/chapter provenance, so including them
        // here can override the explicitly scoped reader evidence.
        ...(readerChapterScope ? [] : historyMessages),
        { role: "user", content: userContent },
      ];

      const result = await chatCompletion({
        messages,
        stream: !!onChunk,
        onChunk,
        temperature: promptConfig.temperature,
      });

      if (result?.trim()) return result;
      return "I wasn't able to generate a response. Please try again.";
    } catch (aiError) {
      console.error("AI request failed:", aiError);
      const errorMessage = aiError instanceof Error ? aiError.message : String(aiError);
      if (errorMessage.startsWith("rate_limit_exceeded")) {
        const secondsPart = errorMessage.split(":")[1];
        const seconds = secondsPart ? Number.parseInt(secondsPart, 10) : null;
        return seconds && seconds > 0
          ? `⏳ We've hit the AI rate limit. Please try again in **${seconds} second${seconds === 1 ? "" : "s"}**.`
          : "⏳ We've hit the AI rate limit. Please wait a moment and try again.";
      }
      throw aiError;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "NoUsableSourcesError") throw error;
    console.error("Critical error in generateAIResponse:", error);
    throw error instanceof Error
      ? error
      : new Error("An unexpected error occurred while processing your question.");
  }
}
