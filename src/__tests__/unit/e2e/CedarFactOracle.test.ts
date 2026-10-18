import { test, expect } from 'vitest';
import { auditCedarQuizAnswers, cedarFactAnswer } from '../../../../e2e/helpers/cedarFactOracle';

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

test('full control treatment accepts retained wording and requires both source facts', () => {
  const question = 'How are the seedlings in the experimental control group treated differently from those receiving light?';
  const observed = ['They receive less water', 'They receive no light but the same amount of water', 'They are placed in a darker room with more water', 'They do not receive any water at all'];
  expect(cedarFactAnswer(question, observed)).toEqual({ fact: 'control receives equal water and no light', index: 1 });
  for (const supported of ['The same water but no light', 'No light and the same water', 'It receives the same amount of water and no light', 'The experimental control receives no light but the same water']) {
    expect(cedarFactAnswer(question, ['They receive less water', supported])).toEqual({ fact: 'control receives equal water and no light', index: 1 });
  }
  for (const unsupported of [
    'They receive less water', 'They are placed in a darker room with more water', 'They do not receive any water at all',
    'No light', 'It receives no light', 'They receive the same amount of water and light',
    'They receive no light but a different amount of water',
    'They receive no light but the same amount of water and extra nutrients',
    'They receive light but the same amount of water',
    'They receive the same light but no water',
    'The seedlings receiving light receive no light but the same amount of water',
    'They receive no light but the same amount of water and grow less',
    'They do not receive no light but the same amount of water',
    'They may receive no light but the same amount of water',
  ]) expect(() => cedarFactAnswer(question, [unsupported, 'Extra light and water'])).toThrow('exactly one');
  expect(() => cedarFactAnswer(question, [observed[1], 'The same water but no light'])).toThrow('exactly one');
  expect(cedarFactAnswer('Which control treatment is incorrect?', observed)).toBeNull();
});

test('control treatment cannot be borrowed for a swapped subject or unsupported experimental result', () => {
  const options = ['They receive no light but the same amount of water', 'They receive less water'];
  for (const question of [
    'How are the seedlings receiving light treated differently from the experimental control group?',
    'What treatment do the seedlings receiving light receive compared with the experimental control?',
    'What results does the experimental control receive after treatment?',
    'How much growth does the experimental control receive after treatment?',
    'Which treatment made the control seedlings grow less?',
  ]) {
    expect(cedarFactAnswer(question, options)).toBeNull();
    expect(() => auditCedarQuizAnswers([{ id: 'unsupported-control-relation', question, options, correctAnswer: 0 }]))
      .toThrow('not independently auditable');
  }
  for (const question of [
    'What treatment does the control receive?',
    'What does the experimental control group receive?',
    'How is the experimental control group treated in the Cedar experiment?',
  ]) expect(cedarFactAnswer(question, options)).toEqual({ fact: 'control receives equal water and no light', index: 0 });
});

test('retained full treatment audit still rejects a generated wrong answer label', () => {
  const item = {
    id: 'synthetic-control-treatment',
    question: 'How are the seedlings in the experimental control group treated differently from those receiving light?',
    options: ['They receive less water', 'They receive no light but the same amount of water', 'They are placed in a darker room with more water', 'They do not receive any water at all'],
    correctAnswer: 1,
  };
  expect(auditCedarQuizAnswers([item])).toEqual([{questionId: item.id, fact: 'control receives equal water and no light', expectedAnswer: 1}]);
  expect(() => auditCedarQuizAnswers([{...item, correctAnswer: 0}])).toThrow();
});


test('daily duration paraphrase preserves the six-hour source relation', () => {
  const question = 'What is the daily duration of light exposure for the bean seedlings?';
  const options = ['Three hours', 'Six hours', 'Nine hours', 'Twelve hours'];
  expect(cedarFactAnswer(question, options)).toEqual({ fact: '6 hours of daily light', index: 1 });
  expect(auditCedarQuizAnswers([{ id: 'daily-exposure', question, options, correctAnswer: 1 }]))
    .toEqual([{ questionId: 'daily-exposure', fact: '6 hours of daily light', expectedAnswer: 1 }]);
  expect(() => auditCedarQuizAnswers([{ id: 'daily-exposure', question, options, correctAnswer: 0 }]))
    .toThrow('label disagrees');
  expect(() => cedarFactAnswer(question, ['Six hours', '6 hours', 'Nine hours', 'Twelve hours']))
    .toThrow('exactly one');
  expect(() => cedarFactAnswer(question, ['Three hours', 'Six days', 'Nine hours', 'Twelve hours']))
    .toThrow('exactly one');
  for (const unsupported of [
    'What is the daily duration of light exposure for the control bean seedlings?',
    'What is the daily duration of light exposure for the six bean seedlings?',
    'What is the daily duration of light exposure for the bean seedlings receiving nine hours of light?',
    'What is the daily duration of darkness exposure for the bean seedlings?',
    'What is the daily duration of light exposure for the bean seedlings after growth comparison?',
    'What is not the daily duration of light exposure for the bean seedlings?',
  ]) expect(cedarFactAnswer(unsupported, options)).toBeNull();
});

