import { proseProfiles } from './source-prose-fixtures.mjs';

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').toLowerCase();
const rx = pattern => new RegExp(`^(?:${pattern})$`, 'i');
const question = '(?:in (?:the |this )?(?:cedar )?experiment|in (?:the |this )?study)';
const questions = {
  trays: rx(`how many (?:blue )?trays (?:are (?:used|there)|does the cedar experiment use)(?: ${question})?`),
  seedlings: rx(`how many (?:bean )?seedlings (?:are (?:in|planted in)|does) each tray(?: contain| have)?(?: ${question})?`),
  light: rx(`(?:how (?:long|many hours)(?: (?:are|do))? (?:the )?(?:bean )?seedlings (?:receive light|receive|are exposed to light|exposed to light)(?: (?:daily|each day))?(?: ${question})?|what is the daily light (?:exposure )?duration for (?:the )?(?:bean )?seedlings(?: ${question})?)`),
  water: rx(`(?:when|how often|at what time(?: of day)?) (?:is water measured|do (?:they|researchers) measure water)(?: ${question})?`),
  pigment: rx('what (?:is the (?:specific )?(?:role|function) of chlorophyll(?: in plants)?(?: (?:during|in) photosynthesis)?|function does chlorophyll perform during photosynthesis)'),
  conversion: rx('(?:what (?:are the inputs and outputs (?:for plants during|of(?: the)?) photosynthesis(?: process described in the study)?|(?:substances )?do plants use to produce sugars and release oxygen)|how do plants produce sugars and release oxygen)'),
  control: rx(`(?:what (?:condition|variable) distinguishes the experimental control(?: group)? from (?:the )?(?:other seedlings|test group)(?: ${question})?|how (?:does the experimental control(?: group)? differ from (?:the )?other seedlings|is (?:the )?experimental control(?: group)? treated)(?: ${question})?)`),
  comparison: rx(`(?:after how many days do researchers compare growth|when (?:do researchers compare|is) growth(?: compared)?)(?: ${question})?`),
  definition: rx('what is photosynthesis'),
  storage: rx('(?:what are the primary organic compounds produced and stored by photosynthetic organisms|which(?: specific)? organic compounds do photosynthetic organisms typically store (?:the )?converted chemical energy within|where do photosynthetic organisms store (?:the )?converted chemical energy)'),
  oxygenation: rx("what is the significance of cyanobacteria(?:'s)? appearance in evolutionary history|how did cyanobacteria contribute to (?:the )?oxygenation of earth"),
  evolution: rx('when did the first photosynthetic organisms evolve'),
  percentage: rx('(?:what (?:percentage|proportion) of (?:the )?food (?:people|humans) (?:eat|consume) (?:daily|every day) (?:is|consists of|is made up of) carbohydrates|about what percentage of (?:the )?food you eat is carbohydrates)'),
  stomata: rx('how do plants (?:obtain carbon dioxide|take in carbon dioxide)'),
  stomataDefinition: rx('what are stomata and (?:what do plants do with them|what function do they serve in plants)'),
  carbohydrateInputs: rx('how does a plant obtain the atoms needed to build carbohydrates'),
  cellulose: rx('what is cellulose(?: and (?:why is it called fiber|how do plants use it))?'),
  celluloseFunction: rx('what is the function of cellulose in plants, and how do humans consume it'),
  strength: rx('how do plants use cellulose'),
};
const rules = [
  ['cedar', 'trays', ['trays'], '(?:(?:the )?(?:cedar )?experiment uses exactly )?(?:17|seventeen)(?: blue trays)?'],
  ['cedar', 'seedlings', ['seedlings'], '(?:(?:each tray contains|there are) )?(?:three|3) bean seedlings(?: (?:in|per) each tray| per tray)?'],
  ['cedar', 'light', ['light'], '(?:(?:the )?(?:bean )?seedlings receive (?:light for )?)?(?:six|6) hours(?: of light)?(?: daily| each day| every day)?'],
  ['cedar', 'water', ['water'], '(?:water is measured |it is measured |(?:they|researchers) measure water )?(?:every|each) morning(?: during the experiment)?'],
  ['cedar', 'pigment', ['pigment'], 'chlorophyll absorbs light(?: energy)?(?: (?:during|in)(?: the process of)? photosynthesis)?'],
  ['cedar', 'conversion', ['conversion'], 'plants use carbon dioxide and water(?: as inputs)?(?: to produce sugars (?:and release|while releasing) oxygen(?: as an output)?|, converting them into sugars while releasing oxygen)'],
  ['cedar', 'pigment', ['pigment', 'conversion'], 'chlorophyll absorbs light(?: energy)?(?: which plants use|, allowing plants to use| which is (?:then )?used) to (?:convert carbon dioxide and water into sugars (?:and oxygen|while releasing oxygen)|produce sugars from carbon dioxide and water while releasing oxygen)'],
  ['cedar', 'control', ['control'], '(?:the )?experimental control(?: group)? receives the same(?: amount of)? water(?: as (?:the )?(?:other groups|other seedlings|test group))? (?:but (?:no light|is not exposed to(?: any)? light)|and (?:no light|is exposed to no light))'],
  ['cedar', 'control', ['control', 'light'], '(?:the )?experimental control(?: group)? receives the same(?: amount of)? water but no light, (?:unlike the other seedlings (?:which )?receive six hours of daily light|whereas the test group receives light)'],
  ['cedar', 'comparison', ['comparison'], '(?:researchers compare growth after )?(?:fourteen|14) days'],
  ['wikipedia-photosynthesis', 'definition', ['definition'], 'photosynthesis is a biological process by which photopigment-bearing autotrophic organisms convert light energy into chemical energy to fuel their metabolism'],
  ['wikipedia-photosynthesis', 'storage', ['storage'], '(?:these )?organisms store (?:the )?(?:converted chemical|this) energy (?:within|in) (?:the )?bonds of intracellular organic compounds, (?:typically|primarily) carbohydrates (?:like|such as) sugars \\(glucose, fructose, sucrose\\), starches, phytoglycogen, and cellulose'],
  ['wikipedia-photosynthesis', 'oxygenation', ['oxygenation'], "cyanobacteria appeared later(?: than early photosynthetic organisms)?; their production of excess oxygen directly contributed to the oxygenation of (?:the )?earth, making the evolution of complex life possible"],
  ['wikipedia-photosynthesis', 'evolution', ['evolution'], '(?:the )?first photosynthetic organisms probably evolved early in the evolutionary history of life'],
  ['ted-photosynthesis', 'percentage', ['percentage'], '(?:about|approximately) (?:60\\s*%|60 percent|sixty percent) of the food (?:people eat every day|(?:you|we) eat(?: every day)?|humans eat daily) is (?:made up of )?carbohydrates'],
  ['ted-photosynthesis', 'stomata', ['stomata'], 'plants (?:absorb|take in) carbon dioxide from the air through (?:tiny )?pores in their leaves called stomata'],
  // Complete reviewed productions; neither admits a new carbon-atoms premise or leaf location.
  ['ted-photosynthesis', 'stomataDefinition', ['airCarbonDioxide', 'skinStomata'], 'stomata are pores in plant skin through which plants breathe in carbon dioxide molecules from the air'],
  ['ted-photosynthesis', 'stomataDefinition', ['airCarbonDioxide', 'skinStomata'], 'stomata are pores located on the skin of plants that allow them to breathe in carbon dioxide molecules from the air'],
  ['ted-photosynthesis', 'carbohydrateInputs', ['airCarbonDioxide', 'skinStomata', 'rootBuildingBlocks'], 'plants drink in water from their roots to get oxygen and hydrogen atoms, as well as electrons, while they take in carbon dioxide through stomata'],
  ['ted-photosynthesis', 'strength', ['strength'], 'plants use cellulose to keep themselves strong'],
  ['ted-photosynthesis', 'cellulose', ['cellulose'], 'cellulose is a type of carbohydrate found in plants that (?:our body|humans) cannot break down'],
  ['ted-photosynthesis', 'cellulose', ['cellulose', 'fiber', 'strength'], 'cellulose is a type of carbohydrate found in plants that (?:our body|humans) cannot break down\\. (?:we call it fiber and we eat it in vegetables like lettuce, broccoli, and celery|it is called fiber and eaten in vegetables like lettuce, broccoli, and celery)\\. plants use cellulose to keep themselves strong'],
  // Reviewed paraphrase of the three adjacent retained sentences, not a general synonym rule.
  ['ted-photosynthesis', 'celluloseFunction', ['cellulose', 'fiber', 'strength'], 'cellulose is a carbohydrate that plants use to maintain structural strength; humans eat it as dietary fiber found in vegetables like lettuce and broccoli'],
].map(([profile, family, facts, pattern]) => ({profile, family, facts, answer: rx(pattern)}));


