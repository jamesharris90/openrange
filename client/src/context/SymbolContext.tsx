import React, { createContext, useContext, useMemo, useState } from 'react';

type SymbolContextType = {
  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;
  symbol: string;
  setSymbol: (symbol: string) => void;
};

const SymbolContext = createContext<SymbolContextType | null>(null);
const DEFAULT_SYMBOL = 'SPY';

export function SymbolProvider({ children }: { children: React.ReactNode }) {
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
  const value = useMemo(
    () => ({
      selectedSymbol,
      setSelectedSymbol,
      symbol: selectedSymbol,
      setSymbol: setSelectedSymbol,
    }),
    [selectedSymbol]
  );

  return (
    <SymbolContext.Provider value={value}>
      {children}
    </SymbolContext.Provider>
  );
}

export function useSymbol() {
  const context = useContext(SymbolContext);
  if (!context) {
    throw new Error('useSymbol must be inside SymbolProvider');
  }
  return context;
}
