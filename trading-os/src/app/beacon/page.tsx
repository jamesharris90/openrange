"use client";

import BeaconHeader from "@/components/beacon/BeaconHeader";
import { V0PreviewTab } from "@/components/beacon/V0PreviewTab";

export default function BeaconPage() {
  return (
    <div className="flex flex-col gap-6 p-1 sm:p-2">
      <BeaconHeader />
      <V0PreviewTab />
    </div>
  );
}