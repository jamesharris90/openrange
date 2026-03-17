"use client";

import {
  Bell,
  Calendar,
  Flame,
  Gauge,
  LayoutDashboard,
  Radar,
  Settings,
  Shield,
  TrendingUp,
  Workflow,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/markets", label: "Markets", icon: TrendingUp },
  { href: "/heat-map", label: "Heat Map", icon: Workflow },
  { href: "/stocks-in-play", label: "Stocks In Play", icon: Flame },
  { href: "/catalyst-scanner", label: "Catalyst Scanner", icon: Radar },
  { href: "/trading-terminal", label: "Trading Terminal", icon: Gauge },
  { href: "/research/AAPL", label: "Research", icon: Zap },
  { href: "/earnings", label: "Earnings Calendar", icon: Calendar },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/admin", label: "Admin", icon: Shield },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const navRef = useRef<HTMLDivElement | null>(null);

  const onNavKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = navRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-nav-item='true']") || [];
    if (!items.length) return;

    const currentIndex = Array.from(items).findIndex((item) => item === document.activeElement);
    const nextIndex =
      event.key === "ArrowDown"
        ? (currentIndex + 1 + items.length) % items.length
        : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
    event.preventDefault();
  };

  return (
    <aside
      className={cn(
        "hidden border-r border-slate-800 bg-panel/90 p-3 lg:flex lg:flex-col",
        collapsed ? "w-[78px]" : "w-64"
      )}
      aria-label="Primary"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className={cn("font-semibold tracking-wide text-slate-100", collapsed && "sr-only")}>
          OpenRange
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => setCollapsed((value) => !value)}
          aria-label="Collapse sidebar"
        >
          <span className="text-xs">{collapsed ? ">" : "<"}</span>
        </Button>
      </div>
      <nav className="space-y-1" role="navigation" aria-label="Trading sections" onKeyDown={onNavKeyDown} ref={navRef}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href.startsWith("/research") && pathname.startsWith("/research/")) ||
            (item.href === "/trading-terminal" && pathname.startsWith("/trading-terminal"));
          return (
            <Link
              key={item.href}
              href={item.href}
              data-nav-item="true"
              className={cn(
                "flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-xs font-medium text-slate-300 outline-none transition",
                "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
                isActive
                  ? "border-slate-700 bg-slate-900 text-slate-100"
                  : "hover:border-slate-700 hover:bg-slate-900/70 hover:text-slate-100"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
