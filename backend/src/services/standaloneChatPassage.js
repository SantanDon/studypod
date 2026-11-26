import { isSourceUsableForGroundedChat } from "../utils/sourceProcessing.js";

const questionWords = new Set("what which where when who is are was were does did do the a an of in at for to by from".split(" "));
const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

// During a provider outage, a single matching source line can still be opened.
// Ambiguous, contextual, or oversized searches keep the normal retry response.
export function recoverStandalonePassage(error, message, sources) {
  if (error?.code !== "PROVIDER_UNAVAILABLE" || typeof message !== "string" ||
      message.length > 240 || !/^(what|which|where|when|who)\b[^?!\n]*\?\s*$/i.test(message) ||
      /\b(it|this|that|these|those|they|their|his|her|them|not|never|except|and|or|compare|summarize|chapter|section)\b/i.test(message)) throw error;
  const terms = [...new Set(words(message).filter(word => !questionWords.has(word)))];
  if (terms.length < 2) throw error;
  const usable = sources.filter(isSourceUsableForGroundedChat);
  if (usable.reduce((total, source) => total + source.content.length, 0) > 250_000) throw error;

  let citation;
  for (const source of usable) {
    const lines = source.content.split("\n");
    for (const [offset, raw] of lines.entries()) {
      const excerpt = raw.trim();
      const vocabulary = new Set(words(excerpt));
      if (!terms.every(word => vocabulary.has(word))) continue;
      if (citation || excerpt.length > 320 || excerpt.length < 12 ||
          !/[.!]$/.test(excerpt) || /[<>\[\]`]/.test(excerpt)) throw error;
      citation = { citation_id: 1, source_id: source.id, source_type: source.type || "unknown",
        source_title: source.title || source.id, excerpt, chunk_lines_from: offset + 1, chunk_lines_to: offset + 1 };
    }
  }
  if (!citation) throw error;
  return {
    answer: `AI is temporarily unavailable. Your source contains this matching passage:\n\n“${citation.excerpt}” [1]`,
    citations: [citation], groundedSources: [citation.source_id], tokensUsed: 0,
  };
}
