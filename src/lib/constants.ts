/**
 * Global Constants Configuration
 * Centralizing magic numbers and string literals across the app.
 */

export const TIMEOUTS = {
  OLLAMA_API_DEFAULT: 120000,
  OLLAMA_MODEL_LIST: 15000,
  OLLAMA_FAST_PING: 5000,
  WEB_EXTRACTION_DEFAULT: 30000,
  API_ABORT_DEFAULT: 10000,
  POLL_INTERVAL: 100,
  YIELD_DURATION: 20,
} as const;

export const UI_DELAYS = {
  TOAST_DISMISS: 2000,
  COPIED_FEEDBACK: 2000,
  RELOAD_DELAY: 1000,
  SCROLL_INTO_VIEW: 50,
  ANIMATION_STEP: 10,
} as const;

export const STORAGE_KEYS = {
  NOTEBOOKS: 'studylm_notebooks',
  SETTINGS: 'studylm_settings',
  THEME: 'studylm_theme',
} as const;

export const CHUNK_SIZES = {
  DEFAULT_DOCUMENT_CHUNK: 1000,
  DEFAULT_OVERLAP: 200,
} as const;
