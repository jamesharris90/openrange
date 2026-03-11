import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Brain,
  CandlestickChart,
  ChevronDown,
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
    border: 'border-t-blue-500',
  },
  {
    title: 'When to Trade',
    description: 'Session-aware timing shows pre-market acceleration, opening range behavior, and high-probability windows.',
    icon: Timer,
    border: 'border-t-emerald-500',
  },
  {
    title: 'Strategy Alignment',
    description: 'Signals are mapped to strategy profiles so each setup is tied to a clear playbook, not random noise.',
    icon: ShieldCheck,
    border: 'border-t-violet-500',
  },
  {
    title: 'Execute Trade',
    description: 'Move from scanner to chart to setup plan in one flow with context preserved across every module.',
    icon: Zap,
    border: 'border-t-amber-500',
  },
];

const features = [
  {
    title: 'Pre-Market Intelligence',
    icon: Brain,
    description: 'Overnight catalysts, gap analysis, and session preparation in one view',
  },
  {
    title: 'Scanner',
    icon: Search,
    description: 'Multi-filter stock scanning ranked by momentum, volume, and catalyst quality',
  },
  {
    title: 'AI Catalyst Detection',
    icon: Bot,
    description: 'Automated identification of why stocks are moving - earnings, FDA, insider activity',
  },
  {
    title: 'Chart Workspace',
    icon: CandlestickChart,
    description: 'Professional charts with ORB overlays, session dividers, and indicator sub-panes',
  },
  {
    title: 'Strategy Signals',
    icon: Sparkles,
    description: 'Pattern-matched signals tied to your playbook - not random alerts',
  },
  {
    title: 'Trading Cockpit',
    icon: LayoutDashboard,
    description: 'Live session command centre with market context, positions, and execution tools',
  },
];

const screenshots = [
  {
    key: 'radar',
    title: 'Radar',
    subtitle: 'Opportunity flow and live catalyst stream',
    tint: 'from-emerald-500/20 to-emerald-900/40',
    labelColor: 'text-emerald-300',
    src: '/images/landing/workspace-radar.png',
    alt: 'OpenRange Pre-Market Command Center showing gap leaders, market regime analysis, and trade planning',
  },
  {
    key: 'charts',
    title: 'Charts',
    subtitle: 'Execution-grade workspace and overlays',
    tint: 'from-blue-500/20 to-blue-900/40',
    labelColor: 'text-blue-300',
    src: '/images/landing/workspace-charts.png',
    alt: 'OpenRange chart workspace showing AAPL candlestick chart with volume analysis',
  },
  {
    key: 'scanner',
    title: 'Scanner',
    subtitle: 'Filter, rank, and validate setups quickly',
    tint: 'from-amber-500/20 to-amber-900/40',
    labelColor: 'text-amber-300',
    src: '/images/landing/workspace-scanner.png',
    alt: 'OpenRange Institutional Screener with adaptive filters, ticker results, and intelligence panel',
  },
  {
    key: 'cockpit',
    title: 'Cockpit',
    subtitle: 'Market context and strategy command center',
    tint: 'from-violet-500/20 to-fuchsia-900/40',
    labelColor: 'text-violet-300',
    src: '/images/landing/workspace-cockpit.png',
    alt: 'OpenRange Sector Heatmap showing institutional sector strength and top leaders',
  },
];

const tiers = [
  {
    name: 'Free',
    price: '$0',
    points: [
      'Top 5 daily scan results',
      'Basic market overview',
      'Session workflow pages',
      'Limited watchlist (3 stocks)',
      'Delayed market data',
    ],
    accent: 'border-slate-700',
  },
  {
    name: 'Pro',
    price: '$29/mo',
    badge: 'Most Popular',
    points: [
      'Everything in Free',
      'Full scanner (unlimited results)',
      'Real-time market data',
      'AI catalyst detection badges',
      'Pre-market AI briefing',
      'Unlimited watchlists',
      'Chart workspace with ORB overlays',
      'Price and volume alerts',
    ],
    accent: 'border-blue-500',
  },
  {
    name: 'Ultimate',
    price: '$59/mo',
    points: [
      'Everything in Pro',
      'Automated trade journal',
      'AI trade review & behaviour tags',
      'Strategy backtesting',
      'Performance analytics',
      'Priority support',
      'API access',
    ],
    accent: 'border-violet-500/70',
  },
];

const steps = [
  {
    title: 'Scan',
    description:
      "Every morning, OpenRange surfaces the day's highest-probability setups ranked by momentum, volume, catalyst strength, and strategy fit.",
  },
  {
    title: 'Validate',
    description:
      'Click any result to see the full picture - chart with ORB overlays, catalyst context, historical behaviour, and a strategy alignment score.',
  },
  {
    title: 'Execute',
    description:
      'Move to the trading cockpit with full context. After the session, your journal auto-captures results for AI-powered behavioural review.',
  },
];

