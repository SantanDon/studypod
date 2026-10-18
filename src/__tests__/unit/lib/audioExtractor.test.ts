import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { pipeline, transcriber } = vi.hoisted(() => ({ pipeline: vi.fn(), transcriber: vi.fn() }));
vi.mock('@huggingface/transformers', () => ({ pipeline, env: {} }));

describe('browser audio transcription boundaries', () => {
  const revoke = vi.fn();
  beforeEach(() => {
    vi.stubEnv('VITE_AUDIO_TRANSCRIPTION_MODEL', '');
    vi.resetModules();
    pipeline.mockReset().mockResolvedValue(transcriber);
    transcriber.mockReset().mockResolvedValue({ text: 'Clear spoken words.' });
    revoke.mockReset();
    vi.stubGlobal('AudioContext', class {});
    class TestURL extends URL {
      static createObjectURL = vi.fn(() => 'blob:recording');
      static revokeObjectURL = revoke;
    }
    vi.stubGlobal('URL', TestURL);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it.each([
    ['', 'onnx-community/whisper-tiny'],
    ['onnx-community/whisper-base', 'onnx-community/whisper-base'],
    ['unreviewed/arbitrary-model', 'onnx-community/whisper-tiny'],
  ])('uses only the default or approved isolated candidate %s', async (configured, expected) => {
    vi.stubEnv('VITE_AUDIO_TRANSCRIPTION_MODEL', configured);
    const { extractAudio } = await import('@/lib/extraction/audioExtractor');
    const result = await extractAudio(new File(['audio'], 'lecture.wav'));
    expect(pipeline).toHaveBeenCalledWith('automatic-speech-recognition', expected, expect.any(Object));
    expect(result.metadata.model).toBe(expected);
  });

  it('fails before downloading a model when browser decoding is unsupported', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const { extractAudio } = await import('@/lib/extraction/audioExtractor');
    await expect(extractAudio(new File(['audio'], 'lecture.wav'))).rejects.toThrow('Web Audio support');
    expect(pipeline).not.toHaveBeenCalled();
  });

  it('rejects an empty recording before downloading a model', async () => {
    const { extractAudio } = await import('@/lib/extraction/audioExtractor');
    await expect(extractAudio(new File([], 'lecture.wav'))).rejects.toThrow('audio file is empty');
    expect(pipeline).not.toHaveBeenCalled();
  });

  it.each([{ text: '' }, null, { text: 42 }])('rejects absent or invalid transcript output %j and releases audio', async (output) => {
    transcriber.mockResolvedValue(output);
    const { extractAudio } = await import('@/lib/extraction/audioExtractor');
    await expect(extractAudio(new File(['audio'], 'lecture.wav'))).rejects.toThrow('No speech transcript');
    expect(revoke).toHaveBeenCalledWith('blob:recording');
  });

  it('releases decoded input when transcription fails', async () => {
    transcriber.mockRejectedValue(new Error('Unsupported codec'));
    const { extractAudio } = await import('@/lib/extraction/audioExtractor');
    await expect(extractAudio(new File(['audio'], 'lecture.wav'))).rejects.toThrow('Unsupported codec');
    expect(revoke).toHaveBeenCalledWith('blob:recording');
  });

  it('shares concurrent model initialization and preserves the transcript', async () => {
    const { extractAudio } = await import('@/lib/extraction/audioExtractor');
    const results = await Promise.all([extractAudio(new File(['audio'], 'one.wav')), extractAudio(new File(['audio'], 'two.wav'))]);
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(results.map(result => result.text)).toEqual(['Clear spoken words.', 'Clear spoken words.']);
    expect(transcriber.mock.calls[0][1]).not.toHaveProperty('language');
  });

  it('allows retry after a model download failure', async () => {
    pipeline.mockRejectedValueOnce(new Error('Network unavailable'));
    const { extractAudio } = await import('@/lib/extraction/audioExtractor');
    await expect(extractAudio(new File(['audio'], 'lecture.wav'))).rejects.toThrow('download the Whisper model');
    expect((await extractAudio(new File(['audio'], 'lecture.wav'))).text).toBe('Clear spoken words.');
    expect(pipeline).toHaveBeenCalledTimes(2);
  });
});
