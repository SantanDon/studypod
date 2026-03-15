/**
 * Encryption state store using Zustand
 * 
 * Manages encryption keys and authentication state.
 * Keys are kept in memory only, never persisted.
 */

import { create } from 'zustand';

interface EncryptionState {
  // Key state (in-memory only)
  masterKey: CryptoKey | null;
  salt: Uint8Array | null;
  isUnlocked: boolean;
  
  // User info
  userId: string | null;
  
  // Actions
  setMasterKey: (key: CryptoKey, salt: Uint8Array, userId: string) => void;
  setUnlockedOnly: (userId: string) => void;
  clearMasterKey: () => void;
  isKeyAvailable: () => boolean;
}

export const useEncryptionStore = create<EncryptionState>((set, get) => ({
  // Initial state
  masterKey: null,
  salt: null,
  isUnlocked: false,
  userId: null,

  // Set master key (after successful authentication)
  setMasterKey: (key, salt, userId) => {
    // Set current user as global pointer
    localStorage.setItem('current_user_id', userId);
    
    set({
      masterKey: key,
      salt,
      isUnlocked: true,
      userId,
    });
  },

  // Set unlocked state without a master key (for cloud/guest roles with managed encryption)
  setUnlockedOnly: (userId) => {
    localStorage.setItem('current_user_id', userId);
    set({
      masterKey: null,
      salt: null,
      isUnlocked: true,
      userId,
    });
  },

  // Clear master key (on logout or timeout)
  clearMasterKey: () => {
    // Clear current user pointer
    localStorage.removeItem('current_user_id');
    
    set({
      masterKey: null,
      salt: null,
      isUnlocked: false,
      userId: null,
    });
  },

  // Check if key is available
  isKeyAvailable: () => {
    const state = get();
    return state.masterKey !== null && state.isUnlocked;
  },
}));

/**
 * Individual selectors
 */
export function useIsUnlocked(): boolean {
  return useEncryptionStore((state) => state.isUnlocked);
}

export function useMasterKey(): CryptoKey | null {
  return useEncryptionStore((state) => state.masterKey);
}

export function useUserId(): string | null {
  return useEncryptionStore((state) => state.userId);
}
