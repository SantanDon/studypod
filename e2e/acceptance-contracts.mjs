// Reviewed release inventory. Deliberately independent of Playwright discovery.
// Adding/removing a scenario requires review here as well as in the producer.
const contracts = {};
const add = (ids, contract, mobile = true) => {
  for (const id of ids) contracts[id] = { ...contract, mobile };
};
const stage = (terminal, stages) => ({ terminal, stages });
const yes = (...flags) => Object.fromEntries(flags.map(flag => [flag, true]));
add(['account-lifecycle-invalid-login'], { terminal: { phase: 'passed' }, flags: yes('failedAttemptsStayedAnonymous') });
add(['account-lifecycle-duplicate-signup'], { terminal: { phase: 'passed' }, flags: yes('originalOwnershipPreserved') });
add(['account-lifecycle-notebook'], { terminal: { phase: 'passed' }, flags: yes('ownerLifecycleAndIsolation') });
for (const format of ['wav', 'mp3', 'm4a', 'paste', 'txt', 'md', 'pdf', 'docx', 'epub']) {
  add([`intake-${format}`], { terminal: { phase: 'passed' }, flags: yes('viewerFactVisible', 'reopenedAfterReload'), source: true }, format === 'paste');
}
add(['corrupt-pdf'], { terminal: { phase: 'passed' }, flags: { corruptPdfSavedAsReady: false } }, false);
add(['grounded-chat'], { terminal: { phase: 'passed' }, strings: { chat: 'persisted source fact, keyboard citation excerpt, reload' }, source: true });
add(['studio-map'], { terminal: { phase: 'passed' }, flags: yes('reopenedAfterReload', 'foreignNotebookAndSourceDenied'), strings: { freshOwnerMapPersistence: 'passed' }, objects: ['map', 'serverMap', 'foreignMapApiCoverage'], source: true });
add(['studio-flashcards'], { terminal: { phase: 'passed' }, flags: yes('reopenedAfterReload'), strings: { flashcardsGeneratedReviewed: 3 }, source: true }, false);
add(['studio-quiz'], { terminal: { phase: 'passed' }, flags: yes('quizQuestionRendered', 'quizAnswerFeedbackVisible'), source: true }, false);
add(['studio-note'], { terminal: { phase: 'passed' }, flags: yes('notePointerSave', 'noteSavedAndVisible', 'reopenedAfterReload'), source: true });
add(['studio-goal'], { terminal: { phase: 'passed' }, flags: yes('goalSavedAndVisible', 'reopenedAfterReload'), source: true }, false);
add(['studio-document'], { terminal: { phase: 'passed' }, flags: yes('documentSaved', 'reopenedAfterReload'), source: true }, false);
add(['txt', 'md', 'markdown', 'pdf', 'docx', 'epub', 'wav', 'mp3', 'm4a', 'bookmarks', 'bookmarks-js', 'paste', 'website', 'youtube'].map(x => `source-downstream-${x}`), stage({ phase: 'passed' }, [
  'intake', 'logout-login-persistence', 'grounded-chat', 'open-studio', 'studio-flashcards', 'ownership',
]));
for (const format of ['markdown', 'bookmarks', 'bookmarks-js']) contracts[`source-downstream-${format}`].flags = yes('visibleFileChooser');
for (const interaction of ['drop', 'rename']) add([`source-interaction-${interaction}`], {
  terminal: { phase: 'complete', status: 'passed' }, flags: yes('reloadViewerFact', 'freshLoginViewerFact', 'foreignAccountDenied', ...(interaction === 'rename' ? ['failedRenameRetainsDialogAndServer', 'serverRenamePersisted'] : [])),
});
const captureStages = ['isolated-signup-and-owned-notebook', 'real-source-intake', 'real-provider-grounded-chat', 'citation-linked-evidence-and-keyboard', 'save-answer-and-immediate-studio-discovery', 'reload-chat-citation-and-captured-note', 'fresh-owner-login-and-reopen', 'second-account-denial-and-owner-data-intact'];
add(['studio-chat-actions-grounded-capture'], stage({ phase: 'complete' }, captureStages));
add(['studio-task-capture'], stage({ phase: 'complete' }, captureStages.map(x => x.replace('captured-note', 'captured-task'))));
const extended = {
  comparison: 'Actual model comparison identifies both conflicting tray counts; original evidence and excerpt boundary visible',
  'mission-note': 'Mission creates a grounded report note visible immediately and after reload',
  'goal-synthesis': 'Goal synthesis yields a discoverable persisted source-grounded note',
  'goal-suggestion': 'Actual generated suggestion acceptance persists after reload',
  'document-revision': 'Real grounded proposal is reviewed before acceptance; four downloadable formats; prior version restored and persisted',
  'audio-chat-open': 'Explicit podcast open routes to Studio; chapter instruction requires selection; reload does not replay draft',
};
for (const [id, check] of Object.entries(extended)) add([`studio-extended-${id}`], { terminal: { phase: 'passed' }, checks: [check] });
for (const kind of ['podcast', 'audiobook']) add([`studio-audio-${kind}`], {
  terminal: { phase: 'passed' }, flags: yes('accountIdentityVerified', 'notebookOwnerVerified', 'chatCitationRetainsFact', 'localOnly'),
  objects: ['media', 'download', 'persistence', 'spokenFidelity', kind === 'podcast' ? 'freshOwnerPodcast' : 'freshOwnerAudiobook', kind === 'podcast' ? 'foreignPodcastDenied' : 'foreignAudiobookDenied', ...(kind === 'podcast' ? ['podcastOwnerDeletion'] : [])],
});
add(['studio-audio-upload-wav-podcast'], {
  ...contracts['studio-audio-podcast'],
  flags: { ...contracts['studio-audio-podcast'].flags, uploadedWavVerified: true },
  objects: [...contracts['studio-audio-podcast'].objects, 'uploadedWav'],
});
add(['studio-audio-cancel-retry-podcast'], {
  ...contracts['studio-audio-podcast'],
  flags: { ...contracts['studio-audio-podcast'].flags, cancelRetryVerified: true },
  objects: [...contracts['studio-audio-podcast'].objects, 'cancelRetry'],
});
const quizStages = ['signup-and-own-notebook', 'paste-source-and-process', 'settle-source-background-generation', 'real-qwen-generation', 'first-results-and-authoritative-save', 'retake-results-and-independent-attempt', 'fresh-login-and-history-results', 'foreign-account-read-and-write-denial', 'no-browser-exceptions', 'first-attempt-question-1', 'first-attempt-question-2', 'first-attempt-question-3', 'retake-question-1', 'retake-question-2', 'retake-question-3'];
add(['studio-quiz-journey', 'studio-quiz-true-false'], stage({ phase: 'complete' }, quizStages));
add(['studio-flashcard-mixed-review'], stage({ phase: 'complete' }, [
  'real-owner-native-source', 'real-qwen-cards-and-independent-prose-audit', 'mixed-completion-and-reload', 'fresh-owner-login-and-due-only-resumption', 'all-saved-progress-no-cards-due', 'foreign-account-denied-and-owner-record-unchanged', 'first-again', 'second-hard', 'third-good', 'resume-first-good', 'resume-second-good',
]));
add(['guest-upload-recovery'], stage({ outcome: 'passed' }, [
  'fresh-guest-notebook-created', 'four-native-txt-uploads-ready-with-readable-facts', 'fifth-corrupt-docx-durable-extraction-failure-quota-zero', 'visible-failed-source-deletion-restores-slot-after-reload', 'replacement-native-upload-and-all-five-facts-survive-reload',
]));
add(['signed-in-upload-recovery'], stage({ outcome: 'passed' }, [
  'ui-signup-and-owner-notebook', 'four-native-txt-uploads-and-original-snapshot', 'real-corrupt-docx-failure-and-saved-metadata', 'ui-logout-login-retains-failure-and-original-facts', 'ui-delete-failed-source-and-server-confirmation', 'native-replacement-and-five-facts-after-reload', 'fresh-browser-same-owner-reopens-all-facts',
]));
add(['upload-validation'], stage({ outcome: 'passed' }, [
  'ui-signup-and-disposable-owner-notebook', 'native-mixed-selection-visible-filename-rejections', 'valid-facts-independent-of-durable-corrupt-docx-failure', 'keyboard-picker-activation-and-subsequent-valid-selection',
]));
add(['content-and-failure-put', 'content-put-once'].map(x => `source-save-outage-${x}`), stage({ outcome: 'passed', phase: 'finished' }, [
  'signup', 'intact-native-upload', 'injected-owned-content-save', 'durable-source-save-reason-before-reload', 'persistent-interruption-after-reload', 'actionable-owned-delete-and-native-readd',
]));
add(['module-load-recovery'], stage({ outcome: 'passed' }, [
  'real-owner-signup-and-notebook', 'native-intact-source-with-viewer-not-yet-loaded', 'three-active-one-queued-native-files', 'real-missing-module-and-visible-queue-guard', 'finish-original-queue-before-allowing-explicit-reload', 'repaired-real-viewer-all-native-facts-durable',
]));
add(['upload-queue-reload'], stage({ outcome: 'passed', phase: 'finished' }, [
  'real-isolated-signup-and-notebook', 'real-intact-upload-and-explicit-historical-fixture', 'four-acknowledged-three-held-one-queued-no-false-interruption', 'reload-loses-file-memory-and-exposes-four-exact-recovery-actions', 'real-completed-server-record-clears-only-its-hint', 'owned-ui-delete-and-native-original-file-readd',
]));
add(['guest-upload-queue-reload'], stage({ outcome: 'passed', phase: 'finished' }, [
  'fresh-guest-owned-notebook', 'native-five-txt-three-indexing-two-pending', 'reload-exact-five-actionable-hints-two-empty-pending', 'confirmed-pending-deletion-restores-durable-two-slots', 'native-original-readd-ready-facts-survive-reload',
]));
add(['populated-notebook-deletion'], { terminal: { phase: 'passed' }, flags: { physicalRowAndBlobPurgeVerified: true, populatedSiblingRetained: true, secureStorageErasureVerified: false, siblingGenerationVerified: false }, checks: [
  "actual-readable-source",
  "actual-answer-and-source-backed-visible-citation",
  "real-three-card-grounded-saved-deck",
  "actual-decodable-account-saved-podcast",
  "foreign-read-and-delete-denial",
  "fresh-owner-same-source-answer-deck-and-audio",
  "populated-sibling-public-save-and-foreign-denial",
  "cancel-retains-exact-target-and-populated-sibling-rows",
  "actual-runtime-db-target-rows-and-blob-purged-sibling-intact",
  "populated-cancel-preserves-resources-and-real-ui-delete",
  "fresh-owner-target-db-purge-and-identical-populated-sibling",
  "fresh-owner-deleted-list-source-chat-deck-podcast-and-audio-denied-with-live-sibling"
] }, false);
export const reviewedContracts = Object.freeze(contracts);
export const reviewedInventory = Object.freeze(Object.entries(contracts).flatMap(([scenario, contract]) => [
  { project: 'desktop', scenario }, ...(contract.mobile ? [{ project: 'mobile', scenario }] : []),
]));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const key = row => `${row.project}:${row.scenario}`;
const inventoryKeys = new Set(reviewedInventory.map(key));
export function inventoryValid(rows) {
  if (!Array.isArray(rows) || rows.length !== inventoryKeys.size) return false;
  const keys = rows.map(key);
  return new Set(keys).size === keys.length && keys.every(id => inventoryKeys.has(id));
}
export function acceptanceReceipt(info, evidence) {
  return { schemaVersion: 2, scenario: info.title.split(':')[0], project: info.project.name, evidence };
}
export function receiptValid(receipt, identity) {
  if (!object(receipt) || receipt.schemaVersion !== 2 || receipt.scenario !== identity.scenario || receipt.project !== identity.project || !inventoryKeys.has(key(identity)) || !object(receipt.evidence)) return false;
  const e = receipt.evidence, c = contracts[identity.scenario];
  if (!Object.entries(c.terminal).every(([name, value]) => e[name] === value)) return false;
  if (e.mockedAuthOrData !== undefined && e.mockedAuthOrData !== false) return false;
  if (e.pageErrorCount !== undefined && e.pageErrorCount !== 0) return false;
  if (e.pageErrors !== undefined && (!Array.isArray(e.pageErrors) || e.pageErrors.length !== 0)) return false;
  for (const fields of [c.flags, c.strings]) if (fields && !Object.entries(fields).every(([name, value]) => e[name] === value)) return false;
  if (c.objects && !c.objects.every(name => object(e[name]) && Object.keys(e[name]).length > 0)) return false;
  if (c.source && (!object(e.source) || e.source.retainedSyntheticFact !== true || !['completed', 'degraded'].includes(e.source.status) || !(e.source.contentLength > 0))) return false;
  if (c.checks && (!Array.isArray(e.checks) || e.checks.length !== c.checks.length || !c.checks.every(x => e.checks.includes(x)))) return false;
  if (c.stages) {
    let rows;
    if (Array.isArray(e.stages)) rows = e.stages.map(x => typeof x === 'string' ? { name: x, status: 'passed' } : x);
    else if (object(e.stages)) rows = Object.entries(e.stages).map(([name, value]) => ({ name, status: value?.status }));
    else return false;
    if (rows.length !== c.stages.length || !rows.every(x => object(x) && x.status === 'passed' && c.stages.includes(x.name)) || new Set(rows.map(x => x.name)).size !== c.stages.length) return false;
  }
  if (identity.scenario.startsWith('studio-audio-') && !audioEvidenceValid(e, identity.scenario.endsWith('podcast'), identity.project === 'mobile')) return false;
  if (identity.scenario === 'studio-audio-upload-wav-podcast' && !uploadedWavEvidenceValid(e.uploadedWav)) return false;
  if (identity.scenario === 'studio-audio-cancel-retry-podcast' && !cancelRetryEvidenceValid(e.cancelRetry)) return false;
  return true;
}
export function cancelTransportEvidenceValid(events) {
  if (!Array.isArray(events) || events.length === 0 || events.length >= 200 || !events.every(event => typeof event === 'string')) return false;
  const synthesis = events.indexOf('request-synthesize'), cancel = events.indexOf('request-cancel');
  return synthesis >= 0 && cancel > synthesis && events.filter(event => event === 'request-cancel').length === 1
    && !events.slice(0, cancel).includes('response-audio');
}
export function cancelRetryEvidenceValid(c) {
  return object(c) && ['nativeSynthesisSeen', 'activeUICancel', 'nativeCancelSeen', 'cancelBeforeCompletedSegment', 'retryUIStarted'].every(name => c[name] === true)
    && ['savedBeforeCancel', 'savedAfterCancel', 'savePostsBeforeCancel', 'savePostsAfterCancel'].every(name => c[name] === 0)
    && cancelTransportEvidenceValid(c.cancelTransportEvents)
    && c.savedAfterRetry === 1 && c.savePostsAfterRetry === 1
    && ['synthesisObservedAt', 'cancelClickedAt', 'retryClickedAt', 'saveObservedAt'].every(name => Number.isFinite(c[name]) && c[name] > 0)
    && c.synthesisObservedAt <= c.cancelClickedAt && c.cancelClickedAt < c.retryClickedAt && c.retryClickedAt < c.saveObservedAt;
}
function uploadedWavEvidenceValid(w) {
  return object(w) && typeof w.sourceId === 'string' && w.sourceId.length > 0
    && typeof w.notebookId === 'string' && w.notebookId.length > 0
    && w.sourceType === 'audio' && ['completed', 'degraded'].includes(w.status)
    && w.sourcePostStatus === 201 && w.visibleFileChooser === true && w.reloadViewerFact === true
    && /^[a-f0-9]{64}$/.test(w.inputSha256 || '') && /^[a-f0-9]{64}$/.test(w.transcriptionSha256 || '')
    && w.fidelitySourceSha256 === w.transcriptionSha256 && w.citationSourceId === w.sourceId
    && Array.isArray(w.podcastSourceIds) && w.podcastSourceIds.length === 1 && w.podcastSourceIds[0] === w.sourceId;
}
const allTrue = (value, names) => object(value) && names.every(name => value[name] === true);
const mediaValid = m => object(m) && Number.isFinite(m.duration) && m.duration > 0 && m.paused === true && m.position >= 1.5 && m.readyState >= 2;
const restoredMediaValid = m => object(m) && typeof m.chapterId === 'string' && m.chapterId.length > 0 && /^[a-f0-9]{64}$/.test(m.sha256 || '') && Number.isFinite(m.duration) && m.duration > 0 && m.rate === 1.5 && m.paused === true;
function audioEvidenceValid(e, podcast, mobile) {
  if (!mediaValid(e.media) || !object(e.download) || !(e.download.bytes > 0) || !/^[a-f0-9]{64}$/.test(e.download.sha256 || '') || !object(e.download.signal) || !(e.download.signal.duration > 0) || !(e.download.signal.peak > 0) || !(e.download.signal.rms > 0)) return false;
  const speech = e.spokenFidelity;
  if (!object(speech) || speech.status !== 'passed' || speech.audioSha256 !== e.download.sha256 || !Array.isArray(speech.facts) || speech.facts.length === 0 || !speech.facts.every(f => allTrue(f, ['source', 'script', 'speechTranscript']) && f.scriptContradicted === false && f.contradicted === false)) return false;
  if (![403, 404].includes(e.foreignNotebookDenied)) return false;
  const foreign = podcast ? e.foreignPodcastDenied : e.foreignAudiobookDenied;
  const names = podcast ? ['list', 'record', 'audio', 'delete', 'create'] : ['manifest', 'chapterAudio', 'download', 'progress', 'bookmarkCreate', 'bookmarkDelete', 'audioDelete'];
  if (!object(foreign) || !names.every(name => foreign[name] === 404) || foreign[podcast ? 'ownerRecordUnchanged' : 'ownerStateUnchanged'] !== true) return false;
  const fresh = podcast ? e.freshOwnerPodcast : e.freshOwnerAudiobook;
  if (!allTrue(fresh, ['signedIn', 'emptyBrowserHistory', 'downloadMatches']) || !mediaValid(fresh.media) || !(fresh.seekPosition >= 1.5)) return false;
  if (podcast) return e.dashboardCueForeignAccountHidden === true && allTrue(e.foreignDashboardQuery, ['ownedEmptyNotebook', 'uiRecentQuerySettledEmpty', 'foreignTitleAndCueAbsent']) && allTrue(e.persistence, ['browserHistoryReopened', 'serverPodcastRecord']) && allTrue(e.podcastOwnerDeletion, ['recordRemoved', 'bytesRemoved', 'emptyList', 'absentAfterReload', 'dashboardCueRemoved']);
  if (!restoredMediaValid(fresh.restoredMedia) || !allTrue(e.sameBrowserAudiobookIsolation, ['realSignOutAndSignIn', 'ownerNotebookDenied', 'noInheritedPlayerOrMedia']) || !restoredMediaValid(e.sameBrowserAudiobookIsolation.ownerMediaRestored)) return false;
  if (mobile && (!allTrue(fresh.mobileContinuity, ['groundedNewAnswer', 'citationVerified', 'resumedPaused']) || !restoredMediaValid(fresh.mobileContinuity.returnedMedia) || fresh.mobileContinuity.returnedMedia.chapterId !== fresh.mobileContinuity.expectedChapterId || fresh.mobileContinuity.returnedMedia.sha256 !== fresh.mobileContinuity.expectedChapterSha256)) return false;
  return allTrue(e.audiobookOwnerDeletion, ['detachedMediaStopped', 'checkpointRemoved', 'savedRenderRemoved', 'chapterAndExportUnavailable', 'bookmarksRemoved', 'progressReset', 'importedBookRetained', 'freshOwnerAbsence']) && allTrue(fresh, ['savedRender', 'chapterRestored', 'speedRestored', 'bookmarkReopenedAndJumped']) && allTrue(e.persistence, ['serverChapterIdMatched', 'bookmarkReopenedAndJumped', 'bookmarkDeletionPersisted']) && e.persistence.speed === 1.5 && e.persistence.resumePosition > 0 && e.persistence.readyChapters > 0 && e.foreignAudiobookManifestDenied === 404;
}