function upsertMetaTag(name, content, isProperty = false) {
  const selector = isProperty ? `meta[property="${name}"]` : `meta[name="${name}"]`;
  let tag = document.head.querySelector(selector);
  if (!tag) {
    tag = document.createElement('meta');
    if (isProperty) {
      tag.setAttribute('property', name);
    } else {
      tag.setAttribute('name', name);
    }
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function upsertCanonical(href) {
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
}

function useScrollReveal() {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1 },
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return [ref, isVisible];
}

function RevealSection({ id, className = '', children }) {
  const [ref, isVisible] = useScrollReveal();
  return (
    <section
      id={id}
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
      } ${className}`}
    >
      {children}
    </section>
  );
}

function SectionTitle({ eyebrow, title, subtitle }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-semibold text-slate-100 md:text-4xl">{title}</h2>
      {subtitle ? <p className="mt-3 text-sm text-slate-400 md:text-base">{subtitle}</p> : null}
    </div>
  );
}

export default function LandingPage() {
  const softwareApplicationLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'OpenRange Trading',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web',
    description:
      'OpenRange Trading scans thousands of US stocks every session, surfaces high-probability setups, and explains market catalysts, momentum, and strategy alignment in one workflow.',
    url: 'https://openrangetrading.co.uk/',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      description: 'Free tier available',
    },
  };

  useEffect(() => {
    document.title = 'OpenRange Trading | Know What to Trade Before the Market Opens';
    upsertMetaTag(
      'description',
      'OpenRange Trading scans thousands of US stocks every session, surfaces the highest-probability setups, and shows you exactly why each one is moving. Free pre-market scanner, AI catalyst detection, and intelligent trading workflow.',
    );
    upsertMetaTag(
      'keywords',
      'stock scanner, day trading scanner, pre-market scanner, opening range breakout, ORB trading, stock screener, trading intelligence, catalyst detection, AI trading tools, US stock scanner',
    );
    upsertCanonical('https://openrangetrading.co.uk/');
    upsertMetaTag('og:title', 'OpenRange Trading | Know What to Trade Before the Market Opens', true);
    upsertMetaTag('og:description', 'Market intelligence for active traders. Scanner, catalysts, charts, and workflow in one platform.', true);
    upsertMetaTag('og:url', 'https://openrangetrading.co.uk/', true);
    upsertMetaTag('og:type', 'website', true);
    upsertMetaTag('og:image', 'https://openrangetrading.co.uk/images/landing/workspace-radar.png', true);
    upsertMetaTag('twitter:card', 'summary_large_image');
    upsertMetaTag('twitter:title', 'OpenRange Trading');
    upsertMetaTag('twitter:description', 'Know what to trade before the market opens.');
    upsertMetaTag('twitter:image', 'https://openrangetrading.co.uk/images/landing/workspace-radar.png');
    upsertMetaTag('twitter:image:alt', 'OpenRange platform workspace showing market intelligence and scanner context');
  }, []);

  return (
    <div className="min-h-screen scroll-smooth bg-slate-900 text-slate-50">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationLd) }}
      />

      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(59,130,246,0.18),transparent_42%),radial-gradient(circle_at_82%_22%,rgba(16,185,129,0.08),transparent_38%),linear-gradient(175deg,#0f172a_0%,#0b1222_55%,#0a0f1d_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:44px_44px] opacity-15" />
      </div>

      <header className="sticky top-0 z-40 border-b border-slate-800/60 bg-[#0a0f1bcc] backdrop-blur-md">
        <nav className="mx-auto flex h-12 w-full max-w-6xl items-center justify-between px-4 md:px-6">
          <Link to="/" className="inline-flex items-center gap-2">
            <img
              src="/images/landing/logo.png"
              alt="OpenRange Trading"
              className="h-8 w-auto brightness-200 invert"
            />
          </Link>

          <div className="hidden items-center gap-5 text-xs font-medium text-slate-300 md:flex">
            <a href="#features" className="transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/80">Features</a>
            <a href="#platform" className="transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/80">Platform</a>
            <a href="#pricing" className="transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/80">Pricing</a>
            <a href="#final-cta" className="transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/80">Demo</a>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="hidden text-xs font-medium text-slate-300 transition hover:text-white lg:inline-flex"
            >
              Sign In
            </Link>
            <Link
              to="/login"
              className="inline-flex min-h-9 items-center rounded-md border border-slate-600 px-3.5 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-400 hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/80"
            >
              Log In
            </Link>
            <Link
              to="/register"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-blue-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              Start Free
              <ArrowRight size={14} />
            </Link>
          </div>
        </nav>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-12 md:px-6 md:pt-16">
        <section id="top" className="relative overflow-hidden rounded-2xl border border-slate-700/70 bg-[#101a31]/90 px-5 py-12 md:px-10 md:py-16">
          <div className="absolute -right-16 top-10 -z-10 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
          <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/75 px-3 py-1 text-xs text-slate-300">
                <Radar size={14} />
                Market intelligence for active traders
              </div>

              <h1 className="text-5xl font-bold leading-[1.02] tracking-tight text-white md:text-6xl">OpenRange Trading</h1>
              <p className="mt-4 text-xl font-medium text-slate-200 md:text-3xl">Know what to trade before the market opens.</p>
              <p className="mt-5 max-w-2xl text-sm leading-relaxed text-slate-400 md:text-base">
                Scan the market, identify stocks in play, and trade high-probability setups using our proprietary OpenRange Radar signal engine and real-time trading dashboard. Anyone can show you what is moving. OpenRange reveals the catalysts, signals, and market context behind the move - so you can trade with real conviction.
              </p>
              <p className="mt-5 text-base font-semibold text-white md:text-lg">Discover opportunity faster. Trade with intelligence.</p>

              <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <Link
                  to="/register"
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                >
                  Start Free
                  <ArrowRight size={15} />
                </Link>
                <Link
                  to="/login"
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-600 px-5 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-slate-400 hover:bg-slate-800/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/80"
                >
                  View Demo
                </Link>
              </div>

              <Link to="/login" className="mt-3 inline-flex text-sm font-medium text-slate-300 transition hover:text-white">Log In</Link>
              <p className="mt-4 text-sm font-medium text-slate-300">Free forever. No credit card required.</p>
            </div>

            <div className="relative mx-auto w-full max-w-xl lg:pl-2">
              <div className="absolute -inset-3 -z-10 rounded-3xl bg-blue-500/20 blur-2xl" />
              <img
                src="/images/landing/hero-dashboard.png"
                alt="OpenRange Trading Dashboard showing live market intelligence, strategy leaderboard, and opportunity stream"
                className="w-full rounded-xl border border-slate-700/90 shadow-2xl ring-1 ring-blue-400/20 transition-transform duration-500 hover:-translate-y-1 hover:scale-[1.01] lg:rotate-[1deg]"
              />
            </div>
          </div>

          <div className="mt-8 flex justify-center">
            <a
              href="#workflow"
              className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs text-slate-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/80"
            >
              Scroll
              <ChevronDown size={14} className="animate-bounce" />
            </a>
          </div>
        </section>

        <RevealSection id="workflow" className="mt-20">
          <SectionTitle
            eyebrow="Workflow"
            title="A repeatable process from open prep to execution"
            subtitle="OpenRange is built around a decision flow so your morning prep becomes consistent, fast, and actionable."
          />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {workflow?.map((item) => {
              const Icon = item.icon;
              return (
                <article
                  key={item.title}
                  className={`rounded-xl border border-slate-700 bg-slate-800/50 p-4 shadow-lg shadow-slate-900/30 transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-blue-950/35 md:p-5 ${item.border} border-t-4`}
                >
                  <div className="mb-3 inline-flex rounded-lg border border-slate-600 bg-slate-900/85 p-2 text-blue-400">
                    <Icon size={16} />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-100">{item.title}</h3>
                  <p className="mt-2 text-sm text-slate-400">{item.description}</p>
                </article>
              );
            })}
          </div>
        </RevealSection>

        <RevealSection id="features" className="mt-20">
          <SectionTitle
            eyebrow="Features"
            title="Built for pre-market and intraday precision"
          />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features?.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="rounded-xl border border-slate-700 bg-slate-800/55 p-5 transition hover:border-slate-500">
                  <div className="mb-3 text-emerald-400"><Icon size={17} /></div>
                  <h3 className="text-sm font-semibold text-slate-100 md:text-base">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </RevealSection>

        <RevealSection id="problem" className="mt-20 rounded-2xl border border-slate-800 bg-slate-900/50 px-6 py-16">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold text-white md:text-4xl">Stop switching between 5 tools every morning</h2>
            <p className="mt-6 text-lg leading-relaxed text-slate-400">
              Most traders start their day juggling Finviz for scanning, TradingView for charts, Twitter for catalysts, their broker for execution, and a spreadsheet for notes. By the time they&apos;ve pieced it together, the opening range has already broken out. OpenRange replaces that fragmented workflow with one intelligent platform.
            </p>
          </div>
        </RevealSection>

        <RevealSection id="how-it-works" className="mt-20">
          <SectionTitle
            eyebrow="How It Works"
            title="From scan to trade in three steps"
          />
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {steps?.map((step, index) => (
              <article key={step.title} className="rounded-xl border border-slate-700 bg-slate-800/55 p-5">
                <div className="mb-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white">
                  {index + 1}
                </div>
                <h3 className="text-lg font-semibold text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.description}</p>
              </article>
            ))}
          </div>
        </RevealSection>

        <RevealSection id="platform" className="mt-20">
          <SectionTitle
            eyebrow="Platform"
            title="Core workspaces at a glance"
            subtitle="From radar to execution cockpit, each module stays connected so context is never lost."
          />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {screenshots?.map((shot) => (
              <div
                key={shot.key}
                className="group relative overflow-hidden rounded-xl border border-slate-700"
              >
                <div className={`absolute inset-0 z-10 bg-gradient-to-b ${shot.tint}`} />
                <img
                  src={shot.src}
                  alt={shot.alt}
                  className="w-full opacity-80 transition-opacity duration-300 group-hover:opacity-100"
                  loading="lazy"
                />
                <div className="absolute left-0 right-0 top-0 z-20 p-4">
                  <span className={`text-xs font-semibold uppercase tracking-wider ${shot.labelColor}`}>{shot.title}</span>
                  <p className="mt-1 text-sm text-white/90">{shot.subtitle}</p>
                </div>
              </div>
            ))}
          </div>
        </RevealSection>

        <RevealSection id="pricing" className="mt-20">
          <SectionTitle
            eyebrow="Pricing"
            title="Choose your OpenRange tier"
          />
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {tiers?.map((tier) => (
              <article key={tier.name} className={`relative rounded-xl border ${tier.accent} bg-slate-800/60 p-5`}>
                {tier.badge ? (
                  <span className="absolute right-4 top-4 rounded-full bg-blue-500/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-300">
                    {tier.badge}
                  </span>
                ) : null}
                <div className="text-xs uppercase tracking-wide text-slate-400">{tier.name}</div>
                <div className="mt-2 text-3xl font-semibold text-white">{tier.price}</div>
                <ul className="mt-4 space-y-2 text-sm text-slate-400">
                  {tier.points?.map((point) => (
                    <li key={point} className="flex items-center gap-2">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
                      {point}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <p className="mt-5 text-center text-sm text-slate-400">Billed monthly. Cancel anytime. Annual billing saves 20%.</p>
        </RevealSection>

        <RevealSection id="final-cta" className="mt-20 rounded-2xl border border-slate-700 bg-gradient-to-br from-[#121d35] to-[#0d1627] px-5 py-12 text-center md:px-10 md:py-14">
          <h2 className="text-3xl font-semibold text-white md:text-4xl">Start scanning the market before the open.</h2>
          <p className="mt-4 text-sm text-slate-300">Free forever. No credit card. Set up in 30 seconds.</p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/register"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Start Free
              <ArrowRight size={15} />
            </Link>
            <Link
              to="/login"
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-600 px-5 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-slate-400 hover:bg-slate-800/65"
            >
              View Demo
            </Link>
            <Link to="/login" className="text-sm font-medium text-slate-300 transition hover:text-white">Log In</Link>
          </div>
        </RevealSection>

        <RevealSection id="footer" className="mt-20 border-t border-slate-800 pt-10">
          <footer className="pb-6">
            <div className="grid gap-8 md:grid-cols-3">
              <div>
                <img
                  src="/images/landing/logo.png"
                  alt="OpenRange Trading"
                  className="h-8 w-auto brightness-200 invert"
                  loading="lazy"
                />
                <p className="mt-4 max-w-xs text-sm text-slate-300">Discover opportunity faster. Trade with intelligence.</p>
              </div>

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Links</h3>
                <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-400">
                  <a href="#features" className="hover:text-white">Features</a>
                  <a href="#platform" className="hover:text-white">Platform</a>
                  <a href="#pricing" className="hover:text-white">Pricing</a>
                  <a href="#final-cta" className="hover:text-white">Demo</a>
                  <Link to="/login" className="hover:text-white">Log In</Link>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Social</h3>
                <div className="mt-3 flex gap-3 text-sm text-slate-400">
                  <a href="#" className="hover:text-white">Twitter/X</a>
                  <a href="#" className="hover:text-white">Discord</a>
                </div>
              </div>
            </div>

            <p className="mt-8 text-xs leading-relaxed text-slate-500">
              OpenRange Trading is a market intelligence platform for active US stock traders. Our pre-market scanner, AI catalyst detection engine, and session-based trading workflow help day traders and swing traders identify high-probability setups before the market opens. Built for Opening Range Breakout (ORB) strategies, momentum trading, and catalyst-driven opportunities across US equities.
            </p>

            <div className="mt-6 flex flex-col gap-2 border-t border-slate-800 pt-4 text-xs text-slate-500 md:flex-row md:items-center md:justify-between">
              <span>© 2026 OpenRange Trading. All rights reserved.</span>
              <span>Not financial advice. Trading involves risk.</span>
            </div>
          </footer>
        </RevealSection>
      </main>
    </div>
  );
}
