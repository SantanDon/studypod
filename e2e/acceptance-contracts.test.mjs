import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewedInventory, reviewedContracts, inventoryValid, receiptValid } from './acceptance-contracts.mjs';
import { validReceipt } from './acceptance-test-fixtures.mjs';
test('every reviewed contract has exactly its supported project identities; invalid inventories fail closed', () => {
  const expected = Object.entries(reviewedContracts).flatMap(([scenario, contract]) => [
    { project: 'desktop', scenario }, ...(contract.mobile ? [{ project: 'mobile', scenario }] : []),
  ]);
  assert.deepEqual(reviewedInventory, expected);
  assert.ok(expected.length > 0);
  assert.equal(new Set(expected.map(x => `${x.project}:${x.scenario}`)).size, expected.length);
  assert.ok(inventoryValid(reviewedInventory));
  for (let index = 0; index < expected.length; index++) assert.equal(inventoryValid(expected.filter((_, i) => i !== index)), false);
  for (const rows of [[], reviewedInventory.slice(1), [...reviewedInventory.slice(1), reviewedInventory[1]], [...reviewedInventory.slice(1), {project:'desktop',scenario:'unknown'}], [...reviewedInventory.slice(1), {project:'unknown',scenario:reviewedInventory[0].scenario}]]) assert.equal(inventoryValid(rows), false);
});
for (const identity of reviewedInventory.filter(x => x.project === 'desktop')) test(`${identity.scenario}: identity, terminal and required evidence fail closed`, () => {
  const valid = validReceipt(identity), c = reviewedContracts[identity.scenario];
  assert.ok(receiptValid(valid, identity));
  const mutations = [r => r.schemaVersion = 1, r => r.project = 'mobile', r => r.scenario = 'unknown', r => r.evidence = {}, r => r.evidence.mockedAuthOrData = true, r => r.evidence.pageErrorCount = 1];
  for (const name of Object.keys(c.terminal)) mutations.push(r => delete r.evidence[name]);
  for (const name of Object.keys(c.flags || {})) mutations.push(r => delete r.evidence[name]);
  if (c.stages) mutations.push(r => r.evidence.stages.pop(), r => r.evidence.stages[0].status = 'failed', r => r.evidence.stages[0].name = 'unknown', r => r.evidence.stages[0] = r.evidence.stages[1]);
  if (c.source) mutations.push(r => r.evidence.source.retainedSyntheticFact = false);
  if (c.checks) mutations.push(r => r.evidence.checks = []);
  for (const mutation of mutations) { const r = structuredClone(valid); mutation(r); assert.equal(receiptValid(r, identity), false); }
});
test('uploaded WAV podcast binds real intake, transcription, citation and exact podcast source', () => {
  for (const identity of reviewedInventory.filter(x => x.scenario === 'studio-audio-upload-wav-podcast')) {
    const valid = validReceipt(identity);
    assert.ok(receiptValid(valid, identity));
    const mutations = [r => r.evidence.uploadedWav = { verified: true }];
    for (const field of Object.keys(valid.evidence.uploadedWav)) mutations.push(r => delete r.evidence.uploadedWav[field]);
    for (const [field, value] of Object.entries({ sourceId: '', notebookId: '', sourceType: 'text', status: 'failed', sourcePostStatus: 200, visibleFileChooser: false, reloadViewerFact: false, inputSha256: 'invalid', transcriptionSha256: 'invalid', fidelitySourceSha256: 'b'.repeat(64), citationSourceId: 'other-source', podcastSourceIds: ['other-source'] })) mutations.push(r => r.evidence.uploadedWav[field] = value);
    mutations.push(r => r.evidence.uploadedWav.podcastSourceIds.push('other-source'));
    for (const mutate of mutations) { const receipt = structuredClone(valid); mutate(receipt); assert.equal(receiptValid(receipt, identity), false); }
  }
});

