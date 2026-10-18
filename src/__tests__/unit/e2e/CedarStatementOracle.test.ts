import { describe, expect, it } from 'vitest';
import { cedarCitationCoverage, cedarExplanationSupports, cedarStatementOracle } from '../../../../e2e/helpers/cedarStatementOracle';

describe('independent Cedar statement truth', () => {
  it.each([
    ['The Cedar experiment uses exactly 17 blue trays.', true],
    ['The Cedar experiment utilizes exactly 17 blue trays for the study.', true],
    ['The Cedar experiment utilizes exactly 15 blue trays for the study.', false],
    ['Each tray in the experiment contains three bean seedlings.', true],
    ['Each tray in the experiment contains seventeen bean seedlings.', false],
    ['The experimental control group receives light but no water.', false],
    ['The experiment contains fifteen blue trays.', false],
    ['Each blue tray holds three bean seedlings.', true],
    ['Each tray contains seventeen bean seedlings.', false],
    ['The seedlings receive sunlight for six hours each day.', true],
    ['Seedlings receive light for ten hours daily.', false],
    ['Researchers compare growth after fourteen days.', true],
    ['The researchers compared the growth after twenty days.', false],
    ['Chlorophyll absorbs light during photosynthesis.', true],
    ['The pigment chlorophyll captures light energy.', true],
    ['Chlorophyll absorbs water.', false],
    ['Plants release oxygen during photosynthesis.', true],
    ['Plants release carbon dioxide.', false],
    ['Plants use carbon dioxide and water to make sugars.', true],
    ['Plants use oxygen and water to produce sugars.', false],
    ['Water is measured every morning.', true],
    ['Water is measured each evening.', false],
    ['The experimental control receives the same amount of water but no light.', true],
    ['The control receives different water and no light.', false],
    ['The control receives same water but light.', false],
  ] as const)('audits %s from the fixed source', (statement, truth) => {
    expect(cedarStatementOracle(statement)?.truth).toBe(truth);
  });

  it.each([
    'Seventeen seedlings are placed inside each blue tray.',
    'The experiment uses 17 blue trays and receives twelve hours of light.',
    'The Cedar experiment may utilize exactly 17 blue trays for the study.',
    'The Cedar experiment utilizes exactly 17 blue trays for the study and no water.',
    'Each tray in the experiment does not contain three bean seedlings.',
    'The experimental control group receives light but no water and oxygen.',
    'Chlorophyll does not absorb light.',
    'The sky is blue.',
    'How many blue trays are used?',
    'True',
    'The label says this statement is correct.',
  ])('fails closed on unaudited or compound claim %s', statement => {
    expect(cedarStatementOracle(statement)).toBeNull();
  });
});

describe('source relation in explanations', () => {
  it('replays all three observed generated true-false explanations', () => {
    const rows = [
      ['The Cedar experiment utilizes exactly 17 blue trays for the study.', true, "The content explicitly states that 'The Cedar experiment uses exactly 17 blue trays.'"],
      ['Each tray in the experiment contains three bean seedlings.', true, "The text confirms that 'Each tray contains three bean seedlings.'"],
      ['The experimental control group receives light but no water.', false, "The content states that 'The experimental control receives the same water but no light,' which contradicts the claim that it receives light but no water."],
    ] as const;
    for (const [statement, truth, explanation] of rows) {
      const claim = cedarStatementOracle(statement)!;
      expect(claim?.truth).toBe(truth);
      expect(cedarExplanationSupports(explanation, claim)).toBe(true);
    }
  });
  it('requires the correction fact for a false statement independently of its label', () => {
    const claim = cedarStatementOracle('Each tray contains seventeen bean seedlings.')!;
    expect(claim.truth).toBe(false);
    expect(cedarExplanationSupports('Each tray contains three bean seedlings.', claim)).toBe(true);
    expect(cedarExplanationSupports('The correct answer is False.', claim)).toBe(false);
    expect(cedarExplanationSupports('Each tray contains seventeen bean seedlings.', claim)).toBe(false);
  });
  it('rejects contradictory, negated or incidental support', () => {
    const claim = cedarStatementOracle('The experiment uses 17 blue trays.')!;
    expect(cedarExplanationSupports('The experiment uses exactly 17 blue trays.', claim)).toBe(true);
    expect(cedarExplanationSupports('The experiment uses 17 blue trays. The experiment uses fifteen blue trays.', claim)).toBe(false);
    expect(cedarExplanationSupports('The experiment does not use 17 blue trays.', claim)).toBe(false);
    expect(cedarExplanationSupports('The experiment never uses 17 blue trays.', claim)).toBe(false);
    expect(cedarExplanationSupports('The unrelated example has 17 blue trays.', claim)).toBe(false);
  });
  it('keeps light duration and per-tray quantity relations separate', () => {
    const light = cedarStatementOracle('Seedlings receive light for six hours daily.')!;
    expect(cedarExplanationSupports('Six hours daily is the water measurement. Light is unrelated.', light)).toBe(false);
    const seedlings = cedarStatementOracle('Each tray holds three bean seedlings.')!;
    expect(cedarExplanationSupports('There are three bean seedlings in total.', seedlings)).toBe(false);
  });
});

describe('collective Cedar citation coverage', () => {
  const trays = 'The Cedar experiment uses exactly 17 blue trays.';
  const light = 'The seedlings receive light for six hours daily.';
  const source = `${trays} Each tray contains three bean seedlings. ${light} Water is measured every morning.`;
  it('accepts separate source excerpts for each requested fact', () => {
    expect(cedarCitationCoverage(`${trays} Each tray contains three bean seedlings.`, source)).toEqual({ trays: true, light: false });
    expect(cedarCitationCoverage(light, source)).toEqual({ trays: false, light: true });
    expect(cedarCitationCoverage(source, source)).toEqual({ trays: true, light: true });
  });
  it.each([
    'The experiment uses fifteen blue trays.',
    'The Cedar experiment does not use exactly 17 blue trays.',
    'Six hours daily is the water measurement. Light is unrelated.',
    'Water is measured every morning.',
    'Each tray contains three bean seedlings.',
    '',
  ])('rejects fabricated, negated or irrelevant excerpt %s', excerpt => {
    expect(cedarCitationCoverage(excerpt, source)).toBeNull();
  });
});
