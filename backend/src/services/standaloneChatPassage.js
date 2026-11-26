import { isSourceUsableForGroundedChat } from "../utils/sourceProcessing.js";

const questionWords = new Set("what which where when who how many there is are was were does did do the a an of in on at for to by from with".split(" "));
const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const equivalent = new Map([
  ["keep", "store"], ["keeps", "store"], ["kept", "store"], ["stored", "store"],
  ["located", "locate"], ["situated", "locate"],
  ["require", "need"], ["requires", "need"], ["required", "need"], ["needed", "need"],
  ["begin", "start"], ["begins", "start"], ["began", "start"], ["started", "start"], ["starts", "start"],
]);
function normalized(word) {
  if (equivalent.has(word)) return equivalent.get(word);
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && /(?:ch|sh|ss|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}
// Match common active and passive verb inflections in either direction.
function forms(token) {
  const base = normalized(token);
  if (token.endsWith("ied") && token.length > 4) return [base, token.slice(0, -3) + "y"];
  if (!token.endsWith("ed") || token.length < 5) return [base];
  const root = token.slice(0, -2);
  return [base, root, root + "e", ...(root.length > 2 && root.at(-1) === root.at(-2) ? [root.slice(0, -1)] : [])];
}

// Attribute questions often name the property while the passage gives only its value.
const properties = [
  { prompt: /^what (?:colou?r|shade)\b/i, omit: ["color", "colour", "shade"],
    evidence: /\b(?:colou?r|black|white|gr[ae]y|red|orange|yellow|green|blue|purple|brown|pink|violet|turquoise|indigo|silver|gold|cyan|magenta|teal|navy|maroon|amber)\b/i },
  { prompt: /^what (?:temperature|heat)\b/i, omit: ["temperature", "heat"],
    evidence: /\b(?:degrees?|celsius|fahrenheit|kelvin)\b|°[CF]?/i },
  { prompt: /^what (?:material|substance)\b|^what\b.*\bmade (?:of|from)\?$/i, omit: ["material", "substance", "made", "used"],
    evidence: /\b(?:made (?:of|from)|composed of|built from|wood(?:en)?|steel|iron|alumin(?:ium|um)|copper|glass|rubber|plastic|ceramic|clay|cotton|wool|linen|silk|polyester|leather|paper|cardboard|stone|granite|brass|bronze|nylon|bamboo)\b/i },
  { prompt: /^how long\b/i, omit: ["long"],
    evidence: /\b(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|met(?:re|er)s?|inches|feet|miles?)\b/i },
];
const countModifier = /^(?:[a-z]{3,}(?:ed|ic|al|en|less|ful)|small|large|medium|new|old|extra|spare|fresh|dry|wet|empty|full|heavy|light|lithium|steel|glass|plastic|wood|copper|paper|cotton|ceramic)$/i;
const numberWord = /^(?:[0-9]+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)$/;
const negative = /\b(?:not|never|except|neither|without|no|none)\b|n['’]t\b/i;

// During a provider outage, a single matching source line can still be opened.
// Ambiguous, contextual, or oversized searches keep the normal retry response.
export function recoverStandalonePassage(error, message, sources) {
  if (error?.code !== "PROVIDER_UNAVAILABLE" || typeof message !== "string" ||
      message.length > 240 || !/^(what|which|where|when|who|how (?:many|long|does|do|did))\b[^?!\n]*\?\s*$/i.test(message) ||
      negative.test(message) || /\b(it|its|this|that|these|those|they|their|his|her|them|he|she|above|previous|earlier|and|or|compare|summarize|chapter|section)\b/i.test(message)) throw error;
  const question = words(message);
  const property = properties.find(({ prompt }) => prompt.test(message));
  const terms = [...new Set(question.filter(word => !questionWords.has(word) && !property?.omit.includes(word)))];
  // A quantity must modify the same noun phrase the reader asked to count.
  const countPhrase = [];
  if (question[0] === "how" && question[1] === "many") {
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
      const rawTokens = words(excerpt);
      const tokens = rawTokens.map(normalized);
      const vocabulary = new Set(rawTokens.flatMap(forms));
      if (!terms.every(word => forms(word).some(term => vocabulary.has(term)))) continue;
      if (property && !property.evidence.test(excerpt)) continue;
      if (negative.test(excerpt) || /[.!?]\s+\p{Lu}/u.test(excerpt)) throw error;
      if (countPhrase.length) {
        const numbers = tokens.filter(word => numberWord.test(word));
        if (numbers.length !== 1 || /\d[.,:/–-]\d/.test(excerpt)) throw error;
        let start = tokens.indexOf(numbers[0]) + 1;
        while (tokens[start] !== countPhrase[0] && countModifier.test(rawTokens[start] || "")) start++;
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
