"use client";

import { useState } from "react";

import BeaconHeader from "@/components/beacon/BeaconHeader";
import MorningPicksTab from "@/components/beacon/MorningPicksTab";
import StrategyGradesTab from "@/components/beacon/StrategyGradesTab";
import TrackRecordTab from "@/components/beacon/TrackRecordTab";
import { V0PreviewTab } from "@/components/beacon/V0PreviewTab";

type Tab = "picks" | "grades" | "track" | "v0";

export default function BeaconPage() {
  const [tab, setTab] = useState<Tab>("picks");

  return (
    <div className="flex flex-col gap-6 p-1 sm:p-2">
      <BeaconHeader activeTab={tab} onTabChange={setTab} />
      {tab === "picks" && <MorningPicksTab onViewGrades={() => setTab("grades")} />}
      {tab === "grades" && <StrategyGradesTab />}
      {tab === "track" && <TrackRecordTab />}
      {tab === "v0" && <V0PreviewTab />}
    </div>
  );
}