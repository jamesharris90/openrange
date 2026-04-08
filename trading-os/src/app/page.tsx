"use client";

import Link from "next/link";
import { Activity, BarChart2, Shield, TrendingUp, Zap } from "lucide-react";

import { useAuth } from "@/context/AuthContext";

export default function LandingPage() {
  const { isAuthenticated, initialized, isAdmin } = useAuth();
  const primaryHref = initialized && isAuthenticated ? "/dashboard" : "/signup";
  const primaryLabel = initialized && isAuthenticated ? "Open Dashboard" : "Create Account";
  const adminCards = [
    {
      href: "/admin",
      title: "Admin Control Panel",
      description: "System diagnostics, engines, users, email, and production oversight.",
      icon: Shield,
    },
    {
      href: "/admin/coverage-campaign",
      title: "Coverage Campaign",
      description: "Monitor coverage repair cycles, missing-news progress, and campaign checkpoints.",
      icon: TrendingUp,
    },
    {
      href: "/admin/cron-debug",
      title: "Cron Debug",
      description: "Inspect recent scheduler events and trigger a manual cron run.",
      icon: Activity,
    },
    {
      href: "/admin/data-health",
      title: "Data Health",
      description: "Review pipeline integrity, table freshness, and frontend parity checks.",
      icon: BarChart2,
    },
  ];

  return (
    <main className="min-h-screen bg-[#0b0f14] text-white">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-5 text-emerald-400" />
            <span className="font-semibold tracking-wide text-slate-100">OpenRange</span>
          </div>
          <div className="flex items-center gap-3">
            {initialized && isAuthenticated ? (
              <Link
                href="/dashboard"
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-emerald-500/50 hover:text-white"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-emerald-500/50 hover:text-white"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                >
                  Sign up
                </Link>
              </>
            )}
            {initialized && isAuthenticated && isAdmin ? (
              <Link
                href="/admin"
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200 transition hover:border-amber-400 hover:text-amber-100"
              >
                Admin
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">
          <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
          Live intelligence platform
        </div>
        <h1 className="mt-4 text-4xl font-bold leading-tight text-white md:text-5xl lg:text-6xl">
          Professional Trading<br />
          <span className="text-emerald-400">Intelligence</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          Regime-aware signals, real-time market data, and deterministic trade selection.
          Built for traders who demand signal quality over noise.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href={primaryHref}
            className="rounded-xl bg-emerald-500 px-8 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            {primaryLabel}
          </Link>
          {!isAuthenticated ? (
            <Link
              href="/login"
              className="rounded-xl border border-slate-700 px-8 py-3 text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              Log in
            </Link>
          ) : null}
          {initialized && isAuthenticated && isAdmin ? (
            <Link
              href="/admin"
              className="rounded-xl border border-amber-500/40 px-8 py-3 text-amber-200 transition hover:border-amber-300 hover:text-amber-100"
            >
              Open Admin Control Panel
            </Link>
          ) : null}
          {!isAuthenticated ? (
            <a
              href="#features"
              className="rounded-xl border border-slate-700 px-8 py-3 text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              Learn more
            </a>
          ) : null}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: TrendingUp,
              title: "Market Regime Engine",
              desc: "SPY/VIX-derived BULL/BEAR/RANGE classification updated every 5 minutes. Every signal tagged with current regime context.",
            },
            {
              icon: Zap,
              title: "Top-Focus Signals",
              desc: "Deterministic scoring across confidence, regime alignment, catalyst strength, and liquidity. Top 3–5 opportunities surfaced daily.",
            },
            {
              icon: BarChart2,
              title: "Trading Terminal",
              desc: "Multi-chart cockpit with sortable watchlist, AI narrative, and entry/stop/target levels derived from intraday structure.",
            },
            {
              icon: Shield,
              title: "Signal Truth Layer",
              desc: "Every signal logged and evaluated with WIN/LOSS/NEUTRAL outcomes. Performance history feeds back into confidence scoring.",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <article
              key={title}
              className="rounded-2xl border border-slate-800 bg-[#121826] p-5"
            >
              <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-emerald-500/10">
                <Icon className="size-5 text-emerald-400" />
              </div>
              <h3 className="mb-2 font-semibold text-slate-100">{title}</h3>
              <p className="text-sm leading-relaxed text-slate-400">{desc}</p>
            </article>
          ))}
        </div>
      </section>

      {initialized && isAuthenticated && isAdmin ? (
        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-amber-300/80">Admin</div>
              <h2 className="mt-2 text-2xl font-semibold text-white">Control Panel</h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                Direct access to the operational controls and diagnostics that keep the platform stable.
              </p>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {adminCards.map(({ href, title, description, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="rounded-2xl border border-amber-500/20 bg-[linear-gradient(180deg,rgba(28,22,12,0.92),rgba(15,23,42,0.9))] p-5 transition hover:border-amber-400/40 hover:bg-[linear-gradient(180deg,rgba(46,36,18,0.95),rgba(15,23,42,0.94))]"
              >
                <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-amber-500/10">
                  <Icon className="size-5 text-amber-300" />
                </div>
                <h3 className="mb-2 font-semibold text-slate-100">{title}</h3>
                <p className="text-sm leading-relaxed text-slate-400">{description}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Footer */}
      <footer className="border-t border-slate-800 px-6 py-6 text-center text-xs text-slate-600">
        OpenRange Terminal — Professional trading intelligence platform
      </footer>
    </main>
  );
}
