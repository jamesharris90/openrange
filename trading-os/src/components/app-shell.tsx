"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { ReactNode, useEffect, useState } from "react";

import { CommandPalette } from "@/components/command-palette";
import { PageContainer } from "@/components/page-container";
import { useMarketStream } from "@/lib/hooks/useMarketStream";
import { API_BASE } from "@/lib/apiBase";

export function AppShell({ children }: { children: ReactNode }) {
  useMarketStream();
  const [backendWarning, setBackendWarning] = useState<string | null>(null);

  useEffect(() => {
    (window as Window & { __OR_DEBUG__?: boolean }).__OR_DEBUG__ = true;
  }, []);

  useEffect(() => {
    let mounted = true;

    async function checkBackend(): Promise<void> {
      try {
        const response = await fetch(`${API_BASE}/api/health`, {
          method: "GET",
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          throw new Error(`Health check returned ${response.status}`);
        }
        if (mounted) setBackendWarning(null);
      } catch (error) {
        if (mounted) {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.warn(`[AppShell] Backend unreachable at ${API_BASE}: ${message}`);
          setBackendWarning(`Backend unavailable — ${message}`);
        }
      }
    }

    checkBackend();
    return () => { mounted = false; };
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            staleTime: 30000,
          },
        },
      })
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <QueryClientProvider client={queryClient}>
        <>
          {backendWarning && (
            <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-amber-950/90 px-4 py-2 text-xs text-amber-300 backdrop-blur border-b border-amber-800/50">
              <span>⚠ {backendWarning}</span>
              <button onClick={() => setBackendWarning(null)} className="ml-4 text-amber-400 hover:text-white">✕</button>
            </div>
          )}
          <PageContainer>{children}</PageContainer>
          <CommandPalette />
        </>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
