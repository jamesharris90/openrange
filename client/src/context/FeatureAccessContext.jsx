import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { authFetchJSON } from '../utils/api';
import { ALL_FEATURE_KEYS } from '../config/features';

const FeatureAccessContext = createContext(null);

function buildEmptyFeatures() {
  const map = {};
  for (const key of ALL_FEATURE_KEYS) {
    map[key] = false;
  }
  return map;
}

export function FeatureAccessProvider({ children }) {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [role, setRole] = useState('free');
  const [features, setFeatures] = useState(buildEmptyFeatures());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refreshFeatures = useCallback(async () => {
    if (!isAuthenticated) {
      setRole('free');
      setFeatures(buildEmptyFeatures());
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = await authFetchJSON('/api/features/me');
      const incoming = payload?.features && typeof payload.features === 'object' ? payload.features : {};
      setRole(String(payload?.role || 'free'));
      setFeatures({ ...buildEmptyFeatures(), ...incoming });
    } catch (err) {
      setRole('free');
      setFeatures(buildEmptyFeatures());
      setError(err?.message || 'Failed to load feature access');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (authLoading) return;
    refreshFeatures();
  }, [authLoading, refreshFeatures]);

  const value = useMemo(() => ({
    role,
    features,
    loading,
    error,
    refreshFeatures,
    hasFeature: (featureKey) => Boolean(features?.[featureKey]),
    isAdmin: role === 'admin',
  }), [role, features, loading, error, refreshFeatures]);

  return (
    <FeatureAccessContext.Provider value={value}>
      {children}
    </FeatureAccessContext.Provider>
  );
}

export function useFeatureAccessContext() {
  const ctx = useContext(FeatureAccessContext);
  if (!ctx) throw new Error('useFeatureAccessContext must be used within FeatureAccessProvider');
  return ctx;
}
