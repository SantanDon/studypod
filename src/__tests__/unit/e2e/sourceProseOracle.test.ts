import { describe, expect, it } from 'vitest';
// @ts-expect-error Pure e2e oracle intentionally ships as executable Node ESM.
import { auditProseCard } from '../../../../e2e/source-prose-oracle.mjs';
// @ts-expect-error Synthetic evidence fixtures are shared with executable Node ESM.
import { proseFixtureSources, retainedTedInputs } from '../../../../e2e/source-prose-fixtures.mjs';

function audit(front: string, back: string, profile = 'cedar', overrides: Record<string, unknown> = {}) {
  return auditProseCard({ card: {front, back, sourceId: 'retained-source'}, source: {id: 'retained-source', content: proseFixtureSources[profile]}, profile, authorizedSourceIds: ['retained-source'], ...overrides });
}
const trayQuestion = 'How many blue trays are used in the Cedar experiment?';
const pigmentQuestion = 'What is the role of chlorophyll during photosynthesis?';
const controlQuestion = 'How is the experimental control group treated in the Cedar experiment?';
const celluloseFunctionQuestion = 'What is the function of cellulose in plants, and how do humans consume it?';
const celluloseFunctionAnswer = 'Cellulose is a carbohydrate that plants use to maintain structural strength; humans eat it as dietary fiber found in vegetables like lettuce and broccoli.';
// Exact retained TED clauses, including the antecedent for "it" in the fiber sentence.
const retainedCellulose = 'Cellulose is a type of carbohydrate found in plants that our body cannot break down. We call it fiber and we eat it in vegetables like lettuce, broccoli, and celery. Plants use cellulose to keep themselves strong.';
const stomataDefinitionQuestion = 'What are stomata and what do plants do with them?';
const stomataDefinitionAnswer = 'Stomata are pores in plant skin through which plants breathe in carbon dioxide molecules from the air.';
const carbohydrateInputsQuestion = 'How does a plant obtain the atoms needed to build carbohydrates?';
const carbohydrateInputsAnswer = 'Plants drink in water from their roots to get oxygen and hydrogen atoms, as well as electrons, while they take in carbon dioxide through stomata.';
const tedInputsSource = {id: 'retained-source', content: retainedTedInputs};
const cases = [
  [trayQuestion, 'The experiment uses exactly 17 blue trays.'],
  [trayQuestion, '17'],
  ['How many bean seedlings does each tray contain?', 'Each tray contains three bean seedlings.'],
  ['What is the daily light duration for the bean seedlings in the experiment?', 'The seedlings receive light for six hours daily.'],
  ['When is water measured?', 'Water is measured every morning.'],
  [pigmentQuestion, 'Chlorophyll absorbs light energy during the process of photosynthesis.'],
  [pigmentQuestion, 'Chlorophyll absorbs light energy which plants use to convert carbon dioxide and water into sugars and oxygen.'],
  ['What substances do plants use to produce sugars and release oxygen?', 'Plants use carbon dioxide and water to produce sugars and release oxygen.'],
  [controlQuestion, 'The experimental control receives the same water but no light.'],
  ['After how many days do researchers compare growth?', 'Researchers compare growth after fourteen days.'],
];
describe('independent source prose oracle', () => {
  it.each([
    [stomataDefinitionQuestion, stomataDefinitionAnswer, ['airCarbonDioxide', 'skinStomata']],
    [carbohydrateInputsQuestion, carbohydrateInputsAnswer, ['airCarbonDioxide', 'skinStomata', 'rootBuildingBlocks']],
  ])('supports only the complete reviewed TED input production %s', (front, back, facts) => {
    const result = audit(front as string, back as string, 'ted-photosynthesis', {source: tedInputsSource});
    expect(result.outcome).toBe('independently-supported');
    expect(result.evidence.map((e: {factId: string}) => e.factId)).toEqual((facts as string[]).map(id => `ted-photosynthesis.${id}`));
    for (const evidence of result.evidence) expect(retainedTedInputs.slice(evidence.start, evidence.end)).toBe(evidence.literalSpan);
    expect(result.claims.some((c: {qualifiers: {via?: string}}) => c.qualifiers.via === 'pores in plant skin called stomata')).toBe(true);
    expect(result.unmatchedSpans).toEqual([]);
    if (front === stomataDefinitionQuestion) expect(result.claims.some((c: {subject: string; relation: string; object: string}) => c.subject === 'stomata' && c.relation === 'are' && c.object === 'pores in plant skin')).toBe(true);
    else {
      expect(result.claims.map((c: {factId: string}) => c.factId)).toEqual(['ted-photosynthesis.skinStomata', 'ted-photosynthesis.rootBuildingBlocks']);
      expect(result.claims[1].qualifiers).toEqual({via: 'roots', obtain: ['oxygen atoms', 'hydrogen atoms', 'electrons'], purpose: 'build carbohydrates'});
    }
  });
  it.each([
    [stomataDefinitionQuestion, stomataDefinitionAnswer.replace('skin', 'leaves')],
    [stomataDefinitionQuestion, stomataDefinitionAnswer.replace('carbon dioxide', 'oxygen')],
    [stomataDefinitionQuestion, stomataDefinitionAnswer.replace('breathe in', 'release')],
    [stomataDefinitionQuestion, stomataDefinitionAnswer.replace('plants breathe', 'humans breathe')],
    [stomataDefinitionQuestion, stomataDefinitionAnswer.replace('breathe in', 'do not breathe in')],
    [stomataDefinitionQuestion, stomataDefinitionAnswer.replace('pores', 'only pores')],
    [stomataDefinitionQuestion, stomataDefinitionAnswer.replace('pores', '17 pores')],
    [stomataDefinitionQuestion, stomataDefinitionAnswer + ' They produce ATP.'],
    [stomataDefinitionQuestion, 'Stomata are pores in plant skin.'],
    [carbohydrateInputsQuestion, carbohydrateInputsAnswer.replace('roots', 'leaves')],
    [carbohydrateInputsQuestion, carbohydrateInputsAnswer.replace('oxygen and hydrogen', 'carbon and nitrogen')],
    [carbohydrateInputsQuestion, carbohydrateInputsAnswer.replace('electrons', 'protons')],
    [carbohydrateInputsQuestion, carbohydrateInputsAnswer.replace('water from their roots', 'carbon dioxide from their roots')],
    [carbohydrateInputsQuestion, carbohydrateInputsAnswer.replace('carbon dioxide through stomata', 'water through stomata')],
    [carbohydrateInputsQuestion, carbohydrateInputsAnswer.replace('drink in', 'always drink in')],
    [carbohydrateInputsQuestion, carbohydrateInputsAnswer.replace('drink in water', 'drink in 6 litres of water')],
    [carbohydrateInputsQuestion, carbohydrateInputsAnswer + ' They do this without sunlight.'],
    [carbohydrateInputsQuestion, 'Plants take in carbon dioxide through stomata.'],
    ['What are stomata and how many are there?', stomataDefinitionAnswer],
    ['How does a plant obtain the atoms needed to build proteins?', carbohydrateInputsAnswer],
    ['How do plants obtain the carbon atoms needed to build carbohydrates?', 'Plants breathe in carbon dioxide molecules through pores in their skin called stomata to get the necessary carbon atoms.'],
  ])('rejects changed, partial or unsupported TED input prose %s / %s', (front, back) => {
    expect(audit(front, back, 'ted-photosynthesis', {source: tedInputsSource}).outcome).toBe('unaudited');
  });
  it.each([
    retainedTedInputs.replace(/It actually.*?molecules\. /, ''),
    retainedTedInputs.replace(/Plants are going.*?stomata\. /, ''),
    retainedTedInputs.replace(/ Plants drink.*$/, ''),
    retainedTedInputs.replace('Plants are going', 'Other gases come from elsewhere. Plants are going'),
    retainedTedInputs.replace('Plants drink', 'Other plants obtain nitrogen. Plants drink'),
    retainedTedInputs + ' ' + retainedTedInputs,
    retainedTedInputs.replace('Plants are going', 'It is false that Plants are going'),
    retainedTedInputs.replace('Plants drink', 'It is false that Plants drink'),
    retainedTedInputs.replace('It actually', 'It is false that It actually'),
    retainedTedInputs.replace('stomata.', 'stomata'),
    retainedTedInputs.replace('carbon dioxide through', 'oxygen through'),
  ])('requires every complete unique TED input literal and adjacency %#', content => {
    expect(audit(carbohydrateInputsQuestion, carbohydrateInputsAnswer, 'ted-photosynthesis', {source: {id: 'retained-source', content}}).outcome).toBe('unaudited');
  });
  it.each([
    retainedTedInputs.replace(/It actually.*?molecules\. /, ''),
    retainedTedInputs.replace(/Plants are going.*?stomata\. /, ''),
    retainedTedInputs.replace('Plants are going', 'Other gases come from elsewhere. Plants are going'),
    retainedTedInputs + ' ' + retainedTedInputs,
    retainedTedInputs.replace('Plants are going', 'It is false that Plants are going'),
  ])('requires the independent stomata definition proofs %#', content => {
    expect(audit(stomataDefinitionQuestion, stomataDefinitionAnswer, 'ted-photosynthesis', {source: {id: 'retained-source', content}}).outcome).toBe('unaudited');
  });
  it('keeps new TED input productions bound to the authorized source and rejects leaf substitution', () => {
    expect(audit(stomataDefinitionQuestion, stomataDefinitionAnswer, 'ted-photosynthesis', {source: {...tedInputsSource, id: 'foreign'}}).outcome).toBe('unaudited');
    expect(audit(carbohydrateInputsQuestion, carbohydrateInputsAnswer, 'ted-photosynthesis', {source: tedInputsSource, authorizedSourceIds: []}).outcome).toBe('unaudited');
    expect(audit(stomataDefinitionQuestion, stomataDefinitionAnswer, 'ted-photosynthesis').outcome).toBe('unaudited');
    expect(audit('How do plants obtain carbon dioxide?', 'Plants absorb carbon dioxide from the air through pores in their leaves called stomata.', 'ted-photosynthesis', {source: tedInputsSource}).outcome).toBe('unaudited');
  });
  it.each(cases)('supports the reviewed question %s / %s', (front, back) => {
    const result = audit(front, back);
    expect(result.outcome).toBe('independently-supported');
    expect(result.claims.length).toBeGreaterThan(0);
    for (const evidence of result.evidence) {
      expect(evidence.sourceId).toBe('retained-source');
      expect(proseFixtureSources.cedar.slice(evidence.start, evidence.end)).toBe(evidence.literalSpan);
    }
    expect(result.unmatchedSpans).toEqual([]);
  });
  it.each([
    [trayQuestion, 'The experiment uses exactly 18 blue trays.'],
    ['What is the daily light duration for the bean seedlings in the experiment?', 'The seedlings receive seven hours of light daily.'],
    ['After how many days do researchers compare growth?', 'Researchers compare growth after thirteen days.'],
    ['When is water measured?', 'Water is measured every evening.'],
    [pigmentQuestion, 'Chlorophyll absorbs water.'],
    [pigmentQuestion, 'Chlorophyll does not absorb light.'],
    [controlQuestion, 'The experimental control receives different water.'],
    [controlQuestion, 'The experimental control receives no water.'],
    [controlQuestion, 'The experimental control receives the same water but some light.'],
  ])('detects a reviewed contradiction %s / %s', (front, back) => expect(audit(front, back).outcome).toBe('contradicted'));
  it.each([
    [trayQuestion, 'The experiment uses exactly 17 litres.'],
    [trayQuestion, 'The experiment uses exactly 17 blue trays and 51 seedlings.'],
    [pigmentQuestion, 'Chlorophyll absorbs light and plants consume oxygen and release carbon dioxide.'],
    [pigmentQuestion, 'Chlorophyll absorbs light, which is necessary for photosynthesis.'],
    [pigmentQuestion, 'Chlorophyll emits oxygen.'],
    [controlQuestion, 'The control does not receive the same water but no light.'],
    [controlQuestion, 'The experimental control receives the same water but not no light.'],
    ['When is water measured?', 'Water is measured every morning using a pipette.'],
    ['How many blue trays are used and how are they manufactured?', '17'],
    ['Why does chlorophyll absorb water?', 'Chlorophyll absorbs light.'],
  ])('fails closed on unreviewed or mixed prose %s / %s', (front, back) => expect(audit(front, back).outcome).toBe('unaudited'));
  it.each([
    {card: {front: trayQuestion, back: '17', sourceId: 'foreign'}},
    {card: {front: trayQuestion, back: '17'}},
    {authorizedSourceIds: []},
    {authorizedSourceIds: ['retained-source', 'retained-source']},
    {source: {id: 'retained-source', content: 'Unrelated source.'}},
    {source: {id: 'retained-source', content: 'It is false that The Cedar experiment uses exactly 17 blue trays.'}},
    {profile: 'unreviewed'},
  ])('rejects missing or ambiguous independent evidence %#', override => expect(audit(trayQuestion, '17', 'cedar', override).outcome).toBe('unaudited'));
  it('checks both claims in a compound answer', () => {
    const result = audit(pigmentQuestion, cases[6][1]);
    expect(result.evidence.map((item: {factId: string}) => item.factId)).toEqual(['cedar.pigment', 'cedar.conversion']);
    expect(audit(pigmentQuestion, cases[6][1], 'cedar', {source: {id: 'retained-source', content: 'Chlorophyll absorbs light during photosynthesis.'}}).outcome).toBe('unaudited');
  });
  it('preserves raw text and unmatched spans for unknown claims', () => {
    const result = audit(trayQuestion, '17, plus an invented claim.');
    expect(result.rawBack).toBe('17, plus an invented claim.');
    expect(result.unmatchedSpans.some((item: {text: string}) => item.text === result.rawBack)).toBe(true);
  });
  it('supports the approximate percentage but never strengthens it to exact', () => {
    const front = 'What percentage of food people eat every day is carbohydrates?';
    expect(audit(front, 'About 60% of the food people eat every day is made up of carbohydrates.', 'ted-photosynthesis').outcome).toBe('independently-supported');
    expect(audit(front, 'Exactly 60% of the food people eat every day is made up of carbohydrates.', 'ted-photosynthesis').outcome).toBe('unaudited');
    expect(audit(front, 'About 61% of the food people eat every day is made up of carbohydrates.', 'ted-photosynthesis').outcome).toBe('unaudited');
  });
  it('covers every listed carbohydrate and intracellular location', () => {
    const front = 'Which specific organic compounds do photosynthetic organisms typically store the converted chemical energy within?';
    const back = 'Organisms store converted chemical energy within bonds of intracellular organic compounds, primarily carbohydrates like sugars (glucose, fructose, sucrose), starches, phytoglycogen, and cellulose.';
    expect(audit(front, back, 'wikipedia-photosynthesis').outcome).toBe('independently-supported');
    expect(audit(front, back.replace('cellulose', 'protein'), 'wikipedia-photosynthesis').outcome).toBe('unaudited');
    expect(audit(front, back.replace('intracellular', 'extracellular'), 'wikipedia-photosynthesis').outcome).toBe('unaudited');
  });
  it('preserves evolutionary uncertainty and nonexclusive causal qualification', () => {
    const front = 'When did the first photosynthetic organisms evolve?';
    expect(audit(front, 'The first photosynthetic organisms probably evolved early in the evolutionary history of life.', 'wikipedia-photosynthesis').outcome).toBe('independently-supported');
    expect(audit(front, 'The first photosynthetic organisms evolved early in the evolutionary history of life.', 'wikipedia-photosynthesis').outcome).toBe('unaudited');
  });
  it('resolves fiber only within its reviewed adjacent cellulose sentences', () => {
    const front = 'What is cellulose and why is it called fiber?';
    const back = 'Cellulose is a type of carbohydrate found in plants that our body cannot break down. We call it fiber and we eat it in vegetables like lettuce, broccoli, and celery. Plants use cellulose to keep themselves strong.';
    const result = audit(front, back, 'ted-photosynthesis');
    expect(result.outcome).toBe('independently-supported');
    expect(result.evidence).toHaveLength(3);
    const separated = proseFixtureSources['ted-photosynthesis'].replace('We call it fiber', 'Starch is another carbohydrate. We call it fiber');
    expect(audit(front, back, 'ted-photosynthesis', {source: {id: 'retained-source', content: separated}}).outcome).toBe('unaudited');
    expect(audit(front, back.replace('cannot', 'can'), 'ted-photosynthesis').outcome).toBe('unaudited');
  });
  it('supports the reviewed definition and nonexclusive oxygenation claim', () => {
    expect(audit('What is photosynthesis?', 'Photosynthesis is a biological process by which photopigment-bearing autotrophic organisms convert light energy into chemical energy to fuel their metabolism.', 'wikipedia-photosynthesis').outcome).toBe('independently-supported');
    const front = "What is the significance of cyanobacteria's appearance in evolutionary history?";
    const back = 'Cyanobacteria appeared later than early photosynthetic organisms; their production of excess oxygen directly contributed to the oxygenation of Earth, making the evolution of complex life possible.';
    expect(audit(front, back, 'wikipedia-photosynthesis').outcome).toBe('independently-supported');
    expect(audit(front, back.replace('directly contributed', 'was the only cause contributing'), 'wikipedia-photosynthesis').outcome).toBe('unaudited');
  });
  it('requires the property asked on the front rather than a nearby true fact', () => {
    expect(audit('How do plants use cellulose?', 'Cellulose is a type of carbohydrate found in plants that our body cannot break down.', 'ted-photosynthesis').outcome).toBe('unaudited');
    expect(audit('What is cellulose and why is it called fiber?', 'Cellulose is a type of carbohydrate found in plants that our body cannot break down.', 'ted-photosynthesis').outcome).toBe('unaudited');
    expect(audit('How do plants use cellulose?', 'Plants use cellulose to keep themselves strong.', 'ted-photosynthesis').outcome).toBe('independently-supported');
  });
  it('rejects duplicated or embedded source assertions rather than guessing provenance', () => {
    const source = {id: 'retained-source', content: proseFixtureSources.cedar + ' The Cedar experiment uses exactly 17 blue trays.'};
    expect(audit(trayQuestion, '17', 'cedar', {source}).outcome).toBe('unaudited');
  });
  it('does not auto-admit new plausible provider topics', () => {
    expect(audit('What is the primary function of the Calvin cycle?', 'The Calvin cycle incorporates atmospheric carbon dioxide into organic compounds.', 'wikipedia-photosynthesis').outcome).toBe('unaudited');
    expect(audit('Why is ATP an energy currency?', 'ATP powers cellular work.', 'ted-photosynthesis').outcome).toBe('unaudited');
  });
  it('audits original retained website wording and bracket citations', () => {
    const content = 'The carbohydrates produced are stored in or used by the plant. Photosynthesis[note 1] is a system of biological processes by which photopigment-bearing autotrophic organisms, such as most plants, algae and cyanobacteria, convert light energy—typically from sunlight—into the chemical energy necessary to fuel their metabolism. Photosynthetic organisms store the converted chemical energy within the bonds of intracellular organic compounds (complex compounds containing carbon), typically carbohydrates like sugars (mainly glucose, fructose and sucrose), starches, phytoglycogen and cellulose. The first photosynthetic organisms probably evolved early in the evolutionary history of life using reducing agents such as hydrogen or hydrogen sulfide, rather than water, as sources of electrons.[7] Cyanobacteria appeared later; the excess oxygen they produced contributed directly to the oxygenation of the Earth,[8] which rendered the evolution of complex life possible.';
    const override = {source: {id: 'retained-source', content}};
    const profile = 'wikipedia-photosynthesis';
    expect(audit('What is photosynthesis?', 'Photosynthesis is a biological process by which photopigment-bearing autotrophic organisms convert light energy into chemical energy to fuel their metabolism.', profile, override).outcome).toBe('independently-supported');
    expect(audit('What are the primary organic compounds produced and stored by photosynthetic organisms?', 'Organisms store converted chemical energy within bonds of intracellular organic compounds, primarily carbohydrates like sugars (glucose, fructose, sucrose), starches, phytoglycogen, and cellulose.', profile, override).outcome).toBe('independently-supported');
    const front = "What is the significance of cyanobacteria's appearance in evolutionary history?";
    const back = 'Cyanobacteria appeared later than early photosynthetic organisms; their production of excess oxygen directly contributed to the oxygenation of Earth, making the evolution of complex life possible.';
    const result = audit(front, back, profile, override);
    expect(result.outcome).toBe('independently-supported');
    expect(result.evidence.map((e: {factId: string}) => e.factId)).toEqual([profile + '.evolution', profile + '.oxygenation']);
    for (const evidence of result.evidence) expect(content.slice(evidence.start, evidence.end)).toBe(evidence.literalSpan);
    expect(audit(front, back, profile, {source: {id: 'retained-source', content: content.replace(/The first photosynthetic organisms.*?electrons\.\[7\] /, '')}}).outcome).toBe('unaudited');
    expect(audit(front, back, profile, {source: {id: 'retained-source', content: content.replace('electrons.[7] ', 'electrons.[7] A different organism appeared. ')}}).outcome).toBe('unaudited');
  });
  it('audits source-dependent premises on the front', () => {
    const front = 'What are the primary organic compounds produced and stored by photosynthetic organisms?';
    const back = 'Organisms store converted chemical energy within bonds of intracellular organic compounds, primarily carbohydrates like sugars (glucose, fructose, sucrose), starches, phytoglycogen, and cellulose.';
    const result = audit(front, back, 'wikipedia-photosynthesis');
    expect(result.outcome).toBe('independently-supported');
    expect(result.claims[0].side).toBe('front');
    const content = proseFixtureSources['wikipedia-photosynthesis'].replace('The carbohydrates produced are stored in or used by the plant. ', '');
    expect(audit(front, back, 'wikipedia-photosynthesis', {source: {id: 'retained-source', content}}).outcome).toBe('unaudited');
    expect(audit('How do plants obtain the carbon atoms needed to build carbohydrates?', 'Plants absorb carbon dioxide from the air through pores in their leaves called stomata.', 'ted-photosynthesis').outcome).toBe('unaudited');
  });
  it('uses the full original percentage sentence and never infers leaf pores from skin', () => {
    const source = {id: 'retained-source', content: 'Well, about 60% of the food you eat is carbohydrates. Plants are going to breath in this very same carbon dioxide through pores in their skin, called stomata.'};
    expect(audit('About what percentage of the food you eat is carbohydrates?', 'About 60% of the food you eat is carbohydrates.', 'ted-photosynthesis', {source}).outcome).toBe('independently-supported');
    expect(audit('How do plants obtain carbon dioxide?', 'Plants absorb carbon dioxide from the air through pores in their leaves called stomata.', 'ted-photosynthesis', {source}).outcome).toBe('unaudited');
  });
  it('supports the narrowly reviewed retained cellulose paraphrase with all three literal proofs', () => {
    const source = {id: 'retained-source', content: retainedCellulose};
    const result = audit(celluloseFunctionQuestion, celluloseFunctionAnswer, 'ted-photosynthesis', {source});
    expect(result.outcome).toBe('independently-supported');
    expect(result.evidence.map((e: {factId: string}) => e.factId)).toEqual(['ted-photosynthesis.cellulose', 'ted-photosynthesis.fiber', 'ted-photosynthesis.strength']);
    for (const evidence of result.evidence) expect(source.content.slice(evidence.start, evidence.end)).toBe(evidence.literalSpan);
    expect(result.claims[0].qualifiers).toEqual({});
    expect(result.claims[1].qualifiers.vegetables).toEqual(['lettuce', 'broccoli']);
    expect(result.claims[2].qualifiers.reviewedParaphraseOf).toBe('keep themselves strong');
  });
  it.each([
    celluloseFunctionAnswer.replace('maintain structural strength', 'increase immunity'),
    celluloseFunctionAnswer.replace('maintain structural strength', 'not maintain structural strength'),
    celluloseFunctionAnswer.replace('maintain structural strength', 'maintain structural strength in all conditions'),
    celluloseFunctionAnswer.replace('eat it', 'digest it'),
    celluloseFunctionAnswer.replace('lettuce and broccoli', 'lettuce and potatoes'),
    celluloseFunctionAnswer.replace('a carbohydrate', '60% carbohydrate'),
    celluloseFunctionAnswer + ' Humans can break it down.',
    'Cellulose is a type of carbohydrate found in plants that our body cannot break down.',
  ])('does not admit changed or incomplete cellulose paraphrases: %s', back => {
    expect(audit(celluloseFunctionQuestion, back, 'ted-photosynthesis', {source: {id: 'retained-source', content: retainedCellulose}}).outcome).toBe('unaudited');
  });
  it.each([
    retainedCellulose.replace('Cellulose is a type of carbohydrate found in plants that our body cannot break down. ', ''),
    retainedCellulose.replace('We call it fiber and we eat it in vegetables like lettuce, broccoli, and celery. ', ''),
    retainedCellulose.replace(' Plants use cellulose to keep themselves strong.', ''),
    retainedCellulose.replace('We call it fiber', 'Starch is another carbohydrate. We call it fiber'),
    retainedCellulose.replace('Plants use cellulose', 'It is false that plants use cellulose'),
  ])('requires every retained cellulose proof and its correct antecedent %#', content => {
    expect(audit(celluloseFunctionQuestion, celluloseFunctionAnswer, 'ted-photosynthesis', {source: {id: 'retained-source', content}}).outcome).toBe('unaudited');
  });
  it('does not use a nearby leaf chloroplast sentence to corroborate a leaf stomata claim', () => {
    const content = 'Plants are going to breath in this very same carbon dioxide through pores in their skin, called stomata. It is a special plant organelle inside the leaves of plants called a chloroplast.';
    const back = 'Plants absorb carbon dioxide molecules from the air through pores in their leaves called stomata.';
    expect(audit('How do plants obtain the carbon atoms needed to build carbohydrates?', back, 'ted-photosynthesis', {source: {id: 'retained-source', content}}).outcome).toBe('unaudited');
    expect(audit('How do plants obtain carbon dioxide?', back.replace(' molecules', ''), 'ted-photosynthesis', {source: {id: 'retained-source', content}}).outcome).toBe('unaudited');
  });

});

