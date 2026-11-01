import { AsyncLocalStorage } from 'node:async_hooks';

// Credentials live only for this request. Never write this context to logs or storage.
const requestContext = new AsyncLocalStorage();
const providers = {
  groq: { base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
};

export function personalProviderError(code, message, status = 400) {
  return Object.assign(new Error(message), { code: `PERSONAL_PROVIDER_${code}`, status });
}
export const isPersonalProviderError = (error) => String(error?.code || '').startsWith('PERSONAL_PROVIDER_');
export const getPersonalProvider = () => requestContext.getStore();
export const runWithPersonalProvider = (context, callback) => requestContext.run(context, callback);

export function sendPersonalProviderError(res, error) {
  if (!isPersonalProviderError(error)) return false;
  res.status(error.status || 502).json({ error: error.message, code: error.code });
  return true;
}

export function withPersonalProvider(req, res, next) {
  const provider = req.get('X-StudyPod-Provider');
  const key = req.get('X-StudyPod-Api-Key');
  const requestedModel = req.get('X-StudyPod-Model');
  if (provider === undefined && key === undefined && requestedModel === undefined) return next();
  if (!Object.hasOwn(providers, provider) || typeof key !== 'string' || key.length < 8 || key.length > 1024 || /[^\x21-\x7e]/.test(key)) {
    return sendPersonalProviderError(res, personalProviderError('INVALID_CONFIG', 'Choose Groq or Gemini and enter a valid API key.'));
  }
  const model = requestedModel || providers[provider].model;
  if (typeof model !== 'string' || model.length > 120 || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(model)) {
    return sendPersonalProviderError(res, personalProviderError('INVALID_CONFIG', 'Enter a valid model name.'));
  }
  return requestContext.run({ provider, key, model }, next);
}

async function providerRequest(context, path, { body, signal, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, Math.max(1, Math.min(60_000, Number.isFinite(timeoutMs) ? timeoutMs : 30_000)));
  try {
    const response = await fetch(`${providers[context.provider].base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${context.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw personalProviderError('AUTH', 'The selected provider rejected this key. Check the key and its permissions.', 401);
      if (response.status === 429) throw personalProviderError('QUOTA', 'The selected provider has reached its rate or quota limit. Wait or choose another provider.', 429);
      if (response.status === 400 || response.status === 404) throw personalProviderError('MODEL', 'The selected provider could not use this model. Check its model name and availability.', 422);
      throw personalProviderError('UNAVAILABLE', 'The selected provider is temporarily unavailable. Retry or choose another provider.', 502);
    }
    return await response.json();
  } catch (error) {
    if (isPersonalProviderError(error)) throw error;
    if (controller.signal.aborted) throw personalProviderError('TIMEOUT', 'The selected provider request timed out or was cancelled. Please retry.', 504);
    throw personalProviderError('UNAVAILABLE', 'Could not reach the selected provider. Check your connection and retry.', 502);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function testPersonalProvider(context = getPersonalProvider()) {
  if (!context) throw personalProviderError('INVALID_CONFIG', 'Choose a provider and enter its API key first.');
  const result = await providerRequest(context, '/models');
  const models = (Array.isArray(result?.data) ? result.data : []).map((model) => model?.id).filter((id) => typeof id === 'string').slice(0, 200);
  if (!models.includes(context.model)) throw personalProviderError('MODEL', 'This model is not available for your key. Check the model name on the provider site.', 422);
  return { connected: true, provider: context.provider, model: context.model, models, verification: 'models' };
}

export async function generateWithPersonalProvider(context, { messages, temperature = 0.7, timeoutMs, signal, maxOutputTokens, jsonMode }) {
  const result = await providerRequest(context, '/chat/completions', { body: { model: context.model, messages, temperature,
    ...(maxOutputTokens === undefined ? {} : { max_tokens: maxOutputTokens }),
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  }, timeoutMs, signal });
  const answer = result?.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) throw personalProviderError('UNAVAILABLE', 'The selected provider returned no answer. Please retry.', 502);
  return { answer, tokensUsed: result.usage?.total_tokens || 0, modelUsed: context.model };
}
