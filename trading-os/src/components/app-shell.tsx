"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { PageContainer } from "@/components/page-container";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/topbar";
import { CommandPalette } from "@/components/command-palette";
import { useMarketStream } from "@/lib/hooks/useMarketStream";

import { ReactNode, useState } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  useMarketStream();

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
        <div className="min-h-screen bg-background text-foreground">

          <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_4%_0%,rgba(59,130,246,0.10),transparent_35%),radial-gradient(circle_at_95%_10%,rgba(22,199,132,0.08),transparent_35%)]" />

          <div className="relative mx-auto flex min-h-screen w-full max-w-[1920px]">

            <Sidebar />

            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar />

              <PageContainer>
                {children}
              </PageContainer>
            </div>
          </div>

          <CommandPalette />

        </div>
      </QueryClientProvider>
    </ThemeProvider>
  );
}