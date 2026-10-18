import { describe, expect, it } from 'vitest';
import { cedarFactAnswer } from '../../../../e2e/helpers/cedarFactOracle';
import { supportedCedarConnection } from '../../../../e2e/helpers/cedarMapOracle';
import { facts } from '../../../../e2e/audio-fidelity.facts.mjs';

describe('independent Cedar acceptance oracles', () => {
  it('accepts observed seedlings receiving light with directed negative controls', () => {
    expect(supportedCedarConnection({ source: 'Bean Seedlings', target: 'Light Exposure', label: 'receives' })).toBe(true);
    for (const label of ['does not receive', 'may receive', 'receives and produces']) {
      expect(supportedCedarConnection({ source: 'Bean Seedlings', target: 'Light Exposure', label })).toBe(false);
    }
    for (const connection of [
      { source: 'Light Exposure', target: 'Bean Seedlings', label: 'receives' },
      { source: 'Experimental Control', target: 'Light Exposure', label: 'receives' },
      { source: 'Controlled Variables', target: 'Light Exposure', label: 'maintains' },
      { source: 'Experimental Control', target: 'Dependent Variable', label: 'measures' },
      { source: 'Experimental Control', target: 'Independent Variable', label: 'manipulates' },
      { source: 'Bean Seedlings', target: 'Oxygen', label: 'receives' },
    ]) expect(supportedCedarConnection(connection)).toBe(false);
  });
  it('audits a control light question separately from its water treatment', () => {
    const question = 'What is the specific condition of the experimental control group regarding light exposure?';
    expect(cedarFactAnswer(question, ['It receives no light', 'It receives only indirect light', 'It receives light for twelve hours'])).toEqual({ fact: 'control receives no light', index: 0 });
    for (const unsupported of ['It receives some light', 'It may receive no light', 'It receives no light and no water']) {
      expect(() => cedarFactAnswer(question, [unsupported, 'It receives indirect light'])).toThrow();
    }
    expect(() => cedarFactAnswer(question, ['No light', 'It receives no light'])).toThrow();
    expect(() => cedarFactAnswer('What treatment does the control receive?', ['No light', 'Extra light'])).toThrow();
    expect(cedarFactAnswer('Which control light condition is incorrect?', ['No light', 'Extra light'])).toBeNull();
  });
  it('accepts the observed complete chlorophyll answer without accepting added claims', () => {
    const question = 'What is the specific role of chlorophyll in the plants described in the study?';
    expect(cedarFactAnswer(question, ['It absorbs light during photosynthesis', 'It measures water levels every morning'])).toEqual({ fact: 'chlorophyll absorbs light', index: 0 });
    for (const unsupported of ['It does not absorb light during photosynthesis', 'It absorbs light during photosynthesis and releases carbon dioxide', 'It may absorb light during photosynthesis']) {
      expect(() => cedarFactAnswer(question, [unsupported, 'It measures water levels'])).toThrow();
    }
    expect(() => cedarFactAnswer(question, ['To absorb light', 'It absorbs light'])).toThrow();
  });
  it('accepts affirmative results_in only in the source-supported direction', () => {
    expect(supportedCedarConnection({ source: 'Photosynthesis', target: 'Oxygen', label: 'results_in' })).toBe(true);
    expect(supportedCedarConnection({ source: 'Oxygen', target: 'Photosynthesis', label: 'results_in' })).toBe(false);
    for (const label of ['does not produce', 'may produce', 'produces and consumes', 'results_in_no']) {
      expect(supportedCedarConnection({ source: 'Photosynthesis', target: 'Oxygen', label })).toBe(false);
    }
    expect(supportedCedarConnection({ source: 'Photosynthesis', target: 'Nitrogen', label: 'produces' })).toBe(false);
  });
  it('preserves the control subject and no-light condition for identical-water wording', () => {
    const control = facts.find(fact => fact.id === 'control')!;
    const positive = new RegExp(control.pattern, 'i');
    expect(positive.test('The experimental control receives identical water but no light.')).toBe(true);
    expect(positive.test('The experimental control receives identical water and light.')).toBe(false);
    expect(positive.test('Seedlings receive identical water but no light.')).toBe(false);
    expect(control.forbiddenPatterns.some(pattern => new RegExp(pattern, 'i').test('The control receives identical water and light.'))).toBe(true);
  });
  it('accepts trays housing bean seedlings only as an affirmative directed relationship', () => {
    expect(supportedCedarConnection({ source: 'Blue Trays', target: 'Bean Seedlings', label: 'houses' })).toBe(true);
    expect(supportedCedarConnection({ source: 'Blue Trays', target: 'Bean Seedlings', label: 'contains' })).toBe(true);
    expect(supportedCedarConnection({ source: 'Bean Seedlings', target: 'Blue Trays', label: 'houses' })).toBe(false);
    for (const label of ['does not house', 'may house', 'houses and waters']) {
      expect(supportedCedarConnection({ source: 'Blue Trays', target: 'Bean Seedlings', label })).toBe(false);
    }
    expect(supportedCedarConnection({ source: 'Blue Trays', target: 'Tomato Plants', label: 'houses' })).toBe(false);
  });
});
