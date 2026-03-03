import React, { createContext, useContext, useMemo, useState } from 'react';

type BrokerName = 'IBKR' | null;

type BrokerState = {
  connected: boolean;
  broker: BrokerName;
  sessionToken: string | null;
  connectIbkr: () => void;
  disconnect: () => void;
};

const BrokerContext = createContext<BrokerState | null>(null);

export function BrokerProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [broker, setBroker] = useState<BrokerName>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const value = useMemo<BrokerState>(() => ({
    connected,
    broker,
    sessionToken,
    connectIbkr: () => {
      setConnected(true);
      setBroker('IBKR');
      setSessionToken(`mock-${Date.now()}`);
    },
    disconnect: () => {
      setConnected(false);
      setBroker(null);
      setSessionToken(null);
    },
  }), [connected, broker, sessionToken]);

  return <BrokerContext.Provider value={value}>{children}</BrokerContext.Provider>;
}

export function useBroker() {
  const context = useContext(BrokerContext);
  if (!context) {
    throw new Error('useBroker must be used within BrokerProvider');
  }
  return context;
}
