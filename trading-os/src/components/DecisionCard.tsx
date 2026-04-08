type DecisionCardData = {
  symbol?: unknown;
  bias?: unknown;
  catalystType?: unknown;
  expectedMoveLabel?: unknown;
  truth_valid?: unknown;
  truth_reason?: unknown;
  trade_quality_score?: unknown;
  tradeable?: unknown;
  execution_plan?: unknown;
  setup?: unknown;
  trade_class?: unknown;
  action?: unknown;
  position_size?: unknown;
  risk_per_share?: unknown;
  max_risk?: unknown;
};

function qualityTone(score: number): string {
  if (score >= 80) return "text-emerald-300";
  if (score >= 60) return "text-amber-300";
  return "text-rose-300";
}

function renderExecutionPlan(data: DecisionCardData): string {
  if (!data.execution_plan) {
    return "NO TRADE - INSUFFICIENT EDGE";
  }

  if (typeof data.execution_plan === "string" && data.execution_plan.trim()) {
    return data.execution_plan;
  }

  if (data.execution_plan && typeof data.execution_plan === "object") {
    const plan = data.execution_plan as Record<string, unknown>;
    const strategy = typeof plan.strategy === "string" ? plan.strategy : "";
    const entryType = typeof plan.entry_type === "string" ? plan.entry_type : "";
    const riskLevel = typeof plan.risk_level === "string" ? plan.risk_level : "";
    const summary = [strategy, entryType, riskLevel].filter((v) => v && String(v).trim()).join(" | ");
    if (summary) return summary;
  }

  if (typeof data.setup === "string" && data.setup.trim()) {
    return `Setup: ${data.setup}. NO EXECUTION PLAN AVAILABLE`;
  }

  return "NO TRADE - INSUFFICIENT EDGE";
}

function tradeClassTone(tradeClass: string): string {
  if (tradeClass === "A") return "bg-emerald-500/20 text-emerald-300 border-emerald-400/40";
  if (tradeClass === "B") return "bg-amber-500/20 text-amber-300 border-amber-400/40";
  if (tradeClass === "C") return "bg-orange-500/20 text-orange-300 border-orange-400/40";
  return "bg-slate-700/30 text-slate-300 border-slate-500/40";
}

function actionTone(action: string): string {
  if (action === "TAKE") return "text-emerald-300 font-bold";
  if (action === "WATCH") return "text-amber-300";
  return "text-rose-300";
}

export function DecisionCard({ data }: { data: DecisionCardData | null | undefined }) {
  if (!data || typeof data !== "object") {
    console.warn("DECISION CARD DATA FAILURE", data);
    return null;
  }

  const required: Array<keyof DecisionCardData> = [
    "bias",
    "catalystType",
    "expectedMoveLabel",
    "truth_valid",
    "trade_quality_score",
    "tradeable",
    "trade_class",
    "action",
    "max_risk",
  ];

  const hasMissing = required.some((key) => data[key] === undefined || data[key] === null);
  if (hasMissing) {
    console.warn("DECISION CARD DATA FAILURE", data);
    return null;
  }

  const score = Number(data.trade_quality_score);
  const tradeQualityScore = Number.isFinite(score) ? score : 0;
  const tradeClass = String(data.trade_class || "UNTRADEABLE");
  const action = String(data.action || "AVOID");
  const positionSize = Number(data.position_size);
  const riskPerShare = Number(data.risk_per_share);
  const maxRisk = Number(data.max_risk);
  const truthValid = Boolean(data.truth_valid);
  const truthReason = typeof data.truth_reason === "string" && data.truth_reason.trim()
    ? data.truth_reason
    : null;

  return (
    <section className="rounded-2xl border border-slate-800 bg-panel p-4 shadow-lg">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Trade Insight</div>
      <div className="decision-card rounded-xl border border-slate-700 bg-slate-950/60 p-3">
        <h3 className="text-sm font-semibold text-slate-100">Decision System</h3>

        <div className="mt-3 flex items-center gap-2">
          <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${tradeClassTone(tradeClass)}`}>
            TRADE CLASS {tradeClass}
          </span>
          <span className={`text-sm ${actionTone(action)}`}>{action}</span>
        </div>

        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Trade Quality Score</div>
          <div className={`mt-1 text-2xl font-extrabold ${qualityTone(tradeQualityScore)}`}>{tradeQualityScore}</div>
          <div className="mt-1 text-[11px] text-slate-400">Scale: 0-100</div>
        </div>

        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Truth Status</div>
          <div className={`mt-1 text-sm font-semibold ${truthValid ? "text-emerald-300" : "text-rose-300"}`}>
            {truthValid ? "VALID TRADE SETUP" : `REJECTED: ${truthReason || "UNKNOWN"}`}
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Why Is It Moving</div>
          <div className="mt-1 text-slate-100">{String(data.catalystType)}</div>

          <div className="mt-3 text-[10px] uppercase tracking-wide text-slate-500">Why Is It Tradeable</div>
          <div className="mt-1 text-slate-100">{Boolean(data.tradeable) ? "YES" : "NO"}</div>
          {truthReason ? <div className="mt-1 text-slate-300">{truthReason}</div> : null}

          <div className="mt-3 text-[10px] uppercase tracking-wide text-slate-500">How To Trade</div>
          <div className="mt-1 text-slate-100">{renderExecutionPlan(data)}</div>
        </div>

        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-200">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Position</div>
          <div className="mt-1">Position Size: {Number.isFinite(positionSize) ? positionSize : "N/A"}</div>
          <div className="mt-1">Risk per Share: {Number.isFinite(riskPerShare) ? riskPerShare.toFixed(4) : "N/A"}</div>
          <div className="mt-1">Max Risk: £{Number.isFinite(maxRisk) ? maxRisk : 10}</div>
        </div>

        <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
          <div>
            <div className="text-slate-400">Bias</div>
            <p className="font-semibold text-slate-100">{String(data.bias)}</p>
          </div>
          <div>
            <div className="text-slate-400">Expected Move</div>
            <p className="font-mono text-slate-100">{String(data.expectedMoveLabel)}</p>
          </div>
          <div>
            <div className="text-slate-400">Tradeable</div>
            <p className="text-slate-100">{Boolean(data.tradeable) ? "YES" : "NO"}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
