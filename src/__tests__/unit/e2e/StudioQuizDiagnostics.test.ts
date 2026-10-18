import { test, expect } from 'vitest';
import { cedarFactAnswer, auditCedarQuizAnswers } from '../../../../e2e/helpers/cedarFactOracle';
import { syntheticQuizDiagnostics } from '../../../../e2e/shared-account-studio-diagnostics.mjs';

const question = { id: 'synthetic-question', question: 'How many blue trays does the experiment use?', options: ['7 blue trays', '17 blue trays', '27 blue trays', '37 blue trays'], correctAnswer: 1 };

test('classifies supported facts and generated label disagreement without accepting wrong labels', () => {
  expect(syntheticQuizDiagnostics([question], cedarFactAnswer)[0]).toMatchObject({ category: 'supported-label', expectedAnswer: 1 });
  const wrong = { ...question, correctAnswer: 0 };
  expect(syntheticQuizDiagnostics([wrong], cedarFactAnswer)[0]).toMatchObject({ category: 'factual-label-mismatch', expectedAnswer: 1 });
  expect(() => auditCedarQuizAnswers([wrong])).toThrow();
});

test('distinguishes unsupported prompts/options and ambiguous correct options using the actual oracle', () => {
  const unknown = { ...question, question: 'What is the document title?' };
  const none = { ...question, options: ['7', '27', '37', '47'] };
  const ambiguous = { ...question, options: ['17', 'Seventeen', '7', '27'] };
  expect(syntheticQuizDiagnostics([unknown, none, ambiguous], cedarFactAnswer).map((result: { category: string }) => result.category)).toEqual(['unsupported-question-wording', 'unsupported-option-wording', 'ambiguous-supported-options']);
  for (const invalid of [unknown, none, ambiguous]) expect(() => auditCedarQuizAnswers([invalid])).toThrow();
});

test('bounds synthetic snapshots and never persists arbitrary oracle exceptions', () => {
  const result = syntheticQuizDiagnostics(Array.from({ length: 10 }, () => ({ ...question, question: 'q'.repeat(999), options: Array.from({ length: 10 }, () => 'o'.repeat(999)), correctAnswer: 88 })), () => { throw new Error('PRIVATE SESSION VALUE'); });
  expect(result).toHaveLength(3);
  expect(result[0].question).toHaveLength(512);
  expect(result[0].options).toHaveLength(4);
  expect(result[0].options[0]).toHaveLength(256);
  expect(result[0].correctAnswer).toBeNull();
  expect(JSON.stringify(result)).not.toContain('PRIVATE SESSION VALUE');
});
