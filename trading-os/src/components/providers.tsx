"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { useEffect } from "react";

import { AuthProvider } from "@/context/AuthContext";
import { LegacyServiceWorkerCleanup } from "@/components/legacy-service-worker-cleanup";
import { startLiveDataBus, stopLiveDataBus } from "@/lib/live-data";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      staleTime: 30000,
    },
  },
});

function LiveDataBridge({ queryClient }: { queryClient: QueryClient }) {
  useEffect(() => {
    startLiveDataBus(queryClient);
    return () => stopLiveDataBus();
  }, [queryClient]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LegacyServiceWorkerCleanup />
          <LiveDataBridge queryClient={queryClient} />
          {children}
        </AuthProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
