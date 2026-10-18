import type { JSHandle } from '@playwright/test';
import { randomUUID } from 'node:crypto';
export interface NativeDisposalSnapshot {
  paused: boolean; detached: boolean; srcAttributeAbsent: boolean; srcObjectAbsent: boolean;
  sourceChildrenAbsent: boolean; readyState: number; networkState: number;
  bufferedRanges: number; currentTime: number; currentSrcPresent: boolean; heldTokenMatches: boolean;
}
export interface NativeDisposalEvidence {
  oracleVersion: 'native-disposal-v2'; previouslyPlaying: boolean;
  immediate: NativeDisposalSnapshot; after: NativeDisposalSnapshot; elapsedMs: number;
}
// Same predicates as independently reviewed b33918e... oracle. currentSrc is diagnostic.
export function disposed(snapshot: NativeDisposalSnapshot) {
  return !!snapshot && snapshot.paused === true && snapshot.detached === true
    && snapshot.srcAttributeAbsent === true && snapshot.srcObjectAbsent === true
    && snapshot.sourceChildrenAbsent === true && snapshot.readyState === 0
    && (snapshot.networkState === 0 || snapshot.networkState === 3)
    && snapshot.bufferedRanges === 0 && Number.isFinite(snapshot.currentTime)
    && snapshot.currentTime >= 0;
}
export function nativeDisposalPassed(immediate: NativeDisposalSnapshot, after: NativeDisposalSnapshot, elapsedMs: number) {
  return Number.isFinite(elapsedMs) && elapsedMs >= 250
    && disposed(immediate) && disposed(after)
    && Math.abs(after.currentTime - immediate.currentTime) <= 0.001;
}
export function nativeDisposalEvidencePassed(evidence: NativeDisposalEvidence) {
  return !!evidence && evidence.oracleVersion === 'native-disposal-v2'
    && evidence.previouslyPlaying === true && evidence.immediate?.heldTokenMatches === true
    && evidence.after?.heldTokenMatches === true
    && nativeDisposalPassed(evidence.immediate, evidence.after, evidence.elapsedMs);
}
// Only arm on the already-held native element after its time has advanced during playback.
export async function holdPlayingNativeAudio(audio: JSHandle<HTMLAudioElement>, playbackStart: number): Promise<string> {
  const token = randomUUID();
  await audio.evaluate((node, input) => {
    if (!node.isConnected || node.paused || node.readyState < 2 || !Number.isFinite(input.playbackStart)
      || !(node.currentTime > input.playbackStart)) throw new Error('NativePlaybackPrecondition');
    const state = globalThis as typeof globalThis & { __studyPodDisposalHeld?: WeakMap<HTMLAudioElement, string> };
    state.__studyPodDisposalHeld ||= new WeakMap();
    state.__studyPodDisposalHeld.set(node, input.token);
  }, {token, playbackStart});
  return token;
}
export async function observeHeldNativeDisposal(audio: JSHandle<HTMLAudioElement>, token: string): Promise<NativeDisposalEvidence> {
  return audio.evaluate(async (node, heldToken) => {
    const state = globalThis as typeof globalThis & { __studyPodDisposalHeld?: WeakMap<HTMLAudioElement, string> };
    const snapshot = (): NativeDisposalSnapshot => ({
      paused: node.paused, detached: !node.isConnected, srcAttributeAbsent: !node.hasAttribute('src'),
      srcObjectAbsent: node.srcObject == null,
      sourceChildrenAbsent: [...node.querySelectorAll('source')].every(source => !source.hasAttribute('src')),
      readyState: node.readyState, networkState: node.networkState, bufferedRanges: node.buffered.length,
      currentTime: node.currentTime, currentSrcPresent: !!node.currentSrc,
      heldTokenMatches: !!heldToken && state.__studyPodDisposalHeld?.get(node) === heldToken,
    });
    const immediate = snapshot();
    const started = performance.now();
    // Measure real elapsed time; timer scheduling alone is not the observation evidence.
    do { await new Promise<void>(resolve => setTimeout(resolve, Math.max(1, 250 - (performance.now() - started)))); }
    while (performance.now() - started < 250);
    const after = snapshot();
    return {oracleVersion: 'native-disposal-v2', previouslyPlaying: immediate.heldTokenMatches,
      immediate, after, elapsedMs: performance.now() - started};
  }, token);
}