test('released-gas paraphrase preserves carbon dioxide and water inputs and oxygen output', () => {
  const question = 'What specific gas do plants release as a result of using carbon dioxide and water during photosynthesis?';
  const options = ['Carbon monoxide', 'Nitrogen', 'Oxygen', 'Hydrogen'];
  expect(cedarFactAnswer(question, options)).toEqual({ fact: 'oxygen is the released gas', index: 2 });
  expect(auditCedarQuizAnswers([{ id: 'released-gas', question, options, correctAnswer: 2 }]))
    .toEqual([{ questionId: 'released-gas', fact: 'oxygen is the released gas', expectedAnswer: 2 }]);
  expect(() => auditCedarQuizAnswers([{ id: 'released-gas', question, options, correctAnswer: 0 }]))
    .toThrow('label disagrees');
  expect(() => cedarFactAnswer(question, ['Oxygen', 'O2', 'Nitrogen', 'Hydrogen']))
    .toThrow('exactly one');
  expect(() => cedarFactAnswer(question, ['Carbon dioxide', 'Nitrogen', 'Oxygen and carbon dioxide', 'Hydrogen']))
    .toThrow('exactly one');
  for (const unsupported of [
    'What specific gas do plants use as a result of releasing carbon dioxide and water during photosynthesis?',
    'What specific gas do plants take in as a result of releasing carbon dioxide and water during photosynthesis?',
    'What specific gas do plants release as a result of using oxygen and water during photosynthesis?',
    'What specific gas do plants release as a result of using carbon monoxide and water during photosynthesis?',
    'What specific gas do plants release as a result of using carbon dioxide and oxygen during photosynthesis?',
    'What specific gas do plants release as a result of using carbon dioxide and water during respiration?',
    'What specific gas do plants not release as a result of using carbon dioxide and water during photosynthesis?',
    'What specific gas do plants release as a result of using carbon dioxide and water during photosynthesis and respiration?',
  ]) expect(cedarFactAnswer(unsupported, options)).toBeNull();
});


test('observed experiment light-duration wording retains source subject and six-hour uniqueness', () => {
  const question = 'What daily duration of light exposure is provided to the bean seedlings in the experiment?';
  const options = ['Four hours', 'Six hours', 'Eight hours', 'Twelve hours'];
  expect(cedarFactAnswer(question, options)).toEqual({ fact: '6 hours of daily light', index: 1 });
  expect(auditCedarQuizAnswers([{ id: 'experiment-daily-light', question, options, correctAnswer: 1 }]))
    .toEqual([{ questionId: 'experiment-daily-light', fact: '6 hours of daily light', expectedAnswer: 1 }]);
  expect(() => auditCedarQuizAnswers([{ id: 'experiment-daily-light', question, options, correctAnswer: 2 }]))
    .toThrow('label disagrees');
  for (const unsupportedOptions of [
    ['Six hours', '6 hours', 'Eight hours', 'Twelve hours'],
    ['Four hours', 'Six days', 'Eight hours', 'Twelve hours'],
    ['Four hours', 'Six hours and extra water', 'Eight hours', 'Twelve hours'],
  ]) expect(() => cedarFactAnswer(question, unsupportedOptions)).toThrow('exactly one');
  for (const unsupported of [
    'What daily duration of light exposure is provided to the control bean seedlings in the experiment?',
    'What daily duration of light exposure is provided to the six bean seedlings in the experiment?',
    'What daily duration of light exposure is provided to the bean seedlings receiving eight hours of light in the experiment?',
    'What daily duration of darkness exposure is provided to the bean seedlings in the experiment?',
    'What daily duration of light exposure is provided by the bean seedlings in the experiment?',
    'What daily duration of light exposure is provided to the bean seedlings in the experiment after fourteen days?',
    'What daily duration of light exposure is not provided to the bean seedlings in the experiment?',
  ]) expect(cedarFactAnswer(unsupported, options)).toBeNull();
});

