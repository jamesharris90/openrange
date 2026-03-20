import { asObject, asString } from "./parse";

export type SystemHealthSnapshot = {
  backend: string;
  db: string;
  quotes: string;
  ohlc: string;
  data: Record<string, unknown>;
};

export function adaptSystemHealthPayload(payload: unknown): SystemHealthSnapshot {
  const root = asObject(payload);
  return {
    backend: asString(root.backend, "unknown"),
    db: asString(root.db, "unknown"),
    quotes: asString(root.quotes, "unknown"),
    ohlc: asString(root.ohlc, "unknown"),
    data: asObject(root.data),
  };
}