const reviewedClaims = {
  cedar: {
    trays: {subject: 'Cedar experiment', relation: 'uses', object: 'blue trays', qualifiers: {quantity: 17, unit: 'trays', precision: 'exact'}},
    seedlings: {subject: 'each tray', relation: 'contains', object: 'bean seedlings', qualifiers: {quantity: 3, unit: 'seedlings per tray'}},
    light: {subject: 'seedlings', relation: 'receive', object: 'light', qualifiers: {duration: 6, unit: 'hours', frequency: 'daily'}},
    water: {subject: 'water', relation: 'is measured', object: null, qualifiers: {frequency: 'every morning'}},
    pigment: {subject: 'chlorophyll', relation: 'absorbs', object: 'light', qualifiers: {context: 'photosynthesis', polarity: 'positive'}},
    conversion: {subject: 'plants', relation: 'use', object: ['carbon dioxide', 'water'], qualifiers: {produce: 'sugars', release: 'oxygen'}},
    control: {subject: 'experimental control', relation: 'receives', object: 'same water', qualifiers: {light: 'none'}},
    comparison: {subject: 'researchers', relation: 'compare', object: 'growth', qualifiers: {after: 14, unit: 'days'}},
  },
  'wikipedia-photosynthesis': {
    production: {subject: 'photosynthesis in plants', relation: 'produces', object: 'carbohydrates', qualifiers: {storedOrUsed: true}},
    definition: {subject: 'photopigment-bearing autotrophic organisms', relation: 'convert', object: 'light energy', qualifiers: {into: 'chemical energy', purpose: 'metabolism'}},
    storage: {subject: 'photosynthetic organisms', relation: 'store', object: 'chemical energy', qualifiers: {location: 'bonds of intracellular organic compounds', typically: ['glucose', 'fructose', 'sucrose', 'starches', 'phytoglycogen', 'cellulose']}},
    evolution: {subject: 'first photosynthetic organisms', relation: 'evolved', object: 'early in evolutionary history', qualifiers: {certainty: 'probably'}},
    oxygenation: {subject: 'cyanobacteria', relation: 'production of excess oxygen contributed directly', object: 'Earth oxygenation', qualifiers: {appeared: 'later', enabled: 'complex life', exclusiveCause: false}},
  },
  'ted-photosynthesis': {
    percentage: {subject: 'daily food people eat', relation: 'is composed of', object: 'carbohydrates', qualifiers: {quantity: 60, unit: 'percent', precision: 'about'}},
    stomata: {subject: 'plants', relation: 'absorb', object: 'carbon dioxide from air', qualifiers: {via: 'leaf pores called stomata'}},
    airCarbonDioxide: {subject: 'carbon dioxide molecules taken in by plants', relation: 'come from', object: 'air', qualifiers: {antecedent: 'immediately following skin-stomata sentence'}},
    skinStomata: {subject: 'plants', relation: 'breathe in', object: 'carbon dioxide', qualifiers: {via: 'pores in plant skin called stomata'}},
    rootBuildingBlocks: {subject: 'plants', relation: 'drink in', object: 'water', qualifiers: {via: 'roots', obtain: ['oxygen atoms', 'hydrogen atoms', 'electrons'], purpose: 'build carbohydrates'}},
    cellulose: {subject: 'cellulose', relation: 'is', object: 'plant carbohydrate', qualifiers: {humanDigestion: 'cannot break down'}},
    fiber: {subject: 'cellulose', relation: 'is called', object: 'fiber', qualifiers: {vegetables: ['lettuce', 'broccoli', 'celery'], antecedent: 'immediately preceding cellulose sentence'}},
    strength: {subject: 'plants', relation: 'use', object: 'cellulose', qualifiers: {purpose: 'keep themselves strong'}},
  },
};