test('observed sugar-reactant wording accepts carbon dioxide without reversing inputs and outputs', () => {
  const question = 'Which substance do plants utilize along with water to produce sugars during photosynthesis?';
  const options = ['Nitrogen', 'Oxygen', 'Carbon dioxide', 'Hydrogen'];
  expect(cedarFactAnswer(question, options)).toEqual({ fact: 'carbon dioxide is the gas input', index: 2 });
  expect(auditCedarQuizAnswers([{ id: 'sugar-reactant', question, options, correctAnswer: 2 }]))
    .toEqual([{ questionId: 'sugar-reactant', fact: 'carbon dioxide is the gas input', expectedAnswer: 2 }]);
  expect(() => auditCedarQuizAnswers([{ id: 'sugar-reactant', question, options, correctAnswer: 1 }]))
    .toThrow('label disagrees');
  for (const unsupportedOptions of [
    ['Carbon dioxide', 'CO2', 'Oxygen', 'Nitrogen'],
    ['Carbon monoxide', 'Oxygen', 'Carbon dioxide and nitrogen', 'Hydrogen'],
    ['Nitrogen', 'Oxygen', 'Sugars', 'Hydrogen'],
  ]) expect(() => cedarFactAnswer(question, unsupportedOptions)).toThrow('exactly one');
  for (const unsupported of [
    'Which substance do plants produce along with water to utilize sugars during photosynthesis?',
    'Which substance do plants release along with water to produce sugars during photosynthesis?',
    'Which substance do plants utilize along with oxygen to produce sugars during photosynthesis?',
    'Which substance do plants utilize along with sugars to produce water during photosynthesis?',
    'Which substance do plants utilize along with water to produce oxygen during photosynthesis?',
    'Which substance do plants utilize along with water to produce sugars during respiration?',
    'Which substance do plants not utilize along with water to produce sugars during photosynthesis?',
    'Which substance do plants utilize along with water to produce sugars during photosynthesis and respiration?',
  ]) expect(cedarFactAnswer(unsupported, options)).toBeNull();
});

test('observed experiment light-duration phrasing preserves subject, quantity and unique labels', () => {
  const question = 'What is the daily duration of light exposure for the bean seedlings in the experiment?';
  const options = ['Four hours', 'Six hours', 'Eight hours', 'Twelve hours'];
  expect(cedarFactAnswer(question, options)).toEqual({ fact: '6 hours of daily light', index: 1 });
  expect(cedarFactAnswer(question, [...options].reverse())?.index).toBe(2);
  expect(() => auditCedarQuizAnswers([{ id: 'observed-light', question, options, correctAnswer: 2 }])).toThrow('label disagrees');
  expect(() => cedarFactAnswer(question, ['Six hours', '6 hours', 'Eight hours', 'Twelve hours'])).toThrow('exactly one');
  expect(() => cedarFactAnswer(question, ['Four hours', 'Eight hours', 'Ten hours', 'Twelve hours'])).toThrow('exactly one');
  for (const unsupported of [
    'What is the daily duration of light exposure for the control bean seedlings in the experiment?',
    'What is the daily duration of light exposure for the blue trays in the experiment?',
    'What is the daily duration of light exposure for the bean seedlings receiving eight hours in the experiment?',
    'What is the daily duration of light exposure not provided to the bean seedlings in the experiment?',
    'What is the daily duration of darkness exposure for the bean seedlings in the experiment?',
  ]) expect(cedarFactAnswer(unsupported, options)).toBeNull();
});

test('observed absorb wording preserves the plants water-to-sugars input relation', () => {
  const question = 'Which substance do plants absorb along with water to produce sugars during photosynthesis?';
  const options = ['Nitrogen', 'Oxygen', 'Carbon dioxide', 'Hydrogen'];
  expect(cedarFactAnswer(question, options)).toEqual({ fact: 'carbon dioxide is the gas input', index: 2 });
  expect(cedarFactAnswer(question, [...options].reverse())?.index).toBe(1);
  expect(() => auditCedarQuizAnswers([{ id: 'observed-absorb', question, options, correctAnswer: 1 }])).toThrow('label disagrees');
  expect(() => cedarFactAnswer(question, ['Carbon dioxide', 'CO2', 'Oxygen', 'Nitrogen'])).toThrow('exactly one');
  expect(() => cedarFactAnswer(question, ['Nitrogen', 'Oxygen', 'Carbon monoxide', 'Hydrogen'])).toThrow('exactly one');
  for (const unsupported of [
    'Which substance do chlorophyll absorb along with water to produce sugars during photosynthesis?',
    'Which substance do plants release along with water to produce sugars during photosynthesis?',
    'Which substance do plants not absorb along with water to produce sugars during photosynthesis?',
    'Which substance do plants absorb along with water to produce oxygen during photosynthesis?',
    'Which substance do plants absorb along with sugars to produce water during photosynthesis?',
    'Which substance do plants absorb along with water to produce sugars during respiration?',
    'Which substance do plants invent along with water to produce sugars during photosynthesis?',
  ]) expect(cedarFactAnswer(unsupported, options)).toBeNull();
});


