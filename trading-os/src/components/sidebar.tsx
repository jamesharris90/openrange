"use client";

import {
  Activity,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Globe,
  LayoutDashboard,
  Newspaper,
  Radar,
  Shield,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const baseNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/screener", label: "Screener", icon: Radar },
  { href: "/screener-v2?view=focus", label: "Opportunities", icon: Globe },
  { href: "/research", label: "Research", icon: TrendingUp },
  { href: "/news-feed", label: "News", icon: Newspaper },
  { href: "/earnings", label: "Earnings", icon: Calendar },
];

const adminNavItems = [
  { href: "/admin", label: "Admin Home", icon: Shield },
  { href: "/admin/coverage-campaign", label: "Coverage Campaign", icon: TrendingUp },
  { href: "/admin/cron-debug", label: "Cron Debug", icon: Activity },
  { href: "/admin/data-health", label: "Data Health", icon: Globe },
];

type SidebarProps = {
  mobile?: boolean;
  open?: boolean;
  onNavigate?: () => void;
};

export function Sidebar({ mobile = false, open = false, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const { isAdmin } = useAuth();
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

  const navItems = (
    <>
      {/* Brand + collapse */}
      <div className="mb-5 flex items-center justify-between">
        {(!collapsed || mobile) && (
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded bg-emerald-500/20">
              <Gauge className="size-3.5 text-emerald-400" />
            </div>
            <span className="text-sm font-semibold tracking-wide text-slate-100">OpenRange</span>
          </div>
        )}
        {mobile ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onNavigate}
            aria-label="Close navigation"
            className="ml-auto text-slate-500 hover:text-slate-200"
          >
            <ChevronLeft className="size-4" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn("ml-auto text-slate-500 hover:text-slate-200", collapsed && "mx-auto")}
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </Button>
        )}
      </div>

      {/* Nav */}
      <nav
        className="flex-1 space-y-0.5"
        role="navigation"
        aria-label="Trading sections"
        onKeyDown={onNavKeyDown}
        ref={navRef}
      >
        {baseNavItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href.split("?")[0] ||
            (item.href === "/research" && pathname.startsWith("/research"));
          return (
            <Link
              key={item.href}
              href={item.href}
              data-nav-item="true"
              title={collapsed ? item.label : undefined}
              onClick={onNavigate}
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
              {(!collapsed || mobile) && <span>{item.label}</span>}
            </Link>
          );
        })}

        {isAdmin ? (
          <div className={cn("pt-4", collapsed && "pt-3")}>
            {!collapsed ? (
              <div className="mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Admin Tools
              </div>
            ) : null}
            <div className="space-y-0.5 border-t border-slate-800/80 pt-2">
              {adminNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-nav-item="true"
                    title={collapsed ? item.label : undefined}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium outline-none transition",
                      "focus-visible:ring-2 focus-visible:ring-amber-500/50",
                      isActive
                        ? "bg-amber-500/10 text-amber-200"
                        : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                    )}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <Icon className="size-4 shrink-0" />
                    {(!collapsed || mobile) && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}
      </nav>
    </>
  );

  if (mobile) {
    return (
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-slate-800 bg-[#0d1117] p-3 transition-transform duration-200 md:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Primary navigation"
        aria-hidden={!open}
      >
        {navItems}
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "hidden shrink-0 border-r border-slate-800 bg-[#0d1117] p-3 md:flex md:flex-col",
        collapsed ? "md:w-[60px]" : "md:w-56"
      )}
      aria-label="Primary navigation"
    >
      {navItems}
    </aside>
  );
}
