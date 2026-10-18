// Store only fixed classifications and this harness's numeric source location.
// Never retain assertion messages, stacks, source content, credentials, or URLs.
export function studioFailureDiagnostic(error, substep) {
  let message = '';
  let stack = '';
  try { message = typeof error?.message === 'string' ? error.message : ''; } catch {}
  try { stack = typeof error?.stack === 'string' ? error.stack : ''; } catch {}
  const failureCategory = /closed|disposed|detached/i.test(message) ? 'context-or-element-closed'
    : /timeout|timed out/i.test(message) ? 'timeout'
    : /expect\(|assert/i.test(message) ? 'assertion' : 'operation-failed';
  const location = stack.match(/shared-account-studio\.pw\.ts:(\d{1,6}):(\d{1,6})(?:\D|$)/);
  const allowed = new Set(['quiz-open-tool', 'quiz-settings-visible', 'quiz-count-control', 'quiz-count-confirmed', 'quiz-difficulty-control', 'quiz-start-generation', 'quiz-generated-question-visible', 'quiz-persisted-record', 'quiz-shape-audit', 'quiz-independent-answer-audit']);
  return {
    failureCategory,
    substep: allowed.has(substep) ? substep : 'stage-action',
    ...(location ? { assertionLocation: { file: 'e2e/shared-account-studio.pw.ts', line: Number(location[1]), column: Number(location[2]) } } : {}),
  };
}

// Only call after verifying every question belongs to the one synthetic source
// created in this run. This never changes the independent acceptance oracle.
export function syntheticQuizDiagnostics(questions, answerOracle) {
  const boundedText = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
  return questions.slice(0, 3).map((question, index) => {
    let category = 'oracle-evaluation-failed';
    let expectedAnswer;
    let supportedOptionCount;
    try {
      const answer = answerOracle(question.question, question.options);
      if (!answer) category = 'unsupported-question-wording';
      else {
        expectedAnswer = answer.index;
        supportedOptionCount = 1;
        category = question.correctAnswer === answer.index ? 'supported-label' : 'factual-label-mismatch';
      }
    } catch {
      let count = 0;
      for (const option of question.options) {
        try { if (answerOracle(question.question, [option])) count += 1; } catch { /* No error data retained. */ }
      }
      supportedOptionCount = count;
      category = count === 0 ? 'unsupported-option-wording' : count > 1 ? 'ambiguous-supported-options' : 'oracle-evaluation-failed';
    }
    return {
      index, category,
      question: boundedText(question.question, 512),
      options: question.options.slice(0, 4).map(option => boundedText(option, 256)),
      correctAnswer: Number.isInteger(question.correctAnswer) && question.correctAnswer >= 0 && question.correctAnswer < 4 ? question.correctAnswer : null,
      ...(Number.isInteger(expectedAnswer) ? { expectedAnswer } : {}),
      ...(Number.isInteger(supportedOptionCount) ? { supportedOptionCount } : {}),
    };
  });
}
