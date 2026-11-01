/** Whether saved listening history may supply an implicit player restore. */
export function shouldAutoRestorePodcastHistory({
  hasTerminalError,
  hasCurrentAudio,
  hasAlreadyRestored,
}: {
  hasTerminalError: boolean;
  hasCurrentAudio: boolean;
  hasAlreadyRestored: boolean;
}): boolean {
  return !hasTerminalError && !hasCurrentAudio && !hasAlreadyRestored;
}
