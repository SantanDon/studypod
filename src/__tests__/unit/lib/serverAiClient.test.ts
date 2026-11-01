import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateServerAiResponse, getServerAiAuthValue } from '@/lib/ai/serverAiClient';
import { clearPersonalProviderConnection, connectPersonalProvider } from '@/lib/ai/personalProviderContext';

afterEach(() => {
  clearPersonalProviderConnection();
  vi.unstubAllGlobals();
});

function storageWith(values: Record<string, string | null>) {
  return {
    getItem(key: string) {
      return values[key] ?? null;
    },
  };
}

const guestCredential = (character: string) =>
  ['guest', character.repeat(36)].join('_');
const sessionKey = ['access', 'token'].join('_');

describe('server AI authentication', () => {
  it('uses the standalone Guest Mode identity when no signed-in session exists', () => {
    const guestId = guestCredential('a');
    expect(
      getServerAiAuthValue(
        storageWith({ currentSession: null, guest_id: guestId }),
      ),
    ).toBe(guestId);
  });

  it('keeps supporting a guest credential stored in a legacy session', () => {
    const legacyGuestId = guestCredential('b');
    expect(
      getServerAiAuthValue(
        storageWith({
          currentSession: JSON.stringify({ [sessionKey]: legacyGuestId }),
          guest_id: guestCredential('c'),
        }),
      ),
    ).toBe(legacyGuestId);
  });

  it('does not forward malformed guest identifiers', () => {
    expect(
      getServerAiAuthValue(
        storageWith({
          currentSession: null,
          guest_id: ['guest', 'short'].join('_'),
        }),
      ),
    ).toBe('COOKIE_SESSION');
  });

  it('uses the cookie sentinel for normal signed-in sessions', () => {
    expect(
      getServerAiAuthValue(
        storageWith({
          currentSession: JSON.stringify({ [sessionKey]: 'managed_by_cookie' }),
          guest_id: null,
        }),
      ),
    ).toBe('COOKIE_SESSION');
  });
});

describe('personal provider routing', () => {
  it('passes the selected provider only on explicit Studio generation requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: 'Generated' }) });
    vi.stubGlobal('fetch', fetchMock);
    connectPersonalProvider('groq', 'groq-secret', 'llama-test');

    await expect(generateServerAiResponse([{ role: 'user', content: 'Hello' }])).resolves.toBe('Generated');
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toMatchObject({
      'X-StudyPod-Provider': 'groq',
      'X-StudyPod-Api-Key': 'groq-secret',
      'X-StudyPod-Model': 'llama-test',
    });
    expect(options.body).not.toContain('groq-secret');
    expect(JSON.parse(options.body)).not.toHaveProperty('maxOutputTokens');
    expect(JSON.parse(options.body)).not.toHaveProperty('jsonMode');
  });

  it('forwards explicit structured output controls to the server', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: '{}' }) });
    vi.stubGlobal('fetch', fetchMock);
    await generateServerAiResponse([{ role: 'user', content: 'Return JSON.' }], 0.7, { maxOutputTokens: 4096, jsonMode: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ maxOutputTokens: 4096, jsonMode: true });
  });
});
