import { redirect } from "next/navigation";

export default function LegacyTradingCockpitRedirect() {
  redirect("/trading-terminal");
}
