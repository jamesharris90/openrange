import { useEffect, useState } from 'react';

const STORAGE_PREFIX = 'openrange:beacon-overlay:';

export default function useBeaconOverlayVisibility(surfaceKey, defaultEnabled = true) {
  const storageKey = `${STORAGE_PREFIX}${surfaceKey}`;

  const [showBeaconSignals, setShowBeaconSignals] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored == null) return defaultEnabled;
      return stored === '1';
    } catch {
      return defaultEnabled;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, showBeaconSignals ? '1' : '0');
    } catch {
      // Ignore storage exceptions in restricted environments.
    }
  }, [storageKey, showBeaconSignals]);

  return {
    showBeaconSignals,
    setShowBeaconSignals,
    toggleBeaconSignals: () => setShowBeaconSignals((current) => !current),
  };
}
