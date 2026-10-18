import test from 'node:test';
import assert from 'node:assert/strict';
import { studioFailureDiagnostic } from './shared-account-studio-diagnostics.mjs';
test('records timeout, known substep and numeric own-harness location only', () => {
 const error = {message:'Timed out: password=NEVER_RETAIN_THIS https://private.example',stack:'Error: secret\n at openQuiz (C:/private/user/e2e/shared-account-studio.pw.ts:46:12)'};
 const result=studioFailureDiagnostic(error,'quiz-settings-visible');
 assert.deepEqual(result,{failureCategory:'timeout',substep:'quiz-settings-visible',assertionLocation:{file:'e2e/shared-account-studio.pw.ts',line:46,column:12}});
 assert.doesNotMatch(JSON.stringify(result),/NEVER_RETAIN|private|password|https/);
});
test('does not persist arbitrary substep or foreign stack location', () => {
 assert.deepEqual(studioFailureDiagnostic({message:'expect(locator).toBeVisible failed',stack:'at https://secret.example/file.ts:2:3'},'password=secret'),{failureCategory:'assertion',substep:'stage-action'});
});
test('classifies closed context separately from timeout and handles absent errors',()=>{
 assert.equal(studioFailureDiagnostic({message:'Target closed after timeout'},'quiz-count-control').failureCategory,'context-or-element-closed');
 assert.deepEqual(studioFailureDiagnostic(undefined,undefined),{failureCategory:'operation-failed',substep:'stage-action'});
});
test('does not invoke untrusted getters or stringify arbitrary error values',()=>{
 const error={get message(){throw new Error('secret')},get stack(){throw new Error('secret')}};
 assert.deepEqual(studioFailureDiagnostic(error,'quiz-independent-answer-audit'),{failureCategory:'operation-failed',substep:'quiz-independent-answer-audit'});
});
