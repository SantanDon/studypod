/**
 * Visual Effects Settings Store
 * Manages user preferences for UI animations and effects
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface VisualEffectsSettings {
  // Metallic text effect for headings
  metallicTextEnabled: boolean;
  metallicTextSpeed: number;
  
  // Ribbon cursor trail effect
  ribbonCursorEnabled: boolean;
  ribbonCount: number;
  ribbonOpacity: number;
  ribbonThickness: number;
  
  // Font settings
  useCustomFonts: boolean;
  headingFont: 'space-grotesk' | 'default';
  bodyFont: 'source-sans' | 'default';
}

interface VisualEffectsStore extends VisualEffectsSettings {
  // Actions
  setMetallicTextEnabled: (enabled: boolean) => void;
  setMetallicTextSpeed: (speed: number) => void;
  setRibbonCursorEnabled: (enabled: boolean) => void;
  setRibbonCount: (count: number) => void;
  setRibbonOpacity: (opacity: number) => void;
  setRibbonThickness: (thickness: number) => void;
  setUseCustomFonts: (enabled: boolean) => void;
  setHeadingFont: (font: 'space-grotesk' | 'default') => void;
  setBodyFont: (font: 'source-sans' | 'default') => void;
  resetToDefaults: () => void;
}

const defaultSettings: VisualEffectsSettings = {
  metallicTextEnabled: true,
  metallicTextSpeed: 0.02,
  ribbonCursorEnabled: false, // Off by default as it can be distracting
  ribbonCount: 3,
  ribbonOpacity: 0.5,
  ribbonThickness: 20,
  useCustomFonts: true,
  headingFont: 'space-grotesk',
  bodyFont: 'source-sans',
};

export const useVisualEffectsStore = create<VisualEffectsStore>()(
  persist(
    (set) => ({
      ...defaultSettings,
      
      setMetallicTextEnabled: (enabled) => set({ metallicTextEnabled: enabled }),
      setMetallicTextSpeed: (speed) => set({ metallicTextSpeed: speed }),
      setRibbonCursorEnabled: (enabled) => set({ ribbonCursorEnabled: enabled }),
      setRibbonCount: (count) => set({ ribbonCount: count }),
      setRibbonOpacity: (opacity) => set({ ribbonOpacity: opacity }),
      setRibbonThickness: (thickness) => set({ ribbonThickness: thickness }),
      setUseCustomFonts: (enabled) => set({ useCustomFonts: enabled }),
      setHeadingFont: (font) => set({ headingFont: font }),
      setBodyFont: (font) => set({ bodyFont: font }),
      resetToDefaults: () => set(defaultSettings),
    }),
    {
      name: 'visual-effects-settings',
    }
  )
);
