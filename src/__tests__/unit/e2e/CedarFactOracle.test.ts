import { test, expect } from 'vitest';
import { cedarFactAnswer } from '../../../../e2e/helpers/cedarFactOracle';

test('Cedar quiz oracle derives fixture answers independently and rejects ambiguous options', () => {
  const choices = ['7 blue trays', '17 blue trays', '27 blue trays', '37 blue trays'];
  expect(cedarFactAnswer('How many blue trays does the experiment use?', choices)).toEqual({ fact: '17 trays', index: 1 });
  expect(cedarFactAnswer('Which gas do plants take in during photosynthesis?', ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'])?.index).toBe(1);
  expect(cedarFactAnswer('What gas is released?', ['Not oxygen', 'Oxygen', 'Nitrogen', 'Hydrogen'])?.index).toBe(1);
  expect(() => cedarFactAnswer('How many trays are used?', ['17', 'Seventeen', '7', '27'])).toThrow();
  expect(() => cedarFactAnswer('How many trays are used?', ['7', '27', '37', '47'])).toThrow();
  expect(cedarFactAnswer('Which statement is not correct?', choices)).toBeNull();
  expect(cedarFactAnswer('What is the document title?', choices)).toBeNull();
});

test('tray count and seedlings inside each tray are independently distinguished', () => {
  expect(cedarFactAnswer('How many blue trays are used total?', ['15', '17', '20', '25']))
    .toEqual({ fact: '17 trays', index: 1 });
  expect(cedarFactAnswer('How many bean seedlings are placed inside each of the blue trays?', ['One', 'Two', 'Three', 'Four']))
    .toEqual({ fact: '3 seedlings per tray', index: 2 });
  expect(cedarFactAnswer('What is the number of blue trays used?', ['17 trays', '3 trays', '6 trays', '14 trays']))
    .toEqual({ fact: '17 trays', index: 0 });
  // An incidental mention of trays must not classify a different quantity.
  expect(cedarFactAnswer('How many days do seedlings spend in the blue trays?', ['17', '3', '6', '14']))
    .toBeNull();
  expect(() => cedarFactAnswer('How many seedlings are in each tray?', ['One', 'Two', 'Four', 'Seventeen']))
    .toThrow('3 seedlings per tray');
});

test('chlorophyll role checks option meaning without consulting generated answers or explanations', () => {
  expect(cedarFactAnswer('What is the role of chlorophyll?', [
    'To absorb water from soil', 'To release carbon dioxide into air',
    'To absorb light during photosynthesis', 'To store sugars for seedlings',
  ])).toEqual({ fact: 'chlorophyll absorbs light', index: 2 });
  expect(cedarFactAnswer('Which function does chlorophyll perform?', ['To capture sunlight', 'To store sugars']))
    .toEqual({ fact: 'chlorophyll absorbs light', index: 0 });
  expect(() => cedarFactAnswer('What is the purpose of chlorophyll?', ['To absorb water', 'To store light', 'Not to absorb light']))
    .toThrow('chlorophyll absorbs light');
  expect(() => cedarFactAnswer('What is the role of chlorophyll?', ['To absorb light', 'To capture sunlight']))
    .toThrow('exactly one');
  expect(cedarFactAnswer('Which is not a function of chlorophyll?', ['To absorb light', 'To store sugars']))
    .toBeNull();
  expect(cedarFactAnswer('How does chlorophyll affect the tray design?', ['To absorb light', 'To store sugars']))
    .toBeNull();
});


test('unsupported gas wording fails closed and does not borrow another relation', () => {
  expect(cedarFactAnswer('Which gas do plants take in as a reactant?', ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'])).toBeNull();
  expect(cedarFactAnswer('Which gas do plants take in during respiration?', ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'])).toBeNull();
});


test('incidental seedlings and trays cannot answer a different quantity relation', () => {
  for (const question of [
    'How many hours do seedlings spend in the blue trays?',
    'What is the number of days seedlings spend per tray?',
    'How many leaves do seedlings grow in each tray?',
  ]) expect(cedarFactAnswer(question, ['17', '3', '6', '14'])).toBeNull();
});
