import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPersonalProvider, runWithPersonalProvider, withPersonalProvider,
  testPersonalProvider, generateWithPersonalProvider,
} from '../services/personalProviderService.js';
import { dispatchToTitan } from '../services/titanProvider.js';

vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const groq = { provider: 'groq', key: 'groq-fixture-secret', model: 'llama-3.3-70b-versatile' };
const gemini = { provider: 'gemini', key: 'gemini-fixture-secret', model: 'gemini-2.5-flash' };
const request = { messages: [{ role: 'user', content: 'Explain this source.' }] };
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('personal cloud provider request isolation', () => {
  it('forwards explicit structured output controls without changing defaults', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ choices: [{ message: { content: '{}' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    await generateWithPersonalProvider(groq, { ...request, maxOutputTokens: 4096, jsonMode: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ max_tokens: 4096, response_format: { type: 'json_object' } });
    await generateWithPersonalProvider(groq, request);
    const defaults = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(defaults).not.toHaveProperty('max_tokens');
    expect(defaults).not.toHaveProperty('response_format');
  });
  it('leaves managed requests unchanged and rejects incomplete or unsafe selections', () => {
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    withPersonalProvider({ get: () => undefined }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    for (const headers of [
      { 'X-StudyPod-Provider': 'groq' },
      { 'X-StudyPod-Api-Key': groq.key },
      { 'X-StudyPod-Provider': 'unknown', 'X-StudyPod-Api-Key': groq.key },
      { 'X-StudyPod-Provider': 'groq', 'X-StudyPod-Api-Key': 'has whitespace' },
      { 'X-StudyPod-Provider': 'groq', 'X-StudyPod-Api-Key': groq.key, 'X-StudyPod-Model': '../bad model' },
    ]) {
      withPersonalProvider({ get: (name) => headers[name] }, res, next);
      expect(res.status).toHaveBeenLastCalledWith(400);
      expect(res.json).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'PERSONAL_PROVIDER_INVALID_CONFIG' }));
    }
    expect(next).toHaveBeenCalledTimes(1);
    expect(getPersonalProvider()).toBeUndefined();
  });

  it('checks authorization through models only without exposing the key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ data: [{ id: groq.model }] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await runWithPersonalProvider(groq, () => testPersonalProvider());
    expect(result).toMatchObject({ connected: true, provider: 'groq', model: groq.model, verification: 'models' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.groq.com/openai/v1/models', expect.objectContaining({ method: 'GET' }));
    expect(JSON.stringify(result)).not.toContain(groq.key);
    expect(getPersonalProvider()).toBeUndefined();
  });

  it('does not fall back to deployment providers when a selected key fails', async () => {
    vi.stubEnv('GROQ_API_KEY', 'managed-key-must-not-be-used');
    vi.stubEnv('GEMINI_API_KEY', 'managed-gemini-must-not-be-used');
    const fetchMock = vi.fn().mockResolvedValue(response({ error: { message: groq.key } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    await expect(runWithPersonalProvider(groq, () => dispatchToTitan(request))).rejects.toMatchObject({
      code: 'PERSONAL_PROVIDER_AUTH', status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${groq.key}`);
    expect(process.env.GROQ_API_KEY).toBe('managed-key-must-not-be-used');
    expect(getPersonalProvider()).toBeUndefined();
  });

  it('keeps concurrent Groq and Gemini credentials and models isolated', async () => {
    const fetchMock = vi.fn(async (url, options) => {
      await Promise.resolve();
      const expected = url.includes('googleapis.com') ? gemini : groq;
      expect(options.headers.Authorization).toBe(`Bearer ${expected.key}`);
      expect(JSON.parse(options.body).model).toBe(expected.model);
      return response({ choices: [{ message: { content: expected.provider } }], usage: { total_tokens: 7 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const answers = await Promise.all([groq, gemini].map(context => runWithPersonalProvider(context, async () => {
      await Promise.resolve();
      expect(getPersonalProvider()).toBe(context);
      return dispatchToTitan(request);
    })));
    expect(answers.map(result => result.answer)).toEqual(['groq', 'gemini']);
    expect(answers.map(result => result.modelUsed)).toEqual([groq.model, gemini.model]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getPersonalProvider()).toBeUndefined();
  });

  it('returns safe quota and network errors without the upstream response or credential', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: { message: groq.key } }, 429)));
    await expect(generateWithPersonalProvider(groq, request)).rejects.toMatchObject({ code: 'PERSONAL_PROVIDER_QUOTA', status: 429 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`connection failure ${groq.key}`)));
    try { await generateWithPersonalProvider(groq, request); }
    catch (error) {
      expect(error.code).toBe('PERSONAL_PROVIDER_UNAVAILABLE');
      expect(error.message).not.toContain(groq.key);
    }
  });

  it('requires the chosen model to be available for the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ data: [{ id: 'another-model' }] })));
    await expect(testPersonalProvider(gemini)).rejects.toMatchObject({ code: 'PERSONAL_PROVIDER_MODEL', status: 422 });
  });
});
