// Independent, bounded statement grammar. Unknown/compound claims fail closed.
export type CedarStatement = { fact: string; truth: boolean; support: string; evidence: RegExp };
const numbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, fourteen: 14, fifteen: 15, seventeen: 17, twenty: 20 };
const numeric = '(\\d+|one|two|three|four|five|six|seven|eight|ten|fourteen|fifteen|seventeen|twenty)';

export function cedarStatementOracle(statement: string): CedarStatement | null {
  const text = statement.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!]$/, '');
  const quantities = [
    { fact: '17 blue trays', value: 17, pattern: `^(?:the cedar experiment|the experiment) (?:uses|used|contains|utilizes) (?:exactly )?${numeric} blue trays(?: for the study)?$`, support: 'The Cedar experiment uses exactly 17 blue trays.', evidence: /\b(?:cedar experiment|experiment)\b.{0,30}\b(?:uses|used|contains|utilizes)\s+(?:exactly\s+)?(?:17|seventeen)\s+blue trays\b/i },
    { fact: '3 bean seedlings per tray', value: 3, pattern: `^(?:each (?:blue )?tray(?: in the experiment)? (?:contains|contained|holds)) ${numeric} bean seedlings$`, support: 'Each tray contains three bean seedlings.', evidence: /(?:each (?:blue )?tray.{0,50}(?:three|3) bean seedlings|(?:three|3) bean seedlings.{0,50}(?:each|per) (?:blue )?tray)/i },
    { fact: '6 hours daily light', value: 6, pattern: `^(?:the )?seedlings (?:receive|received|are exposed to) (?:light|sunlight) for ${numeric} hours (?:daily|each day|per day)$`, support: 'The seedlings receive light for six hours daily.', evidence: /(?:light.{0,50}(?:six|6)[ -]hours?.{0,30}(?:daily|day)|(?:six|6)[ -]hours?.{0,30}(?:daily|day).{0,50}light)/i },
    { fact: '14 days before growth comparison', value: 14, pattern: `^(?:the )?researchers compare(?:d)? (?:the )?growth after ${numeric} days$`, support: 'Researchers compare growth after fourteen days.', evidence: /\b(?:compar\w*.{0,30}growth|growth.{0,30}compar\w*).{0,50}(?:fourteen|14) days\b/i },
  ];
  for (const entry of quantities) {
    const match = text.match(new RegExp(entry.pattern));
    if (match) return { ...entry, truth: (numbers[match[1]] ?? Number(match[1])) === entry.value };
  }
  const atomic = [
    { fact: 'chlorophyll absorbs light', pattern: /^(?:the pigment )?chlorophyll (?:absorbs|captures) (light|sunlight|light energy|water|oxygen|carbon dioxide)(?: during photosynthesis)?$/, correct: /^(?:light|sunlight|light energy)$/, support: 'Chlorophyll absorbs light during photosynthesis.', evidence: /\bchlorophyll\b.{0,40}\b(?:absorbs?|captures?)\s+(?:light|sunlight|light energy)\b/i },
    { fact: 'oxygen is released', pattern: /^(?:the )?plants release (oxygen|carbon dioxide)(?: during photosynthesis)?$/, correct: /^oxygen$/, support: 'Plants use carbon dioxide and water to produce sugars and release oxygen.', evidence: /\b(?:release|releases|released|releasing)\s+oxygen\b/i },
    { fact: 'carbon dioxide and water are inputs', pattern: /^(?:the )?plants use (carbon dioxide|oxygen) and water to (?:produce|make) sugars(?: during photosynthesis)?$/, correct: /^carbon dioxide$/, support: 'Plants use carbon dioxide and water to produce sugars and release oxygen.', evidence: /\b(?:use|uses|using)\s+carbon dioxide and water\b/i },
    { fact: 'morning water measurement', pattern: /^water is measured (?:every|each) (morning|evening|afternoon|night)$/, correct: /^morning$/, support: 'Water is measured every morning.', evidence: /\bwater\b.{0,30}\bmeasur\w*\b.{0,30}\bmorning\b/i },
    { fact: 'equal water and no light control', pattern: /^(?:the )?(?:experimental )?control(?: group)? receives (?:the )?(same|different) (?:amount of )?water (?:but|and) (no light|light)$/, correct: /^same no light$/, support: 'The experimental control receives the same water but no light.', evidence: /\bcontrol\b.{0,60}\bsame\b.{0,40}\bwater\b.{0,40}\bno light\b/i },
    { fact: 'equal water and no light control', pattern: /^(?:the )?(?:experimental )?control(?: group)? receives (light but no water)$/, correct: /^same no light$/, support: 'The experimental control receives the same water but no light.', evidence: /\bcontrol\b.{0,60}\bsame\b.{0,40}\bwater\b.{0,40}\bno light\b/i },
  ];
  for (const entry of atomic) {
    const match = text.match(entry.pattern);
    if (match) return { fact: entry.fact, truth: entry.correct.test(match.slice(1).join(' ')), support: entry.support, evidence: entry.evidence };
  }
  return null;
}

// Citation excerpts can cover different claims. Require literal source text and
// an affirmative fixture relation in each excerpt, then aggregate claim coverage.
export function cedarCitationCoverage(excerpt: string, source: string): { trays: boolean; light: boolean } | null {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const text = normalize(excerpt);
  if (!text || !normalize(source).includes(text)) return null;
  const sentences = text.split(/[.!?]\s*/);
  const trays = sentences.some(sentence => /\b(?:the cedar experiment|the experiment) uses exactly (?:17|seventeen) blue trays\b/i.test(sentence));
  const light = sentences.some(sentence => /\b(?:the )?seedlings receive light for (?:six|6) hours daily\b/i.test(sentence));
  return trays || light ? { trays, light } : null;
}

export function cedarExplanationSupports(explanation: string, expected: CedarStatement): boolean {
  // The explanation must state the fixture relation, rather than echo the label.
  const sentences = explanation.split(/[.!?]\s*/);
  if (!sentences.some(sentence => expected.evidence.test(sentence))) return false;
  // Negation near a matching fact cannot serve as positive supporting evidence.
  if (sentences.some(sentence => expected.evidence.test(sentence) && /\b(?:not|never|incorrect|false)\b/i.test(sentence))) return false;
  return !sentences.some(sentence => {
    const claim = cedarStatementOracle(sentence);
    return claim?.fact === expected.fact && !claim.truth;
  });
}
