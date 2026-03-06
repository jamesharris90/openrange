import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Brain,
  CandlestickChart,
  LayoutDashboard,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Zap,
} from 'lucide-react';

const workflow = [
  {
    title: 'What to Trade',
    description: 'OpenRange ranks symbols by momentum, liquidity, and catalyst quality so your attention goes to the best opportunities first.',
    icon: Target,
  },
  {
    title: 'When to Trade',
    description: 'Session-aware timing shows pre-market acceleration, opening range behavior, and high-probability windows.',
    icon: Timer,
  },
  {
    title: 'Strategy Alignment',
    description: 'Signals are mapped to strategy profiles so each setup is tied to a clear playbook, not random noise.',
    icon: ShieldCheck,
  },
  {
    title: 'Execute Trade',
    description: 'Move from scanner to chart to setup plan in one flow with context preserved across every module.',
    icon: Zap,
  },
];

const features = [
  { title: 'Pre-Market Intelligence', icon: Brain },
  { title: 'Scanner', icon: Search },
  { title: 'AI Catalyst Detection', icon: Bot },
  { title: 'Chart Workspace', icon: CandlestickChart },
  { title: 'Strategy Signals', icon: Sparkles },
  { title: 'Trading Cockpit', icon: LayoutDashboard },
];

const screenshots = [
  { title: 'Radar', subtitle: 'Opportunity flow and live catalyst stream', tint: 'from-sky-500/20 to-cyan-500/10' },
  { title: 'Charts', subtitle: 'Execution-grade workspace and overlays', tint: 'from-emerald-500/20 to-teal-500/10' },
  { title: 'Scanner', subtitle: 'Filter, rank, and validate setups quickly', tint: 'from-amber-500/20 to-orange-500/10' },
  { title: 'Cockpit', subtitle: 'Market context and strategy command center', tint: 'from-fuchsia-500/20 to-rose-500/10' },
];

const tiers = [
  {
    name: 'Free',
    price: '$0',
    points: ['Delayed data', 'Basic scanner', 'Limited watchlist'],
    accent: 'border-slate-600/60',
  },
  {
    name: 'Pro',
    price: '$39/mo',
    points: ['Live data', 'Alerts', 'Full screener', 'AI briefing'],
    accent: 'border-sky-400/70',
  },
  {
    name: 'Ultimate',
    price: '$99/mo',
    points: ['All features', 'API access', 'Advanced signals', 'Broker trading'],
    accent: 'border-emerald-400/70',
  },
];

function SectionTitle({ eyebrow, title, subtitle }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-semibold text-[var(--text-primary)] md:text-3xl">{title}</h2>
      {subtitle ? <p className="mt-3 text-sm text-[var(--text-muted)] md:text-base">{subtitle}</p> : null}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[-12%] top-[-14%] h-[420px] w-[420px] rounded-full bg-sky-400/15 blur-3xl" />
        <div className="absolute bottom-[-22%] right-[-8%] h-[520px] w-[520px] rounded-full bg-emerald-400/10 blur-3xl" />
      </div>

      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-12 md:px-6 md:pt-16">
        <section className="rounded-2xl border border-[var(--border-default)] bg-[linear-gradient(135deg,rgba(74,158,255,0.14),rgba(16,185,129,0.08))] px-5 py-10 md:px-10 md:py-16">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-1 text-xs text-[var(--text-muted)]">
              <Radar size={14} />
              Market intelligence for active traders
            </div>
            <h1 className="text-3xl font-semibold leading-tight md:text-5xl">OpenRange Trader</h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-[var(--text-muted)] md:text-lg">
              Know what to trade before the market opens.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/register"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--accent-blue)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
              >
                Start Free
                <ArrowRight size={15} />
              </Link>
              <Link
                to="/login"
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border-default)] px-5 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-hover)] hover:bg-[var(--bg-elevated)]"
              >
                View Demo
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-16">
          <SectionTitle
            eyebrow="Workflow"
            title="A repeatable process from open prep to execution"
            subtitle="OpenRange is built around a decision flow so your morning prep becomes consistent, fast, and actionable."
          />
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            {workflow.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4 md:p-5">
                  <div className="mb-3 inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 text-[var(--accent-blue)]">
                    <Icon size={16} />
                  </div>
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm text-[var(--text-muted)]">{item.description}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-16">
          <SectionTitle
            eyebrow="Features"
            title="Built for pre-market and intraday precision"
          />
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
                  <div className="mb-2 text-[var(--accent-green)]"><Icon size={17} /></div>
                  <h3 className="text-sm font-semibold md:text-base">{feature.title}</h3>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-16">
          <SectionTitle
            eyebrow="Platform"
            title="Core workspaces at a glance"
            subtitle="From radar to execution cockpit, each module stays connected so context is never lost."
          />
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            {screenshots.map((shot) => (
              <div
                key={shot.title}
                className={`rounded-xl border border-[var(--border-default)] bg-gradient-to-br ${shot.tint} p-4`}
              >
                <div className="h-44 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)]/80 p-3 backdrop-blur-sm md:h-52">
                  <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{shot.title}</div>
                  <div className="mt-2 text-sm text-[var(--text-primary)]">{shot.subtitle}</div>
                  <div className="mt-4 grid h-[70%] grid-cols-3 gap-2 rounded-md bg-[var(--bg-elevated)] p-2">
                    <div className="rounded bg-white/10" />
                    <div className="rounded bg-white/10" />
                    <div className="rounded bg-white/10" />
                    <div className="col-span-2 rounded bg-white/10" />
                    <div className="rounded bg-white/10" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16">
          <SectionTitle
            eyebrow="Pricing"
            title="Choose your OpenRange tier"
          />
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {tiers.map((tier) => (
              <article key={tier.name} className={`rounded-xl border ${tier.accent} bg-[var(--bg-card)] p-5`}>
                <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{tier.name}</div>
                <div className="mt-2 text-2xl font-semibold">{tier.price}</div>
                <ul className="mt-4 space-y-2 text-sm text-[var(--text-muted)]">
                  {tier.points.map((point) => (
                    <li key={point} className="flex items-center gap-2">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-blue)]" />
                      {point}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-16 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] px-5 py-10 text-center md:px-10 md:py-12">
          <h2 className="text-2xl font-semibold">Start scanning the market before the open.</h2>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/register"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--accent-blue)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Start Free
              <ArrowRight size={15} />
            </Link>
            <Link
              to="/login"
              className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border-default)] px-5 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--border-hover)] hover:bg-[var(--bg-elevated)]"
            >
              View Demo
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
