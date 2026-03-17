"use client";

import { useEffect } from "react";

import type { AlertRow, HeatmapRow, Opportunity } from "@/lib/types";
import { useTickerStore } from "@/lib/store/ticker-store";

type StreamEvent =
  | {
      type: "quote";
      symbol: string;
      price?: number;
      change?: number;
      volume?: number;
      timestamp?: number;
    }
  | {
      type: "signal";
      symbol: string;
      strategy?: string;
      probability?: number;
      confidence?: number;
      expected_move?: number;
      timestamp?: number;
    }
  | {
      type: "alert";
      id?: string;
      symbol: string;
      signal?: string;
      probability?: number;
      confidence?: number;
      timestamp?: number;
    }
  | {
      type: "heatmap_update";
      rows?: HeatmapRow[];
      timestamp?: number;
    }
  | {
      type: "catalyst";
      symbol: string;
      catalyst?: string;
      impact?: number;
      timestamp?: number;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function useMarketStream() {
  const updateQuote = useTickerStore((state) => state.updateQuote);
  const updateSignal = useTickerStore((state) => state.updateSignal);
  const updateAlert = useTickerStore((state) => state.updateAlert);
  const updateHeatmap = useTickerStore((state) => state.updateHeatmap);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE || "";
    const eventSource = new EventSource(`${base}/api/stream/market`);

    eventSource.onmessage = (message) => {
      let event: StreamEvent;

      try {
        event = JSON.parse(message.data) as StreamEvent;
      } catch {
        return;
      }

      if (event.type === "quote" && typeof event.symbol === "string") {
        updateQuote({
          symbol: event.symbol.toUpperCase(),
          price: asNumber(event.price),
          change_percent: asNumber(event.change),
          volume_24h: asNumber(event.volume),
        });
        return;
      }

      if (event.type === "signal" && typeof event.symbol === "string") {
        const signal: Opportunity = {
          symbol: event.symbol.toUpperCase(),
          strategy: String(event.strategy || "Signal"),
          probability: Math.max(1, Math.min(99, asNumber(event.probability, 50))),
          confidence: Math.max(1, Math.min(99, asNumber(event.confidence, 60))),
          expected_move: asNumber(event.expected_move),
        };
        updateSignal(signal);
        return;
      }

      if (event.type === "alert" && typeof event.symbol === "string") {
        const timestamp = asNumber(event.timestamp, Date.now());
        const alert: AlertRow = {
          id: String(event.id || `${event.symbol}-${timestamp}`),
          timestamp: new Date(timestamp).toISOString(),
          symbol: event.symbol.toUpperCase(),
          signal: String(event.signal || "Alert"),
          probability: Math.max(1, Math.min(99, asNumber(event.probability, 50))),
          confidence: Math.max(1, Math.min(99, asNumber(event.confidence, 60))),
          sparkline: [],
        };
        updateAlert(alert);
        return;
      }

      if (event.type === "heatmap_update") {
        if (Array.isArray(event.rows)) {
          updateHeatmap(event.rows);
        }
        return;
      }

      if (event.type === "catalyst" && typeof event.symbol === "string") {
        updateSignal({
          symbol: event.symbol.toUpperCase(),
          strategy: String(event.catalyst || "Catalyst"),
          probability: Math.max(1, Math.min(99, asNumber(event.impact, 50))),
          confidence: Math.max(1, Math.min(99, 50 + asNumber(event.impact, 0) * 0.5)),
          expected_move: Number((asNumber(event.impact, 0) / 10).toFixed(2)),
        });
      }
    };

    return () => {
      eventSource.close();
    };
  }, [updateAlert, updateHeatmap, updateQuote, updateSignal]);
}
