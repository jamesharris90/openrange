"use client";

// ── types ──────────────────────────────────────────────────────────────────────

type Quarter = {
  label: string;  // e.g. "Q1'24"
  revenue: number | null;
  netIncome: number | null;
};

export type FinancialChartProps = {
  /** Optional real data — if absent, mock data is generated from anchor values */
  data?: Quarter[];
  /** Anchor price for mock generation */
  currentPrice?: number;
};

// ── mock data ─────────────────────────────────────────────────────────────────

const MOCK_DATA: Quarter[] = [
  { label: "Q1'23", revenue: 117,  netIncome: 24  },
  { label: "Q2'23", revenue: 122,  netIncome: 27  },
  { label: "Q3'23", revenue: 131,  netIncome: 29  },
  { label: "Q4'23", revenue: 148,  netIncome: 33  },
  { label: "Q1'24", revenue: 142,  netIncome: 30  },
  { label: "Q2'24", revenue: 153,  netIncome: 35  },
  { label: "Q3'24", revenue: 162,  netIncome: 38  },
  { label: "Q4'24", revenue: 175,  netIncome: 42  },
];

// ── helpers ────────────────────────────────────────────────────────────────────

function fmtB(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}T`;
  if (n >= 1)    return `$${n.toFixed(0)}B`;
  return `$${(n * 1000).toFixed(0)}M`;
}

/** Build a normalised SVG polyline path within viewBox 0 0 width height */
function buildPath(
  values: (number | null)[],
  vw: number,
  vh: number,
  padX = 8,
  padY = 10,
): string {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length < 2) return "";
  const min = Math.min(...valid) * 0.9;
  const max = Math.max(...valid) * 1.05;
  const span = max - min || 1;
  const w    = vw - padX * 2;
  const h    = vh - padY * 2;

  return values
    .map((v, i) => {
      if (v == null) return null;
      const x = padX + (i / (values.length - 1)) * w;
      const y = padY + h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" L ");
}

/** Area path = line path closed down to bottom */
function buildArea(
  values: (number | null)[],
  vw: number,
  vh: number,
  padX = 8,
  padY = 10,
): string {
  const line = buildPath(values, vw, vh, padX, padY);
  if (!line) return "";
  const padXN = padX;
  return `M ${line.replace(/,/g, " ").split(" L ")[0]} L ${line} L ${(vw - padXN).toFixed(1)} ${vh} L ${padXN} ${vh} Z`;
}

// ── mini chart ────────────────────────────────────────────────────────────────

function MiniChart({
  values,
  label,
  color,
  fillId,
  fillColor,
  current,
}: {
  values: (number | null)[];
  label: string;
  color: string;
  fillId: string;
  fillColor: string;
  current: number | null;
}) {
  const VW = 340, VH = 80;
  const linePath = buildPath(values, VW, VH);
  const areaPath = buildArea(values, VW, VH);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] font-semibold">{label}</span>
        {current != null && (
          <span className="text-sm font-mono font-bold tabular-nums" style={{ color }}>
            {fmtB(current)}
          </span>
        )}
      </div>

      <div className="rounded-lg overflow-hidden border border-[var(--border)]/50">
        <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" className="w-full" style={{ height: 80 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={fillColor} stopOpacity="0.25" />
              <stop offset="100%" stopColor={fillColor} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Area fill */}
          {areaPath && (
            <path d={areaPath} fill={`url(#${fillId})`} />
          )}

          {/* Line */}
          {linePath && (
            <polyline
              points={linePath}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* End dot */}
          {linePath && (() => {
            const valid = values.filter((v): v is number => v != null);
            const lastVal = valid[valid.length - 1];
            if (lastVal == null) return null;
            const min = Math.min(...valid) * 0.9;
            const max = Math.max(...valid) * 1.05;
            const span = max - min || 1;
            const padX = 8, padY = 10;
            const w = VW - padX * 2;
            const h = VH - padY * 2;
            const x = padX + w;
            const y = padY + h - ((lastVal - min) / span) * h;
            return <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="3" fill={color} />;
          })()}
        </svg>
      </div>

      {/* X-axis labels */}
      <div className="flex justify-between px-1">
        {values.map((_, i) => {
          if (i % Math.ceil(values.length / 4) !== 0 && i !== values.length - 1) return null;
          return null; // labels injected by parent
        })}
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export function FinancialChart({ data }: FinancialChartProps) {
  const quarters = data && data.length >= 2 ? data : MOCK_DATA;
  const isMock   = !data || data.length < 2;

  const revenues   = quarters.map(q => q.revenue);
  const netIncomes = quarters.map(q => q.netIncome);
  const labels     = quarters.map(q => q.label);

  const lastRevenue   = revenues.filter((v): v is number => v != null).at(-1) ?? null;
  const lastNetIncome = netIncomes.filter((v): v is number => v != null).at(-1) ?? null;

  return (
    <div className="space-y-5">
      {isMock && (
        <div className="flex items-center gap-2 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span className="text-[10px] text-[var(--muted-foreground)]/70">
            Illustrative data — financial API not yet connected
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <MiniChart
          values={revenues}
          label="Revenue (quarterly)"
          color="#4fd1c5"
          fillId="rev-fill"
          fillColor="#4fd1c5"
          current={lastRevenue}
        />
        <MiniChart
          values={netIncomes}
          label="Net Income (quarterly)"
          color="#818cf8"
          fillId="ni-fill"
          fillColor="#818cf8"
          current={lastNetIncome}
        />
      </div>

      {/* Quarter x-axis shared */}
      <div className="flex justify-between px-1">
        {labels.map((l, i) => (
          i % Math.ceil(labels.length / 5) === 0 || i === labels.length - 1
            ? <span key={l} className="text-[9px] text-[var(--muted-foreground)] tabular-nums">{l}</span>
            : <span key={l} />
        ))}
      </div>
    </div>
  );
}
