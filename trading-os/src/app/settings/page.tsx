import type { Metadata } from "next";

import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(
  "Settings | OpenRange",
  "Terminal preferences for default ticker, timeframe, and workspace behavior.",
  "/settings"
);

export default function SettingsPage() {
  return (
    <div className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Settings</div>
      <p className="text-sm text-slate-300">Workspace preference controls are ready for default ticker, timeframe, and panel persistence policies.</p>
    </div>
  );
}
