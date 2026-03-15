import { createContext, useContext } from 'react';

export const UnifiedFiltersContext = createContext(null);

export function useUnifiedFiltersContext() {
  const value = useContext(UnifiedFiltersContext);
  if (!value) throw new Error('useUnifiedFiltersContext must be used inside UnifiedFiltersProvider');
  return value;
}
