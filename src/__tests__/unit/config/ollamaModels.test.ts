import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it('pins generation tasks to the configured local model while keeping embeddings separate', async () => {
  vi.stubEnv('VITE_OLLAMA_MODEL', ' qwen3.5:9b ');
  const { getModelForTask } = await import('@/config/ollamaModels');
  for (const task of ['chat', 'summarize', 'image', 'code', 'text', 'title'] as const) {
    expect(getModelForTask(task)).toBe('qwen3.5:9b');
  }
  expect(getModelForTask('embeddings')).toBe('dengcao/Qwen3-Embedding-0.6B:Q8_0');
});

it('retains task defaults when the deployment model is blank', async () => {
  vi.stubEnv('VITE_OLLAMA_MODEL', ' ');
  const { getModelForTask } = await import('@/config/ollamaModels');
  expect(getModelForTask('chat')).toBe('llama3.2:1b');
  expect(getModelForTask('code')).toBe('phi:2.7b');
});