test('observed experimental/control comparison preserves the exact water and light relationship', () => {
  const question = 'What is the primary difference between the experimental group and the control group in this study?';
  const options = [
    'The control group receives no water',
    'The control group receives the same water but no light',
    'The control group uses different types of seedlings',
    'The control group is measured only in the evening',
  ];
  expect(cedarFactAnswer(question, options)).toEqual({ fact: 'control receives equal water and no light', index: 1 });
  expect(cedarFactAnswer(question, [...options].reverse())?.index).toBe(2);
  expect(auditCedarQuizAnswers([{ question, options, correctAnswer: 1 }])).toHaveLength(1);
  expect(() => auditCedarQuizAnswers([{ question, options, correctAnswer: 0 }])).toThrow();
  expect(() => auditCedarQuizAnswers([{ question, options, correctAnswer: 2 }])).toThrow();
  expect(() => cedarFactAnswer(question, [options[1], 'The control group receives no light but the same water'])).toThrow();
  expect(() => cedarFactAnswer(question, [
    'The control group receives no water and no light',
    'The control group receives the same water and light',
    'The experimental group receives the same water but no light',
    'The control group receives less water but no light',
    'The control group receives the same water but no light and grows faster',
  ])).toThrow();
  for (const unsupported of [
    'What is the primary difference between the experimental group and the researchers in this study?',
    'What is the primary difference between the experimental group and the blue trays in this study?',
    'What is the primary difference between the experimental group and the control group in another study?',
    'What is not the primary difference between the experimental group and the control group in this study?',
    'What is the primary difference in growth between the experimental group and the control group in this study?',
    'What is the primary difference between the experimental group and the control group that receives no water in this study?',
  ]) expect(cedarFactAnswer(unsupported, options)).toBeNull();
});


test('bounded control comparison accepts the observed light distinction without inventing water claims', () => {
  const observed = 'What specific condition distinguishes the experimental control from the main treatment group?';
  const options = ['It receives no water', 'It uses a different type of tray', 'It receives no light', 'It contains fewer seedlings'];
  for (const question of [
    observed,
    'Which key condition distinguishes the control group from the experimental group in the Cedar experiment?',
    'How does the experimental control differ from the main treatment group in this study?',
    'What is the main difference between the control group and the treatment group in this experiment?',
    'What is the primary difference between the experimental group and the control group in this study?',
  ]) expect(cedarFactAnswer(question, options)).toEqual({ fact: 'control receives no light', index: 2 });
  expect(cedarFactAnswer(observed, [options[2], options[0], options[1], options[3]])).toEqual({ fact: 'control receives no light', index: 0 });
  expect(auditCedarQuizAnswers([{ id: 'synthetic-comparison', question: observed, options, correctAnswer: 2 }])).toEqual([{ questionId: 'synthetic-comparison', fact: 'control receives no light', expectedAnswer: 2 }]);
  expect(() => auditCedarQuizAnswers([{ id: 'synthetic-comparison', question: observed, options, correctAnswer: 0 }])).toThrow(/label disagrees/);
  expect(cedarFactAnswer(observed, ['The control receives the same water but no light', options[0], options[1], options[3]])).toEqual({ fact: 'control receives equal water and no light', index: 0 });
});

test('control comparison rejects unsupported options, contradictory additions and ambiguous answers', () => {
  const question = 'What specific condition distinguishes the experimental control from the main treatment group?';
  const distractors = ['It receives no water', 'It uses a different type of tray', 'It contains fewer seedlings'];
  for (const unsupported of [
    'It receives less light',
    'It receives the same light',
    'The experimental group receives no light',
    'It receives no light and grows less',
    'It receives no light and no water',
    'It receives no light but less water',
    'It may receive no light',
    'It receives no nutrients',
  ]) expect(() => cedarFactAnswer(question, [unsupported, ...distractors])).toThrow(/exactly one independently supported option/);
  expect(() => cedarFactAnswer(question, ['No light', 'It receives no light', ...distractors])).toThrow(/exactly one independently supported option/);
  expect(() => cedarFactAnswer(question, ['It receives no light', 'The same water but no light', ...distractors])).toThrow(/exactly one independently supported option/);
  expect(() => cedarFactAnswer('How is the experimental control group treated?', ['It receives no light', ...distractors])).toThrow(/exactly one independently supported option/);
});