/** Pure, independent and intentionally bounded. Unrecognized prose never passes. */
export function auditProseCard({card, source, profile, authorizedSourceIds}) {
  const rawFront = typeof card?.front === 'string' ? card.front : '';
  const rawBack = typeof card?.back === 'string' ? card.back : '';
  const result = { outcome: 'unaudited', claims: [], evidence: [], reasons: [], rawFront, rawBack, unmatchedSpans: [] };
  const unknown = reason => { result.reasons.push(reason); result.unmatchedSpans = [{side: 'front', text: rawFront}, {side: 'back', text: rawBack}]; return result; };
  if (!source?.id || !card?.sourceId || card.sourceId !== source.id || !Array.isArray(authorizedSourceIds) || !authorizedSourceIds.includes(source.id) || authorizedSourceIds.filter(id => id === source.id).length !== 1) return unknown('Missing, foreign or ambiguous retained source identity');
  if (!proseProfiles[profile] || typeof source.content !== 'string') return unknown('Unreviewed source profile or missing retained text');
  // Independent extractive oracle: reconstruct the retained sentence, rather than
  // trusting generator evidence or its span-selection implementation.
  if (rawFront.startsWith('Complete the source statement: ')) {
    const statement = rawFront.slice('Complete the source statement: '.length);
    if (statement.split('____').length !== 2 || !rawBack.trim() || rawBack.includes('____')) return unknown('Invalid source-completion shape');
    const reconstructed = statement.replace('____', rawBack).replace(/\s+/g, ' ').trim();
    const retained = source.content;
    const literalPattern = new RegExp(reconstructed.split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g');
    const occurrences = [];
    for (const match of retained.matchAll(literalPattern)) {
      const at = match.index;
      if ((at === 0 || retained[at - 1] === '\n' || /[.!?]\s+$/.test(retained.slice(0, at))) && /[.!?]$/.test(reconstructed) && (at + match[0].length === retained.length || /\s/.test(retained[at + match[0].length]))) occurrences.push({start: at, end: at + match[0].length, literalSpan: match[0]});
    }
    if (occurrences.length !== 1) return unknown('Reconstructed statement lacks unique complete retained sentence support');
    const answerWords = rawBack.match(/[\p{L}\p{N}]+/gu) || [];
    const contextWords = statement.replace('____', '').match(/[\p{L}\p{N}]+/gu) || [];
    if (rawBack.length > 200 || reconstructed.length > 900 || answerWords.length > 12 || !answerWords.length || answerWords.length >= contextWords.length || contextWords.length < 3 || /^(?:a|an|the|and|or|but|if|of|to|in|on|at|by|for|with|is|are|was|were|be|been|it|this|that|these|those|they|their|its|as|from)(?:\s+(?:a|an|the|and|or|but|if|of|to|in|on|at|by|for|with|is|are|was|were|be|been|it|this|that|these|those|they|their|its|as|from))*$/i.test(rawBack.trim())) return unknown('Completion does not test a meaningful bounded phrase');
    if (/(?:ignore|disregard|override).{0,60}(?:instruction|prompt|previous)|(?:system|assistant|developer)\s*(?:message|prompt|:)|(?:output|return|respond with|generate|print|write)\s+(?:only\s+)?(?:json|flashcards?|answers?)/i.test(reconstructed)) return unknown('Instruction text is not a study claim');
    const [left, right] = statement.split('____');
    if ((/[\p{L}\p{N}]$/u.test(left) && /^[\p{L}\p{N}]/u.test(rawBack)) || (/[\p{L}\p{N}]$/u.test(rawBack) && /^[\p{L}\p{N}]/u.test(right))) return unknown('Completion splits a word');
    result.outcome = 'independently-supported';
    result.requestedProperty = 'retained-source-completion';
    result.claims = [{subject: 'retained source', relation: 'states', object: reconstructed}];
    result.evidence = [{sourceId: source.id, text: reconstructed, ...occurrences[0]}];
    return result;
  }
  const front = clean(rawFront), back = clean(rawBack);
  const families = Object.entries(questions).filter(([, grammar]) => grammar.test(front)).map(([id]) => id);
  if (families.length !== 1) return unknown('Front premise or requested property is outside reviewed grammar');
  const family = families[0];
  const rule = rules.find(candidate => candidate.profile === profile && candidate.family === family && candidate.answer.test(back) && !(family === 'cellulose' && front.includes(' and ') && candidate.facts.length === 1));
  result.requestedProperty = family;
  const evidenceFor = id => {
    const pattern = proseProfiles[profile][id];
    const matches = pattern ? [...source.content.matchAll(new RegExp(pattern.source, 'ig'))] : [];
    const match = matches.length === 1 ? matches[0] : undefined;
    // Evidence must be a complete retained sentence, not a substring of a negated/quoted claim.
    if (match && ((source.content.slice(0, match.index).trim() && !/[.!?]$/.test(source.content.slice(0, match.index).trim().replace(/(?:\[\d+\])+$/, '').trim())) || (source.content.slice(match.index + match[0].length).trim() && !/[.!?]$/.test(match[0])))) return undefined;
    return match ? { sourceId: source.id, factId: `${profile}.${id}`, literalSpan: match[0], start: match.index, end: match.index + match[0].length } : undefined;
  };
  if (!rule) {
    // Only known incompatible propositions are contradictions. Novel prose stays unaudited.
    const contradiction = profile === 'cedar' && (
      (family === 'trays' && /\b(?:16|18|sixteen|eighteen) blue trays\b/.test(back)) ||
      (family === 'light' && /\b(?:5|7|five|seven) hours\b/.test(back)) ||
      (family === 'comparison' && /\b(?:13|15|thirteen|fifteen) days\b/.test(back)) ||
      (family === 'water' && /\bwater is measured (?:every|each) evening\b/.test(back)) ||
      (family === 'pigment' && /\bchlorophyll (?:absorbs water|does not absorb light)\b/.test(back)) ||
      (family === 'conversion' && /\bplants (?:consume|use) oxygen\b.*\brelease carbon dioxide\b/.test(back)) ||
      (family === 'control' && /\bcontrol(?: group)? receives (?:different water|no water|the same water but (?:some|six hours of) light)\b/.test(back))
    );
    const proof = evidenceFor(family);
    if (contradiction && proof) { result.outcome = 'contradicted'; result.evidence = [proof]; result.claims = [{factId: `${profile}.${family}`, side: 'back', text: rawBack, status: 'contradicted'}]; result.reasons.push('Recognized claim conflicts with literal retained source evidence'); result.unmatchedSpans = [{side: 'back', text: rawBack}]; return result; }
    return unknown('Answer contains an unreviewed assertion, qualifier, quantity, unit or clause');
  }
  const frontFacts = family === 'storage' && front.includes('produced and stored') ? ['production'] : [];
  const answerFacts = family === 'oxygenation' && back.includes('later than early photosynthetic organisms') ? ['evolution', ...rule.facts] : rule.facts;
  const requiredFacts = [...frontFacts, ...answerFacts];
  for (const id of requiredFacts) {
    const proof = evidenceFor(id);
    if (!proof) return unknown(`Retained source lacks reviewed literal evidence for ${profile}.${id}`);
    result.evidence.push(proof);
    // The second production uses air only to resolve "this very same", not as an extra answer claim.
    if (family === 'carbohydrateInputs' && id === 'airCarbonDioxide') continue;
    let claim = reviewedClaims[profile][id];
    if (family === 'celluloseFunction') {
      // Record only what this shorter answer asserts; digestion and celery are source context.
      if (id === 'cellulose') claim = {subject: 'cellulose', relation: 'is', object: 'plant carbohydrate', qualifiers: {}};
      if (id === 'fiber') claim = {...claim, qualifiers: {...claim.qualifiers, vegetables: ['lettuce', 'broccoli']}};
      if (id === 'strength') claim = {...claim, qualifiers: {purpose: 'maintain structural strength', reviewedParaphraseOf: 'keep themselves strong'}};
    }
    result.claims.push({ factId: `${profile}.${id}`, side: frontFacts.includes(id) ? 'front' : 'back', text: frontFacts.includes(id) ? rawFront : rawBack, status: 'supported', ...claim });
  }
  if (family === 'stomataDefinition' || family === 'carbohydrateInputs') {
    const ordered = result.evidence;
    for (let index = 1; index < ordered.length; index++) {
      if (ordered[index - 1].end > ordered[index].start || source.content.slice(ordered[index - 1].end, ordered[index].start).trim() !== '') return unknown('Unresolved TED input antecedent outside reviewed adjacent sentences');
    }
    if (family === 'stomataDefinition') result.claims.push({factId: 'ted-photosynthesis.skinStomata', side: 'back', text: rawBack, status: 'supported', subject: 'stomata', relation: 'are', object: 'pores in plant skin', qualifiers: {}});
  }
  // The fiber pronoun is authorized only when the exact reviewed sentence directly follows cellulose.
  if (rule.facts.includes('fiber')) {
    const cellulose = result.evidence.find(item => item.factId.endsWith('.cellulose'));
    const fiber = result.evidence.find(item => item.factId.endsWith('.fiber'));
    if (cellulose.end > fiber.start || source.content.slice(cellulose.end, fiber.start).trim() !== '') return unknown('Unresolved cellulose/fiber antecedent outside reviewed adjacent sentences');
  }
  if (family === 'oxygenation' && requiredFacts.includes('evolution')) {
    const early = result.evidence.find(item => item.factId.endsWith('.evolution'));
    const later = result.evidence.find(item => item.factId.endsWith('.oxygenation'));
    if (early.end > later.start || source.content.slice(early.end, later.start).replace(/\[\d+\]/g, '').trim() !== '') return unknown('Unresolved early-organisms antecedent outside reviewed adjacent sentences');
  }
  result.outcome = 'independently-supported';
  result.reasons.push('All answer prose matched reviewed grammar and literal evidence from the authorized retained source');
  return result;
}
