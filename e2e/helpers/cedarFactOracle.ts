// A bounded, independent fixture oracle: never consult generated labels or explanations.
// Unknown wording is explicitly unaudited, rather than counted as factual evidence.
export function cedarFactAnswer(question: string, options: string[]): { fact: string; index: number } | null {
  const prompt = question.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\b(?:not|never|cannot|can['’]t|couldn['’]t|isn['’]t|aren['’]t|doesn['’]t|without|except|incorrect|false|least)\b/.test(prompt)) return null;
  if (/\bcontrol\b/.test(prompt) && /how many hours|how (?:long|much).*light|hours of.*light|daily duration of light/.test(prompt)) return null;
  // A recognized answer family does not excuse a contradictory numeric premise.
  // These literal quantities come from full-flow-fixtures, not model labels.
  const number = '(?:[-+]?\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[ -]\\w+)?)';
  for (const [unit, expected] of [
    ['(?:blue\\s+)?trays', /^(?:17|seventeen)$/],
    ['(?:bean\\s+)?seedlings', /^(?:3|three)$/],
    ['hours?(?:\\s+of)?\\s+(?:daily\\s+)?light', /^(?:6|six)$/],
    ['days', /^(?:14|fourteen)$/],
  ] as const) {
    for (const match of prompt.matchAll(new RegExp('(?<![\\w.])(' + number + ')\\s+' + unit + '\\b', 'g'))) {
      if (!expected.test(match[1])) return null;
    }
  }
  // Retained synthetic questions: anchor the complete relation, including subject and products.
  const dailyLightExposure = /^what (?:is the daily duration of light exposure (?:provided to|for) the bean seedlings(?: in the experiment)?|daily duration of light exposure is provided to the bean seedlings in the experiment)[?]?$/;
  const sugarReactant = /^which substance do plants (?:utilize|absorb) along with water to produce sugars during photosynthesis[?]?$/;
  // Recognize a bounded comparison relation, including both named groups. The
  // distinction is light; a general control-treatment question still needs water.
  const controlRole = '(?:the )?(?:experimental )?control(?: group)?';
  const treatmentRole = '(?:the )?(?:(?:main )?treatment group|experimental group)';
  const comparisonContext = '(?: in this study| in this experiment| in the cedar experiment)?';
  const controlComparison = new RegExp('^(?:(?:' +
    '(?:what|which) (?:specific |primary |main |key )?condition distinguishes ' + controlRole + ' from ' + treatmentRole + '|' +
    'what is (?:the )?(?:primary |main |key )?difference between (?:' + treatmentRole + ' and ' + controlRole + '|' + controlRole + ' and ' + treatmentRole + ')|' +
    'how does ' + controlRole + ' differ from ' + treatmentRole +
    ')' + comparisonContext + '|what distinguishes ' + controlRole + ' from the other trays in the study)[?]?$');
  const controlNoLight = /^(?:(?:it|the (?:experimental )?control(?: group)?) receives )?no light[.!]?$/;
  const controlWaterNoLight = /^(?:(?:they receive|it receives|the (?:experimental )?control(?: group)? receives) )?(?:(?:the )?same (?:amount of )?water (?:but|and) no light|no light (?:but|and) (?:the )?same (?:amount of )?water)[.!]?$/;
  if (controlComparison.test(prompt)) {
    const matches = options.map((option, index) => ({ option: option.toLowerCase().replace(/\s+/g, ' ').trim(), index }))
      .filter(entry => controlNoLight.test(entry.option) || controlWaterNoLight.test(entry.option));
    if (matches.length !== 1) throw new Error('Recognized Cedar comparison must have exactly one independently supported option');
    return { fact: controlWaterNoLight.test(matches[0].option) ? 'control receives equal water and no light' : 'control receives no light', index: matches[0].index };
  }
  const facts: { fact: string; asks: RegExp; answer: RegExp }[] = [
    { fact: 'control receives no light', asks: /(?:what|which|how).*control.*(?:light exposure|light condition)|(?:what|which).*(?:light exposure|light condition).*control|(?:what|which).*condition.*control.*light exposure/, answer: /^(?:(?:it|the control(?: group)?) receives )?no light[.!]?$/ },
    { fact: '17 trays', asks: /\b(?:how many|(?:the )?number of) (?:blue )?trays\b/, answer: /^(?:17|seventeen)(?: blue)?(?: trays)?[.!]?$/ },
    { fact: '3 seedlings per tray', asks: /\bhow many (?:bean )?seedlings\b.*(?:each|per|a single|in (?:a|the)).*tray|\bnumber of (?:bean )?seedlings\b.*(?:each|per).*tray/, answer: /^(?:3|three)(?: bean)?(?: seedlings)?(?: per tray)?[.!]?$/ },
    { fact: '6 hours of daily light', asks: /how many hours.*light|how (?:long|much).*light.*(?:daily|each day|per day)|hours of.*light|daily duration of light exposure/, answer: /^(?:6|six)(?: hours)?(?: (?:daily|each day|per day))?[.!]?$/ },
    { fact: '14 days before growth comparison', asks: /(?:how many|after how many).*days.*(?:growth|compar)|(?:when|how long).*(?:compar.*growth|growth.*compar)/, answer: /^(?:after )?(?:14|fourteen)(?: days)?[.!]?$/ },
    { fact: 'morning water measurement', asks: /(?:when|what time|how often).*water.*measur|(?:when|what time|how often).*measur.*water/, answer: /^(?:(?:every|each) )?morning(?:s)?[.!]?$/ },
    { fact: 'chlorophyll absorbs light', asks: /\b(?:what|which)\b.*\b(?:role|function|purpose)\b.*\bchlorophyll\b|\b(?:what|which)\b.*\bchlorophyll\b.*\b(?:role|function|purpose|do)\b/, answer: /^(?:(?:to )?(?:absorb|capture)|(?:absorbing|capturing)|(?:it|chlorophyll) (?:absorbs|captures)) (?:light|sunlight|light energy)(?: (?:during|for) photosynthesis)?[.!]?$/ },
    { fact: 'chlorophyll absorbs light', asks: /(?:which|what).*(?:pigment|absorbs? light)/, answer: /^chlorophyll[.!]?$/ },
    { fact: 'carbon dioxide is the gas input', asks: new RegExp(/(?:which|what).*gas.*(?:take(?:n)? in|use|reactant|absorb)/.source + '|' + sugarReactant.source), answer: /^(?:carbon dioxide|co2|co₂)(?: \((?:co2|co₂)\))?[.!]?$/ },
    { fact: 'oxygen is the released gas', asks: /(?:which|what).*gas.*(?:releas|produc)/, answer: /^(?:oxygen|o2|o₂)(?: \((?:o2|o₂)\))?[.!]?$/ },
    { fact: 'control receives equal water and no light', asks: new RegExp(/(?:what|which|how).*(?:control).*(?:receiv|condition|treat)|(?:what|which).*(?:condition|treat).*control/.source + '|' + controlComparison.source), answer: /^(?:(?:they receive|it receives|the (?:experimental )?control(?: group)? receives) )?(?:(?:the )?same (?:amount of )?water (?:but|and) no light|no light (?:but|and) (?:the )?same (?:amount of )?water)[.!]?$/ },
  ];
  // Only supported question relations are independently answerable here.
  // Keep the control as the question's subject; treatment facts do not establish growth results.
  const controlTreatment = /^(?:what (?:treatment|conditions?) does (?:the )?(?:experimental )?control(?: group)? receive|what does (?:the )?(?:experimental )?control(?: group)? receive|how (?:is (?:the )?(?:experimental )?control(?: group)?|are the seedlings in the (?:experimental )?control(?: group)?) treated(?: in the cedar experiment| differently from those receiving light)?)[?]?$/;
  const gasOutput = /^(?:(?:which|what) gas (?:is (?:released|produced)(?: by (?:plants?|the plant))?|do (?:plants?|the plants) (?:release|produce)|does (?:a plant|the plant) (?:release|produce))(?: during photosynthesis|in photosynthesis)?|what specific gas do plants release as a result of using carbon dioxide and water during photosynthesis)[?]?$/;
  const gasInput = /^(?:which|what) gas (?:is (?:taken in|used|absorbed)(?: by (?:plants?|the plant))?|do (?:plants?|the plants) (?:take in|use|absorb)|does (?:a plant|the plant) (?:take in|use|absorb))(?: during photosynthesis|in photosynthesis)?[?]?$/;
  if (/\bgas\b/.test(prompt) && !gasOutput.test(prompt) && !gasInput.test(prompt)) return null;
  const dailyDuration = /^(?:how many hours of (?:daily )?light(?: (?:daily|each day|every day|per day)| (?:do (?:the )?trays|does (?:each|a|the) tray) receive(?: (?:daily|each day|every day|per day))?)?|how (?:long|much) (?:light (?:does (?:each|a|the) tray|do (?:the )?trays) (?:receive|get)|(?:does (?:each|a|the) tray|do (?:the )?trays) (?:receive|get) light) (?:daily|each day|every day|per day))[?]?$/;
  // Explicit fixture relation: substance absorbed BY chlorophyll, not the pigment
  // that absorbs light. Anchor the full wording to reject swapped entities/topics.
  const chlorophyllSubstance = /^which substance is identified in the content as being absorbed by chlorophyll during photosynthesis[?]?$/;
  if (chlorophyllSubstance.test(prompt)) {
    const matches = options.map((option, index) => ({ option: option.toLowerCase().replace(/\s+/g, ' ').trim(), index }))
      .filter(entry => /^light[.!]?$/.test(entry.option));
    if (matches.length !== 1) throw new Error('Recognized Cedar fact must have exactly one independently supported option: chlorophyll absorbs light');
    return { fact: 'chlorophyll absorbs light', index: matches[0].index };
  }
  const fact = facts.find(entry => entry.asks.test(prompt));
  if (!fact) return null;
  if (fact.fact === '6 hours of daily light' && !dailyDuration.test(prompt) && !dailyLightExposure.test(prompt)) return null;
  if (fact.fact === 'control receives equal water and no light' && !controlTreatment.test(prompt) && !controlComparison.test(prompt)) return null;
  if (fact.fact === 'oxygen is the released gas' && !gasOutput.test(prompt)) return null;
  if (fact.fact === 'carbon dioxide is the gas input' && !gasInput.test(prompt) && !sugarReactant.test(prompt)) return null;
  const matches = options.map((option, index) => ({ option: option.toLowerCase().replace(/\s+/g, ' ').trim(), index }))
    .filter(entry => fact.answer.test(entry.option));
  if (matches.length !== 1) throw new Error(`Recognized Cedar fact must have exactly one independently supported option: ${fact.fact}`);
  return { fact: fact.fact, index: matches[0].index };
}

// Every generated question must be independently gradable before any score is
// treated as evidence. Unsupported wording fails closed, never as a factual pass.
export function auditCedarQuizAnswers(questions: { id: string; question: string; options: string[]; correctAnswer: number }[]): { questionId: string; fact: string; expectedAnswer: number }[] {
  return questions.map(question => {
    const independent = cedarFactAnswer(question.question, question.options);
    if (!independent) throw new Error('Cedar quiz question is not independently auditable: ' + question.id);
    if (question.correctAnswer !== independent.index) throw new Error('Generated quiz label disagrees with independent source fact: ' + independent.fact);
    return { questionId: question.id, fact: independent.fact, expectedAnswer: independent.index };
  });
}
