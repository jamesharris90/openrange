import type { Metadata } from "next";

import { ProtectedRoute } from "@/components/auth/protected-route";
import { CatalystScannerView } from "@/components/terminal/catalyst-scanner-view";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata(
  "Catalyst Scanner | OpenRange Terminal",
  "Grouped earnings, news, gap, volume, sector, and accumulation catalyst signals.",
  "/catalyst-scanner"
);

export default function CatalystScannerPage() {
  return (
    <ProtectedRoute>
      <CatalystScannerView />
    </ProtectedRoute>
  );
}

