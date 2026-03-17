import { redirect } from "next/navigation";

export default function LegacyStockRedirect({ params }: { params: { ticker: string } }) {
  redirect(`/research/${params.ticker.toUpperCase()}`);
}
