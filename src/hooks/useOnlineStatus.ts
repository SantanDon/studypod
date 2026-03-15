/**
 * Hook for detecting online/offline status
 * 
 * Monitors network connectivity and updates sync store.
 */

import { useEffect } from 'react';
import { useSyncStore } from '@/stores/syncStore';

export function useOnlineStatus() {
  const { isOnline, setOnline } = useSyncStore();

  useEffect(() => {
    // Set initial status
    setOnline(navigator.onLine);

    // Listen for online/offline events
    const handleOnline = () => {
      console.log('Network: Online');
      setOnline(true);
    };

    const handleOffline = () => {
      console.log('Network: Offline');
      setOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnline]);

  return isOnline;
}
