import dynamic from "next/dynamic";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trading Terminal | OpenRange",
  description: "Multi-chart trading cockpit with watchlist, AI narrative, and entry/stop/target levels.",
};

const TradingTerminalView = dynamic(
  () => import("@/components/terminal/trading-terminal-view").then((m) => ({ default: m.TradingTerminalView })),
  { ssr: false }
);

export default function TerminalPage() {
  return <TradingTerminalView />;
}