test('control comparison requires a bounded relation between the named experiment roles', () => {
  const options = ['It receives no light', 'It receives no water', 'It uses different trays', 'It contains fewer seedlings'];
  for (const unsupported of [
    'What specific condition distinguishes the experimental control from the researchers?',
    'How does the main treatment group differ from the experimental control?',
    'What specific condition distinguishes the main treatment group from the experimental control?',
    'What specific condition distinguishes the experimental control from the main treatment group in another study?',
    'What specific condition distinguishes the experimental control from the main treatment group that receives no water?',
    'What is the difference in growth between the experimental group and the control group?',
    'What condition does not distinguish the experimental control from the main treatment group?',
    'What condition distinguishes the experimental control?',
    'What condition distinguishes the experimental control from the main treatment group after fourteen days?',
    'Why does the experimental control receive no light compared with the main treatment group?',
  ]) expect(cedarFactAnswer(unsupported, options)).toBeNull();
});

test('retained chlorophyll gerund answers preserve the light absorption relation', () => {
  const question = 'What is the primary function of chlorophyll during photosynthesis?';
  const options = ['Releasing oxygen', 'Absorbing light', 'Producing sugars', 'Absorbing water'];
  expect(cedarFactAnswer(question, options)).toEqual({ fact: 'chlorophyll absorbs light', index: 1 });
  expect(cedarFactAnswer(question, [...options].reverse())?.index).toBe(2);
  expect(auditCedarQuizAnswers([{ id: 'retained-chlorophyll', question, options, correctAnswer: 1 }]))
    .toEqual([{ questionId: 'retained-chlorophyll', fact: 'chlorophyll absorbs light', expectedAnswer: 1 }]);
  for (const correctAnswer of [0, 2, 3]) {
    expect(() => auditCedarQuizAnswers([{ id: 'wrong-chlorophyll', question, options, correctAnswer }]))
      .toThrow('label disagrees');
  }
  expect(() => cedarFactAnswer(question, ['Absorbing light', 'To absorb light', 'Producing sugars']))
    .toThrow('exactly one');
  for (const unsupported of [
    'Releasing light', 'Absorbing water', 'Producing sugars', 'Not absorbing light',
    'Absorbing light and water', 'Absorbing light but releasing carbon dioxide',
    'Maybe absorbing light', 'Absorbing light during respiration',
  ]) expect(() => cedarFactAnswer(question, [unsupported, 'Releasing oxygen', 'Producing sugars']))
    .toThrow('exactly one');
});

test('retained comparison with other trays preserves the control subject and supported treatment', () => {
  const question = 'What distinguishes the experimental control from the other trays in the study?';
  const options = ['It receives no water', 'It contains no bean seedlings', 'It receives the same water but no light', 'It is measured only once a week'];
  expect(cedarFactAnswer(question, options)).toEqual({ fact: 'control receives equal water and no light', index: 2 });
  expect(cedarFactAnswer(question, [...options].reverse())?.index).toBe(1);
  expect(auditCedarQuizAnswers([{ id: 'retained-other-trays', question, options, correctAnswer: 2 }]))
    .toEqual([{ questionId: 'retained-other-trays', fact: 'control receives equal water and no light', expectedAnswer: 2 }]);
  for (const correctAnswer of [0, 1, 3]) {
    expect(() => auditCedarQuizAnswers([{ id: 'wrong-other-trays', question, options, correctAnswer }]))
      .toThrow('label disagrees');
  }
  expect(() => cedarFactAnswer(question, [options[2], 'It receives no light', options[0]]))
    .toThrow('exactly one');
  for (const unsupported of [
    'It receives the same water and light', 'It receives no light and no water',
    'It receives less water but no light', 'The other trays receive the same water but no light',
    'It receives the same water but no light and grows less',
  ]) expect(() => cedarFactAnswer(question, [unsupported, options[0], options[1], options[3]]))
    .toThrow('exactly one');
  for (const unsupported of [
    'What distinguishes the other trays from the experimental control in the study?',
    'What distinguishes the experimental control from the researchers in the study?',
    'What distinguishes the experimental control from the other trays in another study?',
    'What distinguishes the experimental control from the other trays in the study in this study?',
    'What distinguishes the experimental control from the other trays in the study after fourteen days?',
    'What distinguishes the experimental control that receives no water from the other trays in the study?',
    'What does not distinguish the experimental control from the other trays in the study?',
    'What growth distinguishes the experimental control from the other trays in the study?',
  ]) expect(cedarFactAnswer(unsupported, options)).toBeNull();
});
