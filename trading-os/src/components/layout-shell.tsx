"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/topbar";

const PUBLIC_ROUTES = new Set(["/", "/login", "/signup", "/coverage-campaign"]);

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_ROUTES.has(pathname);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  if (isPublic) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      {mobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-slate-950/70 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}
      <Sidebar mobile open={mobileSidebarOpen} onNavigate={() => setMobileSidebarOpen(false)} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <TopBar onOpenMobileNav={() => setMobileSidebarOpen(true)} />
        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