test('audio proof rejects placeholder objects, contradiction, missing foreign denial and hash mismatch', () => {
  for (const scenario of ['studio-audio-podcast', 'studio-audio-audiobook']) {
    const identity = { project:'desktop', scenario }, valid = validReceipt(identity);
    for (const mutate of [r => r.evidence.media = {verified:true}, r => r.evidence.spokenFidelity.status = 'failed', r => r.evidence.spokenFidelity.facts[0].contradicted = true, r => r.evidence.spokenFidelity.audioSha256 = 'b'.repeat(64), r => delete r.evidence.foreignNotebookDenied, r => r.evidence.download.signal.rms = 0]) { const r = structuredClone(valid); mutate(r); assert.equal(receiptValid(r, identity), false); }
  }
});
test('audiobook loaded restoration, real account switch and mobile Ask continuity fail closed', () => {
  for (const project of ['desktop', 'mobile']) {
    const identity = { project, scenario: 'studio-audio-audiobook' }, valid = validReceipt(identity);
    assert.ok(receiptValid(valid, identity));
    const mutations = [r => delete r.evidence.freshOwnerAudiobook.restoredMedia, r => delete r.evidence.sameBrowserAudiobookIsolation, r => delete r.evidence.sameBrowserAudiobookIsolation.ownerMediaRestored];
    for (const flag of ['realSignOutAndSignIn', 'ownerNotebookDenied', 'noInheritedPlayerOrMedia']) {
      mutations.push(r => delete r.evidence.sameBrowserAudiobookIsolation[flag], r => r.evidence.sameBrowserAudiobookIsolation[flag] = false);
    }
    for (const locate of [r => r.evidence.freshOwnerAudiobook.restoredMedia, r => r.evidence.sameBrowserAudiobookIsolation.ownerMediaRestored]) {
      for (const field of ['chapterId', 'sha256', 'duration', 'rate', 'paused']) mutations.push(r => delete locate(r)[field]);
      mutations.push(r => locate(r).sha256 = 'invalid', r => locate(r).duration = Infinity, r => locate(r).duration = 0, r => locate(r).rate = 1, r => locate(r).paused = false);
    }
    if (project === 'mobile') {
      assert.notEqual(valid.evidence.freshOwnerAudiobook.mobileContinuity.returnedMedia.chapterId, valid.evidence.freshOwnerAudiobook.restoredMedia.chapterId);
      mutations.push(r => delete r.evidence.freshOwnerAudiobook.mobileContinuity);
      for (const field of ['expectedChapterId', 'expectedChapterSha256']) mutations.push(r => delete r.evidence.freshOwnerAudiobook.mobileContinuity[field], r => r.evidence.freshOwnerAudiobook.mobileContinuity[field] = '', r => r.evidence.freshOwnerAudiobook.mobileContinuity[field] = 'wrong');
      for (const field of ['chapterId', 'sha256', 'duration', 'rate', 'paused']) mutations.push(r => delete r.evidence.freshOwnerAudiobook.mobileContinuity.returnedMedia[field]);
      for (const flag of ['groundedNewAnswer', 'citationVerified', 'resumedPaused']) mutations.push(r => delete r.evidence.freshOwnerAudiobook.mobileContinuity[flag], r => r.evidence.freshOwnerAudiobook.mobileContinuity[flag] = false);
      mutations.push(r => delete r.evidence.freshOwnerAudiobook.mobileContinuity.returnedMedia, r => r.evidence.freshOwnerAudiobook.mobileContinuity.returnedMedia.chapterId = 'wrong-chapter', r => r.evidence.freshOwnerAudiobook.mobileContinuity.returnedMedia.sha256 = 'b'.repeat(64), r => r.evidence.freshOwnerAudiobook.mobileContinuity.returnedMedia.rate = 1, r => r.evidence.freshOwnerAudiobook.mobileContinuity.returnedMedia.paused = false, r => r.evidence.freshOwnerAudiobook.mobileContinuity.returnedMedia.duration = NaN);
    }
    for (const mutate of mutations) { const receipt = structuredClone(valid); mutate(receipt); assert.equal(receiptValid(receipt, identity), false); }
  }
});

// Each recorded final gate must independently bind the release receipt.
for (const project of ['desktop', 'mobile']) {
  for (const kind of ['podcast', 'audiobook']) test(project + ' ' + kind + ': final deletion and foreign dashboard evidence cannot be omitted or false', () => {
    const identity = { project, scenario: 'studio-audio-' + kind }, valid = validReceipt(identity);
    assert.ok(receiptValid(valid, identity));
    const groups = kind === 'podcast' ? {
      foreignDashboardQuery: ['ownedEmptyNotebook', 'uiRecentQuerySettledEmpty', 'foreignTitleAndCueAbsent'],
      podcastOwnerDeletion: ['recordRemoved', 'bytesRemoved', 'emptyList', 'absentAfterReload', 'dashboardCueRemoved'],
    } : { audiobookOwnerDeletion: ['detachedMediaStopped', 'checkpointRemoved', 'savedRenderRemoved', 'chapterAndExportUnavailable', 'bookmarksRemoved', 'progressReset', 'importedBookRetained', 'freshOwnerAbsence'] };
    const mutations = [];
    for (const [group, flags] of Object.entries(groups)) {
      mutations.push(r => delete r.evidence[group], r => r.evidence[group] = { verified: true });
      for (const flag of flags) {
        mutations.push(r => delete r.evidence[group][flag]);
        for (const value of [false, null, 1, 'true']) mutations.push(r => r.evidence[group][flag] = value);
      }
    }
    if (kind === 'podcast') {
      mutations.push(r => delete r.evidence.dashboardCueForeignAccountHidden);
      for (const value of [false, null, 1, 'true']) mutations.push(r => r.evidence.dashboardCueForeignAccountHidden = value);
    } else {
      mutations.push(r => delete r.evidence.foreignAudiobookDenied.audioDelete);
      for (const value of [200, 403, false, '404']) mutations.push(r => r.evidence.foreignAudiobookDenied.audioDelete = value);
    }
    for (const mutate of mutations) { const receipt = structuredClone(valid); mutate(receipt); assert.equal(receiptValid(receipt, identity), false); }
  });
}

for (const identity of reviewedInventory.filter(row => row.scenario === 'studio-audio-cancel-retry-podcast')) {
  test(identity.project + ' podcast cancellation and retry require ordered native cancellation without a canceled save', () => {
    const valid = validReceipt(identity);
    assert.ok(receiptValid(valid, identity));
    const mutations = [
      r => delete r.evidence.cancelRetry,
      r => r.evidence.cancelRetry = { verified: true },
      r => delete r.evidence.cancelRetry.nativeCancelSeen,
      r => r.evidence.cancelRetry.activeUICancel = false,
      r => r.evidence.cancelRetry.cancelTransportEvents = ['request-synthesize'],
      r => r.evidence.cancelRetry.cancelTransportEvents = ['request-synthesize', 'response-audio', 'request-cancel'],
      r => r.evidence.cancelRetry.savedAfterCancel = 1,
      r => r.evidence.cancelRetry.savePostsAfterRetry = 2,
      r => r.evidence.cancelRetry.retryClickedAt = r.evidence.cancelRetry.cancelClickedAt,
    ];
    for (const mutate of mutations) {
      const receipt = structuredClone(valid); mutate(receipt);
      assert.equal(receiptValid(receipt, identity), false);
    }
  });
}
