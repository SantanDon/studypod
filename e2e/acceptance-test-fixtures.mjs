// Synthetic contract fixtures only; these never constitute runtime acceptance evidence.
import { reviewedContracts } from './acceptance-contracts.mjs';
export function validReceipt(identity) {
  const c = reviewedContracts[identity.scenario];
  const evidence = { ...c.terminal, ...c.flags, ...c.strings, mockedAuthOrData: false, pageErrors: [], pageErrorCount: 0, privateCanary: 'private-source-canary' };
  if (c.objects) for (const name of c.objects) evidence[name] = { verified: true };
  if (c.source) evidence.source = { status: 'completed', contentLength: 42, retainedSyntheticFact: true };
  if (c.checks) evidence.checks = [...c.checks];
  if (c.stages) evidence.stages = c.stages.map(name => ({ name, status: 'passed' }));
  if (identity.scenario.startsWith('studio-audio-')) {
    const media = { duration: 30, paused: true, position: 2, readyState: 4 };
    evidence.media = media;
    evidence.download = { bytes: 1024, sha256: 'a'.repeat(64), signal: { duration: 30, peak: .5, rms: .1 } };
    evidence.spokenFidelity = { status: 'passed', audioSha256: 'a'.repeat(64), facts: [{ id: 'fact', source: true, script: true, speechTranscript: true, scriptContradicted: false, contradicted: false }] };
    evidence.foreignNotebookDenied = 404;
    const fresh = { signedIn: true, emptyBrowserHistory: true, downloadMatches: true, media, seekPosition: 2, savedRender: true, chapterRestored: true, speedRestored: true, bookmarkReopenedAndJumped: true };
    evidence.freshOwnerPodcast = fresh; evidence.freshOwnerAudiobook = fresh;
    const restoredMedia = { chapterId: 'synthetic-chapter', sha256: 'a'.repeat(64), duration: 30, rate: 1.5, paused: true };
    fresh.restoredMedia = restoredMedia;
    const listeningMedia = { ...restoredMedia, chapterId: 'synthetic-listening-chapter', sha256: 'c'.repeat(64) };
    fresh.mobileContinuity = { expectedChapterId: listeningMedia.chapterId, expectedChapterSha256: listeningMedia.sha256, groundedNewAnswer: true, citationVerified: true, resumedPaused: true, returnedMedia: listeningMedia };
    evidence.sameBrowserAudiobookIsolation = { realSignOutAndSignIn: true, ownerNotebookDenied: true, noInheritedPlayerOrMedia: true, ownerMediaRestored: { ...restoredMedia } };
    evidence.persistence = { browserHistoryReopened: true, serverPodcastRecord: true, serverChapterIdMatched: true, speed: 1.5, resumePosition: 2, bookmarkReopenedAndJumped: true, bookmarkDeletionPersisted: true, readyChapters: 1 };
    evidence.foreignPodcastDenied = { list: 404, record: 404, audio: 404, delete: 404, create: 404, ownerRecordUnchanged: true };
    evidence.foreignAudiobookDenied = { manifest: 404, chapterAudio: 404, download: 404, progress: 404, bookmarkCreate: 404, bookmarkDelete: 404, audioDelete: 404, ownerStateUnchanged: true };
    evidence.foreignAudiobookManifestDenied = 404;
    evidence.dashboardCueForeignAccountHidden = true;
    evidence.foreignDashboardQuery = { ownedEmptyNotebook: true, uiRecentQuerySettledEmpty: true, foreignTitleAndCueAbsent: true };
    evidence.audiobookOwnerDeletion = { detachedMediaStopped: true, checkpointRemoved: true, savedRenderRemoved: true, chapterAndExportUnavailable: true, bookmarksRemoved: true, progressReset: true, importedBookRetained: true, freshOwnerAbsence: true };
    evidence.podcastOwnerDeletion = { recordRemoved: true, bytesRemoved: true, emptyList: true, absentAfterReload: true, dashboardCueRemoved: true };
  }
  if (identity.scenario === 'studio-audio-upload-wav-podcast') {
    evidence.uploadedWav = {
      sourceId: 'synthetic-wav-source', notebookId: 'synthetic-notebook', sourceType: 'audio', status: 'completed',
      sourcePostStatus: 201, visibleFileChooser: true, reloadViewerFact: true,
      inputSha256: 'd'.repeat(64), transcriptionSha256: 'e'.repeat(64), fidelitySourceSha256: 'e'.repeat(64),
      citationSourceId: 'synthetic-wav-source', podcastSourceIds: ['synthetic-wav-source'],
    };
  }
  if (identity.scenario === 'studio-audio-cancel-retry-podcast') {
    evidence.cancelRetry = {
      nativeSynthesisSeen: true, activeUICancel: true, nativeCancelSeen: true, cancelBeforeCompletedSegment: true, retryUIStarted: true,
      savedBeforeCancel: 0, savedAfterCancel: 0, savePostsBeforeCancel: 0, savePostsAfterCancel: 0,
      savedAfterRetry: 1, savePostsAfterRetry: 1,
      cancelTransportEvents: ['request-init', 'request-synthesize', 'request-cancel'],
      synthesisObservedAt: 10, cancelClickedAt: 20, retryClickedAt: 30, saveObservedAt: 40,
    };
  }
  return { schemaVersion: 2, ...identity, evidence };
}
