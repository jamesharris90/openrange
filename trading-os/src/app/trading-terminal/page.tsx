import type { Metadata } from "next";
import { Suspense } from "react";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { TradingTerminalView } from "@/components/terminal/trading-terminal-view";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(
  "Trading Terminal | OpenRange",
  "Multi-panel terminal workspace with synchronized charts, watchlist, signals, and narrative intelligence.",
  "/trading-terminal"
);

export default function TradingTerminalPage() {
  return (
    <ProtectedRoute>
      <Suspense
        fallback={<div className="rounded-2xl border border-slate-800 bg-panel p-4 text-sm text-slate-400">Loading terminal...</div>}
      >
        <TradingTerminalView />
      </Suspense>
    </ProtectedRoute>
  );
}
