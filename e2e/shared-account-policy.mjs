// No dotenv: the approved existing identity is supplied only in the calling process.
export const excludedCoverage = ['signup', 'Terms acceptance', 'foreign-account ownership', '14-type source intake', 'YouTube extraction', 'chat quality', 'Studio quality', 'audio playback/download', 'encrypted background sync'];
export function validateSharedAccountEnvironment(env, requireCredentials = true) {
  if (env.STUDYPOD_SHARED_ACCOUNT_MODE !== 'existing-account-only' || env.STUDYPOD_SHARED_MUTATIONS !== 'new-notebooks-only') throw new Error('Explicit existing-account and new-notebook authorization required');
  if (env.STUDYPOD_AUTH_SIGNUP === '1' || env.STUDYPOD_AUTH_TERMS_ACCEPTED === '1') throw new Error('Signup and Terms acceptance are forbidden');
  const target = new URL(env.STUDYPOD_SHARED_BASE_URL || '');
  if (target.username || target.password || target.search || target.hash || target.pathname !== '/') throw new Error('Use an origin without credentials/path/query');
  if (!(target.protocol === 'https:' || (target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname)))) throw new Error('Secure or loopback target required');
  if (env.STUDYPOD_SHARED_APPROVED_ORIGIN !== target.origin) throw new Error('Exact approved origin required');
  if (requireCredentials && (!env.STUDYPOD_SHARED_EMAIL || !env.STUDYPOD_SHARED_PASSWORD)) throw new Error('Existing identity runtime credentials required');
  return target.origin;
}
export function createSharedMutationPolicy(origin) {
  const notebookIds = new Set();
  let verified = false;
  let creates = 0;
  return {
    verifyIdentity() { verified = true; },
    registerCreated(id) { if (typeof id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(id) || creates !== 1 || notebookIds.size !== 0) throw new Error('Invalid newly created notebook'); notebookIds.add(id); },
    ids() { return [...notebookIds]; },
    decide(rawUrl, method) {
      const url = new URL(rawUrl);
      const verb = method.toUpperCase();
      const path = url.pathname;
      if (url.origin !== origin) return { allowed: false, reason: 'external-origin' };
      if (/signup|register/i.test(path) || (path === '/auth' && /signup|register/i.test(url.searchParams.get('mode') || ''))) return { allowed: false, reason: 'signup-forbidden' };
      if (!['GET', 'HEAD', 'OPTIONS'].includes(verb)) {
        if (verb === 'POST' && ['/api/auth/signin', '/api/auth/signout', '/api/auth/refresh'].includes(path)) return { allowed: true };
        // Encrypted sync cannot be proven to belong to the newly created notebook. Abort it without sending bytes.
        if (verb === 'POST' && path === '/api/sync/upload') return { allowed: false, reason: 'encrypted-background-sync-quarantined', quarantined: true };
        if (!verified) return { allowed: false, reason: 'identity-unverified' };
        if (verb === 'POST' && path === '/api/notebooks' && creates === 0) { creates++; return { allowed: true, captureCreated: true }; }
        const match = path.match(/^\/api\/notebooks\/([a-zA-Z0-9-]+)(?:\/(.*))?$/);
        if (match && notebookIds.has(match[1]) && ((!match[2] && ['PUT', 'DELETE'].includes(verb)) || (match[2] === 'sources' && verb === 'POST'))) return { allowed: true };
        return { allowed: false, reason: 'mutation-outside-run' };
      }
      return { allowed: true };
    },
  };
}
