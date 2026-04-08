"use client";

import Link from "next/link";
import { LogOut, Shield, User } from "lucide-react";
import { useRouter } from "next/navigation";

import { TickerStrip } from "@/components/ticker-strip";
import { TickerSearch } from "@/components/ticker-search";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";

export function TopBar() {
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  const displayName = user?.username || user?.email || "Trader";

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-[#0d1117]/95 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Symbol search */}
        <div className="w-56 shrink-0">
          <TickerSearch />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User profile + logout */}
        {isAuthenticated && (
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <Link
                href="/admin"
                className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200 transition hover:border-amber-400 hover:text-amber-100"
              >
                <Shield className="size-3" />
                <span>Admin</span>
              </Link>
            ) : null}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
              <User className="size-3 text-slate-500" />
              <span className="text-xs text-slate-300">{displayName}</span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleLogout}
              title="Sign out"
              className="text-slate-500 hover:text-slate-200"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Market ticker strip */}
      <TickerStrip />
    </header>
  );
}
