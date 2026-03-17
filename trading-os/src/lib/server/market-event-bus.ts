type MarketEvent = {
  type: "quote" | "signal" | "alert" | "heatmap_update" | "catalyst";
  timestamp: number;
  [key: string]: unknown;
};

type MarketListener = (event: MarketEvent) => void;

const listeners = new Set<MarketListener>();

export function addClient(listener: MarketListener) {
  listeners.add(listener);
}

export function removeClient(listener: MarketListener) {
  listeners.delete(listener);
}

export function broadcast(event: MarketEvent) {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      listeners.delete(listener);
    }
  });
}
