import { isSourceUsableForGroundedChat } from "../utils/sourceProcessing.js";

const questionWords = new Set("what which where when who how many there is are was were does did do the a an of in at for to by from".split(" "));
const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const equivalent = new Map([
  ["keep", "store"], ["keeps", "store"], ["kept", "store"], ["stored", "store"],
  ["located", "locate"], ["situated", "locate"],
  ["require", "need"], ["requires", "need"], ["required", "need"], ["needed", "need"],
  ["begin", "start"], ["begins", "start"], ["began", "start"], ["started", "start"],
]);
function normalized(word) {
  if (equivalent.has(word)) return equivalent.get(word);
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && /(?:ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}
const numberWord = /^(?:[0-9]+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)$/;
const negative = /\b(?:not|never|except|neither|without|no|none)\b|n['’]t\b/i;

// During a provider outage, a single matching source line can still be opened.
// Ambiguous, contextual, or oversized searches keep the normal retry response.
export function recoverStandalonePassage(error, message, sources) {
  if (error?.code !== "PROVIDER_UNAVAILABLE" || typeof message !== "string" ||
      message.length > 240 || !/^(what|which|where|when|who|how many)\b[^?!\n]*\?\s*$/i.test(message) ||
      negative.test(message) || /\b(it|its|this|that|these|those|they|their|his|her|them|he|she|above|previous|earlier|and|or|compare|summarize|chapter|section)\b/i.test(message)) throw error;
  const question = words(message);
  const terms = [...new Set(question.filter(word => !questionWords.has(word)).map(normalized))];
  // A quantity must modify the same noun phrase the reader asked to count.
  const countPhrase = [];
  if (question[0] === "how") {
    for (const word of question.slice(2)) {
      if (questionWords.has(word)) break;
      countPhrase.push(normalized(word));
    }
    if (!countPhrase.length) throw error;
  }
  if (terms.length < 2) throw error;
  const usable = sources.filter(isSourceUsableForGroundedChat);
  if (usable.reduce((total, source) => total + source.content.length, 0) > 250_000) throw error;

  let citation;
  for (const source of usable) {
    const lines = source.content.split("\n");
    for (const [offset, raw] of lines.entries()) {
      const excerpt = raw.trim();
      const tokens = words(excerpt).map(normalized);
      const vocabulary = new Set(tokens);
      if (!terms.every(word => vocabulary.has(word))) continue;
      if (negative.test(excerpt)) throw error;
      if (countPhrase.length) {
        const numbers = tokens.filter(word => numberWord.test(word));
        if (numbers.length !== 1 || /\d[.,:/–-]\d/.test(excerpt)) throw error;
        const start = tokens.indexOf(numbers[0]) + 1;
        if (!countPhrase.every((term, i) => tokens[start + i] === term)) throw error;
      }
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
