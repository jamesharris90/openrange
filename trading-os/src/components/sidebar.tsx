"use client";

import {
  BarChart2,
  Bell,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Flame,
  Gauge,
  Globe,
  LayoutDashboard,
  Newspaper,
  Radar,
  Scan,
  Shield,
  TrendingDown,
  TrendingUp,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard",         label: "Dashboard",         icon: LayoutDashboard },
  { href: "/trading-terminal",  label: "Terminal",          icon: Gauge           },
  { href: "/screener-v2",       label: "Screener",          icon: Radar           },
  { href: "/screener",          label: "Legacy Screener (Do Not Use)", icon: Radar },
  { href: "/stocks-in-play",    label: "Stocks In Play",    icon: Flame           },
  { href: "/catalyst-scanner",  label: "Catalyst Scanner",  icon: Scan            },
  { href: "/stocks",            label: "Stocks",            icon: TrendingUp      },
  { href: "/markets",           label: "Markets",           icon: Globe           },
  { href: "/news-feed",         label: "News",              icon: Newspaper       },
  { href: "/earnings",          label: "Earnings",          icon: Calendar        },
  { href: "/ipos",              label: "IPO Calendar",      icon: TrendingDown    },
  { href: "/heat-map",          label: "Heatmap",           icon: Workflow        },
  { href: "/charts",            label: "Charts",            icon: BarChart2       },
  { href: "/alerts",            label: "Alerts",            icon: Bell            },
  { href: "/admin",             label: "Admin",             icon: Shield          },
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
        "hidden shrink-0 border-r border-slate-800 bg-[#0d1117] p-3 lg:flex lg:flex-col",
        collapsed ? "w-[60px]" : "w-56"
      )}
      aria-label="Primary navigation"
    >
      {/* Brand + collapse */}
      <div className="mb-5 flex items-center justify-between">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded bg-emerald-500/20">
              <Gauge className="size-3.5 text-emerald-400" />
            </div>
            <span className="text-sm font-semibold tracking-wide text-slate-100">OpenRange</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn("ml-auto text-slate-500 hover:text-slate-200", collapsed && "mx-auto")}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </Button>
      </div>

      {/* Nav */}
      <nav
        className="flex-1 space-y-0.5"
        role="navigation"
        aria-label="Trading sections"
        onKeyDown={onNavKeyDown}
        ref={navRef}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href === "/trading-terminal" && (pathname.startsWith("/trading-terminal") || pathname.startsWith("/terminal"))) ||
            (item.href === "/charts" && pathname.startsWith("/charts")) ||
            (item.href === "/stocks" && pathname.startsWith("/stocks") && !pathname.startsWith("/stocks-in-play")) ||
            (item.href === "/research" && pathname.startsWith("/research")) ||
            (item.href === "/admin" && pathname.startsWith("/admin"));
          return (
            <Link
              key={item.href}
              href={item.href}
              data-nav-item="true"
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium outline-none transition",
                "focus-visible:ring-2 focus-visible:ring-emerald-500/50",
                isActive
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
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