describe('independent source-completion evidence', () => {
  it('supports the observed stomata wording only with adjacent retained air and skin evidence', () => {
    const question = 'What are stomata and what function do they serve in plants?';
    const answer = 'Stomata are pores located on the skin of plants that allow them to breathe in carbon dioxide molecules from the air.';
    const content = 'It actually all starts with the air you are exhaling this very minute, specifically the carbon dioxide molecules. Plants are going to breath in this very same carbon dioxide through pores in their skin, called stomata.';
    expect(audit(question, answer, 'ted-photosynthesis', {source: {id: 'retained-source', content}}).outcome).toBe('independently-supported');
    expect(audit(question, answer.replace('skin', 'leaves'), 'ted-photosynthesis', {source: {id: 'retained-source', content}}).outcome).toBe('unaudited');
    expect(audit(question, answer, 'ted-photosynthesis', {source: {id: 'retained-source', content: content.split('. ')[1]}}).outcome).toBe('unaudited');
  });
  const front = 'Complete the source statement: The seedlings receive light for ____ daily.';
  it('supports exact reconstruction and reports original retained offsets', () => {
    const content = 'The Cedar experiment uses exactly 17 blue trays.\nThe seedlings receive light for six\n hours daily.';
    const result = audit(front, 'six hours', 'cedar', { source: { id: 'retained-source', content } });
    expect(result.outcome).toBe('independently-supported');
    expect(content.slice(result.evidence[0].start, result.evidence[0].end)).toBe(result.evidence[0].literalSpan);
  });
  it('supports a complete retained statement after a document heading', () => {
    const content = '# Source heading\nThe seedlings receive light for six hours daily.';
    expect(audit(front, 'six hours', 'cedar', {source: {id: 'retained-source', content}}).outcome).toBe('independently-supported');
  });
  it.each([
    [front, 'seven hours'],
    ['Complete the source statement: The bean seedlings receive light for ____ daily.', 'six hours'],
    ['Complete the source statement: The seedlings receive light for ____ ____ daily.', 'six hours'],
    ['Complete the source statement: ____ seedlings receive light for six hours daily.', 'The'],
    ['Complete the source statement: The seed____ receive light for six hours daily.', 'lings'],
  ])('does not admit unsupported or trivial completions %s', (question, answer) => {
    expect(audit(question, answer).outcome).not.toBe('independently-supported');
  });
  it('does not accept duplicated or negated retained support', () => {
    for (const content of ['The seedlings receive light for six hours daily. The seedlings receive light for six hours daily.', 'It is false that The seedlings receive light for six hours daily.']) {
      expect(audit(front, 'six hours', 'cedar', { source: { id: 'retained-source', content } }).outcome).not.toBe('independently-supported');
    }
  });
  it('preserves genuine unsupported freeform negatives seen in the full flow', () => {
    const failures = [
      ['How are researchers monitoring water levels in the experiment?', 'Researchers measure the water every morning.'],
      ['How do researchers measure water usage in the study?', 'Water is measured every morning.'],
      ["What is the role of chlorophyll in the bean seedlings’ process?", 'Chlorophyll absorbs light during photosynthesis.'],
      ['What is the function of chlorophyll during photosynthesis?', 'Chlorophyll absorbs light to facilitate photosynthesis, a process where plants use carbon dioxide and water to produce sugars and release oxygen.'],
    ];
    for (const [question, answer] of failures) expect(audit(question, answer).outcome).not.toBe('independently-supported');
  });
  it.each([
    ['What do plants use to produce sugars and release oxygen?', 'Plants use carbon dioxide and water to produce sugars and release oxygen.'],
    ['What is the daily light exposure duration for the bean seedlings in this study?', 'The seedlings receive light for six hours daily.'],
  ])('accepts reviewed lexical variants without adding new claims %s', (question, answer) => {
    expect(audit(question, answer).outcome).toBe('independently-supported');
  });
});
