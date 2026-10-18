// Acceptance-only trust trial. Never write certificate paths or option values to evidence.
export function acceptanceTransportSettings(input, allowedFlags = process.allowedNodeEnvironmentFlags) {
  const diagnostics = input.STUDYPOD_YOUTUBE_TRANSPORT_DIAGNOSTICS === '1';
  const system = input.STUDYPOD_ACCEPTANCE_SYSTEM_CA === '1';
  if ((diagnostics || system) && input.STUDYPOD_ACCEPTANCE_DIAGNOSTICS !== '1') {
    throw new Error('YouTube transport diagnostics require an acceptance diagnostic build');
  }
  if (system && !diagnostics) throw new Error('System trust trial requires transport diagnostics');
  if (system && !allowedFlags.has('--use-system-ca')) throw new Error('Runtime does not support the requested system trust trial');
  if (system && (input.YTDLP_COMMAND || input.YTDLP_COMMAND_ARGS)) {
    throw new Error('System trust trial requires an unconfigured yt-dlp entrypoint');
  }
  return { diagnostics, system };
}
export function applyAcceptanceTransportSettings(env, settings) {
  env.STUDYPOD_YOUTUBE_TRANSPORT_DIAGNOSTICS = settings.diagnostics ? '1' : '0';
  env.STUDYPOD_ACCEPTANCE_SYSTEM_CA = settings.system ? '1' : '0';
  if (!settings.system) return;
  if (env.YTDLP_COMMAND || env.YTDLP_COMMAND_ARGS) {
    throw new Error('System trust trial requires an unconfigured yt-dlp entrypoint');
  }
  const options = String(env.NODE_OPTIONS || '');
  if (/(?:^|\s)--use-(?:openssl|bundled)-ca(?:\s|$)/.test(options)) {
    throw new Error('System trust trial conflicts with an inherited CA selector');
  }
  env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
  env.NODE_OPTIONS = `${options} --use-system-ca`.trim();
}
