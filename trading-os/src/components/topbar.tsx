"use client";

import { Command } from "lucide-react";

import { TickerSearch } from "@/components/ticker-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-background/90 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <TickerSearch />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Command className="mr-1 size-3" />
            Cmd+K
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
