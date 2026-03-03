import { useContext } from 'react';
import { SymbolDataContext } from './SymbolDataContext';

export function useSymbolData() {
  const context = useContext(SymbolDataContext);
  if (!context) {
    throw new Error('useSymbolData must be used within a SymbolDataProvider');
  }
  return context;
}
