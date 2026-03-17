import { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queries/policy";

let intervalId: number | null = null;

export function startLiveDataBus(queryClient: QueryClient) {
  if (intervalId !== null) return;

  intervalId = window.setInterval(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.marketQuotes([]).slice(0, 2) });
    queryClient.invalidateQueries({ queryKey: ["fast", "chart"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.stocksInPlay({}).slice(0, 2) });
    queryClient.invalidateQueries({ queryKey: queryKeys.alerts.slice(0, 2) });
  }, 10000);
}

export function stopLiveDataBus() {
  if (intervalId === null) return;
  window.clearInterval(intervalId);
  intervalId = null;
}
