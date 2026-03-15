import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Cleanup after each test
afterEach(() => {
  cleanup();
  localStorage.clear();
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => {
      const keys = Object.keys(store);
      return keys[index] || null;
    },
  };
})();

global.localStorage = localStorageMock as Storage;

// Mock crypto for password hashing
if (!global.crypto) {
  // Use a more modern approach for crypto if needed, but for tests this is often handled by the environment
  // or specifically stubbed.
  Object.defineProperty(global, 'crypto', {
    value: {
      webcrypto: {
        subtle: {}, // Basic stub
        getRandomValues: (arr: Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array) => arr
      }
    },
    writable: true
  });
}

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as unknown as typeof IntersectionObserver;

// Mock speechSynthesis for podcast tests
global.speechSynthesis = {
  speak: vi.fn(),
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  getVoices: vi.fn(() => [
    { name: 'Google US English Male', lang: 'en-US', voiceURI: 'test', localService: true, default: true },
    { name: 'Google US English Female', lang: 'en-US', voiceURI: 'test2', localService: true, default: false },
  ] as SpeechSynthesisVoice[]),
  pending: false,
  speaking: false,
  paused: false,
  onvoiceschanged: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
} as unknown as SpeechSynthesis;

// Mock fetch
global.fetch = vi.fn();

console.log('✅ Test setup complete');
