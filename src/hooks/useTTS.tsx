import { useState, useEffect, useCallback } from 'react';

export interface VoiceOption {
  voice: SpeechSynthesisVoice;
  label: string;
  lang: string;
}

export interface TTSSettings {
  host1Voice: string;
  host2Voice: string;
  rate: number;
  pitch: number;
}

const DEFAULT_SETTINGS: TTSSettings = {
  host1Voice: '',
  host2Voice: '',
  rate: 1.0,
  pitch: 1.0,
};

const STORAGE_KEY = 'tts_settings';

function getSettingsFromStorage(): TTSSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettingsToStorage(settings: TTSSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useTTS() {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [settings, setSettings] = useState<TTSSettings>(getSettingsFromStorage);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setIsSupported(false);
      return;
    }

    setIsSupported(true);

    const loadVoices = () => {
      const synth = window.speechSynthesis;
      const availableVoices = synth.getVoices();
      
      const voiceOptions: VoiceOption[] = availableVoices.map((voice) => ({
        voice,
        label: `${voice.name} (${voice.lang})`,
        lang: voice.lang,
      }));

      // Sort by language and name
      voiceOptions.sort((a, b) => {
        if (a.lang !== b.lang) return a.lang.localeCompare(b.lang);
        return a.voice.name.localeCompare(b.voice.name);
      });

      setVoices(voiceOptions);

      // Set default voices if not set
      if (!settings.host1Voice && voiceOptions.length > 0) {
        const englishVoices = voiceOptions.filter(v => v.lang.startsWith('en'));
        const maleVoice = englishVoices.find(v => 
          v.voice.name.toLowerCase().includes('male') || 
          v.voice.name.includes('David') ||
          v.voice.name.includes('Daniel')
        ) || englishVoices[0] || voiceOptions[0];
        
        const femaleVoice = englishVoices.find(v => 
          v.voice.name.toLowerCase().includes('female') || 
          v.voice.name.includes('Zira') ||
          v.voice.name.includes('Samantha')
        ) || englishVoices[1] || voiceOptions[1] || voiceOptions[0];

        setSettings(prev => ({
          ...prev,
          host1Voice: maleVoice?.voice.name || '',
          host2Voice: femaleVoice?.voice.name || '',
        }));
      }
    };

    // Load immediately and on change
    loadVoices();
    
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSettings = useCallback((newSettings: Partial<TTSSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      saveSettingsToStorage(updated);
      return updated;
    });
  }, []);

  const getVoice = useCallback((voiceName: string): SpeechSynthesisVoice | null => {
    return voices.find(v => v.voice.name === voiceName)?.voice || null;
  }, [voices]);

  const speak = useCallback((text: string, voiceName?: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!isSupported) {
        reject(new Error('TTS not supported'));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      
      if (voiceName) {
        const voice = getVoice(voiceName);
        if (voice) utterance.voice = voice;
      }

      utterance.rate = settings.rate;
      utterance.pitch = settings.pitch;

      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(e);

      window.speechSynthesis.speak(utterance);
    });
  }, [isSupported, settings, getVoice]);

  const stop = useCallback(() => {
    if (isSupported) {
      window.speechSynthesis.cancel();
    }
  }, [isSupported]);

  return {
    voices,
    settings,
    updateSettings,
    getVoice,
    speak,
    stop,
    isSupported,
  };
}
