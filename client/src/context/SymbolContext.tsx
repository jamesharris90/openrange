import React, { createContext, useContext, useState } from 'react';

type SymbolContextType = {
  symbol: string;
  setSymbol: (symbol: string) => void;
};

const SymbolContext = createContext<SymbolContextType | null>(null);

export function SymbolProvider({ children }: { children: React.ReactNode }) {
  const [symbol, setSymbol] = useState('AAPL');

  return (
    <SymbolContext.Provider value={{ symbol, setSymbol }}>
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
