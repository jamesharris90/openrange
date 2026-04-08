"use client";

import { useEffect, useRef, useState } from "react";

const COLORS = {
  background: "var(--screener-filter-bg, #0e1320)",
  border: "var(--screener-filter-border, #1a2236)",
  accent: "var(--screener-filter-accent, #22d3a0)",
  text: "var(--screener-filter-text, #c8d0dc)",
  muted: "var(--screener-filter-muted, #5a6478)",
};

const FILTER_GROUPS = [
  {
    id: "momentum",
    label: "Momentum & Flow",
    icon: "⚡",
    desc: "Stocks in play right now",
    filters: [
      { id: "price", label: "Price", type: "range", min: 0, max: 2000, step: 0.5, unit: "$", defaultMin: 1, defaultMax: 500 },
      { id: "change_pct", label: "Change %", type: "range", min: -100, max: 500, step: 0.5, unit: "%", defaultMin: -50, defaultMax: 100 },
      { id: "gap_pct", label: "Gap %", type: "range", min: -50, max: 200, step: 0.5, unit: "%", defaultMin: 2, defaultMax: 100 },
      { id: "rvol", label: "Rel. Volume", type: "range", min: 0, max: 50, step: 0.1, unit: "x", defaultMin: 1.5, defaultMax: 50 },
      { id: "volume", label: "Volume", type: "range", min: 0, max: 500000000, step: 10000, unit: "", defaultMin: 100000, defaultMax: 500000000, format: "abbr" },
      { id: "pm_change", label: "Pre-Mkt Chg %", type: "range", min: -50, max: 200, step: 0.5, unit: "%", defaultMin: 2, defaultMax: 100 },
      { id: "pm_volume", label: "Pre-Mkt Vol", type: "range", min: 0, max: 50000000, step: 1000, unit: "", defaultMin: 50000, defaultMax: 50000000, format: "abbr" },
      { id: "change_from_open", label: "Chg from Open %", type: "range", min: -50, max: 200, step: 0.5, unit: "%", defaultMin: -10, defaultMax: 50 },
    ],
  },
  {
    id: "structure",
    label: "Market Structure",
    icon: "🏗",
    desc: "Float, cap, liquidity",
    filters: [
      { id: "market_cap", label: "Market Cap", type: "range", min: 0, max: 3000000000000, step: 1000000, unit: "$", defaultMin: 0, defaultMax: 3000000000000, format: "abbr" },
      { id: "float", label: "Float", type: "range", min: 0, max: 10000000000, step: 100000, unit: "", defaultMin: 0, defaultMax: 10000000000, format: "abbr" },
      { id: "short_float", label: "Short Float %", type: "range", min: 0, max: 100, step: 0.5, unit: "%", defaultMin: 0, defaultMax: 100 },
      { id: "avg_volume", label: "Avg Volume", type: "range", min: 0, max: 500000000, step: 10000, unit: "", defaultMin: 200000, defaultMax: 500000000, format: "abbr" },
      { id: "spread_pct", label: "Spread %", type: "range", min: 0, max: 5, step: 0.01, unit: "%", defaultMin: 0, defaultMax: 1 },
      { id: "shares_out", label: "Shares Out", type: "range", min: 0, max: 20000000000, step: 1000000, unit: "", defaultMin: 0, defaultMax: 20000000000, format: "abbr" },
      { id: "sector", label: "Sector", type: "multiselect", options: ["Technology", "Healthcare", "Financials", "Consumer Disc.", "Consumer Staples", "Energy", "Industrials", "Materials", "Real Estate", "Utilities", "Comms"] },
      { id: "exchange", label: "Exchange", type: "multiselect", options: ["NYSE", "NASDAQ", "AMEX"] },
      { id: "instrument_type", label: "Instrument Type", type: "multiselect", options: ["STOCK", "ETF", "ADR", "REIT", "FUND", "OTHER"] },
    ],
  },
  {
    id: "technical",
    label: "Technical",
    icon: "📐",
    desc: "Indicators & patterns",
    filters: [
      { id: "rsi_14", label: "RSI (14)", type: "range", min: 0, max: 100, step: 1, unit: "", defaultMin: 0, defaultMax: 100 },
      { id: "atr_pct", label: "ATR %", type: "range", min: 0, max: 50, step: 0.1, unit: "%", defaultMin: 0, defaultMax: 50 },
      { id: "adr_pct", label: "ADR %", type: "range", min: 0, max: 50, step: 0.1, unit: "%", defaultMin: 2, defaultMax: 50 },
      { id: "from_52w_high", label: "From 52W High %", type: "range", min: -100, max: 0, step: 1, unit: "%", defaultMin: -100, defaultMax: 0 },
      { id: "from_52w_low", label: "From 52W Low %", type: "range", min: 0, max: 5000, step: 1, unit: "%", defaultMin: 0, defaultMax: 5000 },
      { id: "above_vwap", label: "Above VWAP", type: "toggle" },
      { id: "above_sma20", label: "Above SMA 20", type: "toggle" },
      { id: "above_sma50", label: "Above SMA 50", type: "toggle" },
      { id: "above_sma200", label: "Above SMA 200", type: "toggle" },
      { id: "squeeze", label: "Squeeze Setup", type: "toggle" },
      { id: "new_hod", label: "New HOD", type: "toggle" },
      { id: "beta", label: "Beta", type: "range", min: -5, max: 10, step: 0.1, unit: "", defaultMin: 0, defaultMax: 10 },
    ],
  },
  {
    id: "catalyst",
    label: "Catalyst & Events",
    icon: "🔥",
    desc: "Earnings, news, insiders",
    filters: [
      { id: "days_to_earnings", label: "Days to Earnings", type: "range", min: 0, max: 90, step: 1, unit: "d", defaultMin: 0, defaultMax: 90 },
      { id: "earnings_surprise", label: "Earnings Surprise %", type: "range", min: -100, max: 500, step: 1, unit: "%", defaultMin: -100, defaultMax: 500 },
      { id: "has_news", label: "Has News Today", type: "toggle" },
      { id: "insider_buy", label: "Recent Insider Buy", type: "toggle" },
      { id: "analyst_upgrade", label: "Recent Upgrade", type: "toggle" },
      { id: "inst_ownership", label: "Inst. Ownership %", type: "range", min: 0, max: 100, step: 1, unit: "%", defaultMin: 0, defaultMax: 100 },
      { id: "insider_ownership", label: "Insider Own %", type: "range", min: 0, max: 100, step: 1, unit: "%", defaultMin: 0, defaultMax: 100 },
    ],
  },
  {
    id: "fundamental",
    label: "Fundamentals",
    icon: "📊",
    desc: "Valuation & growth",
    filters: [
      { id: "pe", label: "P/E", type: "range", min: -500, max: 1000, step: 1, unit: "", defaultMin: -500, defaultMax: 1000 },
      { id: "ps", label: "P/S", type: "range", min: 0, max: 500, step: 0.5, unit: "", defaultMin: 0, defaultMax: 500 },
      { id: "eps_growth", label: "EPS Growth %", type: "range", min: -100, max: 1000, step: 1, unit: "%", defaultMin: -100, defaultMax: 1000 },
      { id: "rev_growth", label: "Rev Growth %", type: "range", min: -100, max: 1000, step: 1, unit: "%", defaultMin: -100, defaultMax: 1000 },
      { id: "debt_equity", label: "Debt/Equity", type: "range", min: 0, max: 20, step: 0.1, unit: "", defaultMin: 0, defaultMax: 20 },
      { id: "roe", label: "ROE %", type: "range", min: -100, max: 200, step: 1, unit: "%", defaultMin: -100, defaultMax: 200 },
      { id: "fcf_yield", label: "FCF Yield %", type: "range", min: -50, max: 50, step: 0.5, unit: "%", defaultMin: -50, defaultMax: 50 },
      { id: "div_yield", label: "Div Yield %", type: "range", min: 0, max: 30, step: 0.1, unit: "%", defaultMin: 0, defaultMax: 30 },
    ],
  },
  {
    id: "options",
    label: "Options Flow",
    icon: "🎯",
    desc: "Unusual activity & IV",
    filters: [
      { id: "iv_rank", label: "IV Rank", type: "range", min: 0, max: 100, step: 1, unit: "", defaultMin: 0, defaultMax: 100 },
      { id: "put_call_ratio", label: "Put/Call Ratio", type: "range", min: 0, max: 10, step: 0.1, unit: "", defaultMin: 0, defaultMax: 10 },
      { id: "opt_volume", label: "Options Vol", type: "range", min: 0, max: 10000000, step: 1000, unit: "", defaultMin: 0, defaultMax: 10000000, format: "abbr" },
      { id: "opt_vol_vs_30d", label: "Opt Vol vs 30d", type: "range", min: 0, max: 50, step: 0.1, unit: "x", defaultMin: 0, defaultMax: 50 },
      { id: "net_premium", label: "Net Premium $", type: "range", min: -100000000, max: 100000000, step: 10000, unit: "$", defaultMin: -100000000, defaultMax: 100000000, format: "abbr" },
      { id: "unusual_opts", label: "Unusual Options", type: "toggle" },
    ],
  },
];

const PRESETS = [
  { id: "orb", label: "ORB Scanner", icon: "🎯", filters: { gap_pct: [2, 100], rvol: [1.5, 50], volume: [100000, 500000000], price: [5, 500], atr_pct: [2, 50] } },
  { id: "gap_up", label: "Gap Up", icon: "🚀", filters: { gap_pct: [3, 200], pm_volume: [50000, 50000000], volume: [200000, 500000000], price: [1, 500] } },
  { id: "short_squeeze", label: "Short Squeeze", icon: "🔥", filters: { short_float: [20, 100], rvol: [2, 50], change_pct: [5, 500], float: [0, 50000000] } },
  { id: "earnings_play", label: "Earnings Play", icon: "📅", filters: { days_to_earnings: [0, 5], iv_rank: [50, 100], opt_vol_vs_30d: [1.5, 50] } },
  { id: "momentum", label: "Momentum", icon: "⚡", filters: { change_pct: [5, 500], rvol: [2, 50], above_vwap: true, new_hod: true, volume: [500000, 500000000] } },
  { id: "low_float", label: "Low Float Runner", icon: "💎", filters: { float: [0, 20000000], rvol: [3, 50], change_pct: [10, 500], price: [1, 30] } },
];

const OPS = {
  range: [">", ">=", "<", "<=", "=", "between"],
  toggle: ["is true", "is false"],
  multiselect: ["in", "not in"],
};

function allFiltersFlat() {
  const filters = [];
  FILTER_GROUPS.forEach((group) => {
    group.filters.forEach((filter) => filters.push({ ...filter, group: group.label }));
  });
  return filters;
}

const FILTERS_FLAT = allFiltersFlat();

function RangeSlider({ filter, value, onChange }) {
  const [low, high] = value || [filter.min, filter.max];
  const range = filter.max - filter.min;
  const lowPercent = ((low - filter.min) / range) * 100;
  const highPercent = ((high - filter.min) / range) * 100;
  const isActive = low !== filter.min || high !== filter.max;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: isActive ? COLORS.accent : "#8a94a6", fontWeight: isActive ? 600 : 400, letterSpacing: 0.2 }}>
          {filter.label}
        </span>
        {isActive ? (
          <button onClick={() => onChange([filter.min, filter.max])} style={{ background: "none", border: "none", color: COLORS.muted, fontSize: 10, cursor: "pointer", padding: 0 }} title="Reset">x</button>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="number"
          value={low}
          onChange={(event) => onChange([Math.min(Number(event.target.value), high), high])}
          style={{
            width: 58,
            background: "#151c2c",
            border: `1px solid ${isActive ? "#2a4a5a" : "#1e2738"}`,
            borderRadius: 4,
            color: COLORS.text,
            padding: "3px 5px",
            fontSize: 11,
            textAlign: "center",
            outline: "none",
          }}
        />
        <div style={{ flex: 1, position: "relative", height: 18, display: "flex", alignItems: "center" }}>
          <div style={{ position: "absolute", left: 0, right: 0, height: 3, background: "#1e2738", borderRadius: 2 }} />
          <div style={{ position: "absolute", left: `${lowPercent}%`, right: `${100 - highPercent}%`, height: 3, background: isActive ? `linear-gradient(90deg, ${COLORS.accent}, #3be8c4)` : "#2a3448", borderRadius: 2 }} />
          <input
            type="range"
            min={filter.min}
            max={filter.max}
            step={filter.step}
            value={low}
            onChange={(event) => onChange([Math.min(Number(event.target.value), high), high])}
            style={{ position: "absolute", width: "100%", height: 18, opacity: 0, cursor: "pointer", zIndex: 2 }}
          />
          <input
            type="range"
            min={filter.min}
            max={filter.max}
            step={filter.step}
            value={high}
            onChange={(event) => onChange([low, Math.max(Number(event.target.value), low)])}
            style={{ position: "absolute", width: "100%", height: 18, opacity: 0, cursor: "pointer", zIndex: 3 }}
          />
          <div style={{ position: "absolute", left: `calc(${lowPercent}% - 5px)`, width: 10, height: 10, borderRadius: "50%", background: isActive ? COLORS.accent : "#3a4560", border: `2px solid ${COLORS.background}`, zIndex: 4, pointerEvents: "none" }} />
          <div style={{ position: "absolute", left: `calc(${highPercent}% - 5px)`, width: 10, height: 10, borderRadius: "50%", background: isActive ? COLORS.accent : "#3a4560", border: `2px solid ${COLORS.background}`, zIndex: 4, pointerEvents: "none" }} />
        </div>
        <input
          type="number"
          value={high}
          onChange={(event) => onChange([low, Math.max(Number(event.target.value), low)])}
          style={{
            width: 58,
            background: "#151c2c",
            border: `1px solid ${isActive ? "#2a4a5a" : "#1e2738"}`,
            borderRadius: 4,
            color: COLORS.text,
            padding: "3px 5px",
            fontSize: 11,
            textAlign: "center",
            outline: "none",
          }}
        />
      </div>
    </div>
  );
}

function ToggleFilter({ filter, value, onChange }) {
  const isOn = Boolean(value);
  return (
    <div onClick={() => onChange(!isOn)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", padding: "2px 0" }}>
      <span style={{ fontSize: 11, color: isOn ? "#4ff8d2" : "#8a94a6", fontWeight: isOn ? 600 : 400 }}>{filter.label}</span>
      <div style={{ width: 32, height: 16, borderRadius: 8, background: isOn ? COLORS.accent : "#1e2738", position: "relative", transition: "background 0.2s", border: `1px solid ${isOn ? COLORS.accent : "#2a3448"}` }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: isOn ? "#fff" : "#3a4560", position: "absolute", top: 1, left: isOn ? 17 : 2, transition: "left 0.2s" }} />
      </div>
    </div>
  );
}

function MultiSelectFilter({ filter, value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = value || [];
  const isActive = selected.length > 0;
  const ref = useRef(null);

  useEffect(() => {
    const handler = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: isActive ? "#4ff8d2" : "#8a94a6", fontWeight: isActive ? 600 : 400 }}>{filter.label}</span>
        {isActive ? <button onClick={() => onChange([])} style={{ background: "none", border: "none", color: COLORS.muted, fontSize: 10, cursor: "pointer", padding: 0 }}>x</button> : null}
      </div>
      <div onClick={() => setOpen(!open)} style={{ background: "#151c2c", border: `1px solid ${isActive ? "#2a4a5a" : "#1e2738"}`, borderRadius: 4, padding: "4px 8px", fontSize: 11, color: "#8a94a6", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3, minHeight: 24 }}>
        <span style={{ color: isActive ? COLORS.text : COLORS.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
          {isActive ? selected.join(", ") : "Any"}
        </span>
        <span style={{ fontSize: 8, marginLeft: 4 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open ? (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100, background: "#151c2c", border: "1px solid #2a3448", borderRadius: 6, marginTop: 2, maxHeight: 160, overflowY: "auto", padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
          {filter.options.map((option) => {
            const selectedOption = selected.includes(option);
            return (
              <div key={option} onClick={() => onChange(selectedOption ? selected.filter((item) => item !== option) : [...selected, option])} style={{ padding: "4px 8px", fontSize: 11, color: selectedOption ? "#4ff8d2" : "#8a94a6", cursor: "pointer", borderRadius: 3, background: selectedOption ? "rgba(34,211,160,0.08)" : "transparent", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, border: `1px solid ${selectedOption ? COLORS.accent : "#2a3448"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, background: selectedOption ? COLORS.accent : "transparent", color: COLORS.background }}>
                  {selectedOption ? "✓" : null}
                </span>
                {option}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ConditionRow({ cond, onUpdate, onRemove, index }) {
  const selectedFilter = FILTERS_FLAT.find((filter) => filter.id === cond.filterId) || FILTERS_FLAT[0];
  const operators = OPS[selectedFilter.type] || OPS.range;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", flexWrap: "wrap" }}>
      {index > 0 ? (
        <select value={cond.join || "AND"} onChange={(event) => onUpdate({ ...cond, join: event.target.value })} style={{ background: "#151c2c", border: "1px solid #2a3448", borderRadius: 4, color: cond.join === "OR" ? "#f0b232" : COLORS.accent, fontSize: 10, padding: "2px 4px", fontWeight: 700, width: 50, cursor: "pointer", outline: "none" }}>
          <option value="AND">AND</option>
          <option value="OR">OR</option>
          <option value="NOT">NOT</option>
        </select>
      ) : null}
      <select value={cond.filterId} onChange={(event) => {
        const nextFilter = FILTERS_FLAT.find((filter) => filter.id === event.target.value);
        onUpdate({ ...cond, filterId: event.target.value, op: OPS[nextFilter?.type || "range"][0] || ">", value: "", value2: "" });
      }} style={{ background: "#151c2c", border: "1px solid #2a3448", borderRadius: 4, color: COLORS.text, fontSize: 11, padding: "3px 6px", flex: "0 0 auto", maxWidth: 130, cursor: "pointer", outline: "none" }}>
        {FILTER_GROUPS.map((group) => (
          <optgroup key={group.id} label={`${group.icon} ${group.label}`}>
            {group.filters.map((filter) => (
              <option key={filter.id} value={filter.id}>{filter.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <select value={cond.op} onChange={(event) => onUpdate({ ...cond, op: event.target.value })} style={{ background: "#151c2c", border: "1px solid #2a3448", borderRadius: 4, color: "#8a94a6", fontSize: 11, padding: "3px 6px", width: 70, cursor: "pointer", outline: "none" }}>
        {operators.map((operator) => (
          <option key={operator} value={operator}>{operator}</option>
        ))}
      </select>
      {selectedFilter.type === "multiselect" ? (
        <select multiple value={cond.value ? cond.value.split(",") : []} onChange={(event) => onUpdate({ ...cond, value: Array.from(event.target.selectedOptions, (option) => option.value).join(",") })} style={{ background: "#151c2c", border: "1px solid #2a3448", borderRadius: 4, color: COLORS.text, fontSize: 11, padding: "2px 4px", height: 48, flex: 1, minWidth: 80, outline: "none" }}>
          {selectedFilter.options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : selectedFilter.type === "toggle" ? null : (
        <>
          <input type="number" value={cond.value} placeholder={selectedFilter.unit || ""} onChange={(event) => onUpdate({ ...cond, value: event.target.value })} style={{ background: "#151c2c", border: "1px solid #2a3448", borderRadius: 4, color: COLORS.text, fontSize: 11, padding: "3px 6px", width: 64, outline: "none" }} />
          {cond.op === "between" ? (
            <>
              <span style={{ color: COLORS.muted, fontSize: 10 }}>-</span>
              <input type="number" value={cond.value2} placeholder="max" onChange={(event) => onUpdate({ ...cond, value2: event.target.value })} style={{ background: "#151c2c", border: "1px solid #2a3448", borderRadius: 4, color: COLORS.text, fontSize: 11, padding: "3px 6px", width: 64, outline: "none" }} />
            </>
          ) : null}
        </>
      )}
      <button onClick={onRemove} style={{ background: "none", border: "none", color: COLORS.muted, fontSize: 14, cursor: "pointer", padding: "0 2px", lineHeight: 1 }} title="Remove condition">x</button>
    </div>
  );
}

function ConditionGroup({ group, onUpdate, onRemove, depth = 0 }) {
  const addCondition = () => {
    onUpdate({
      ...group,
      conditions: [...group.conditions, { id: Date.now(), filterId: "price", op: ">", value: "", value2: "", join: "AND" }],
    });
  };

  const addGroup = () => {
    onUpdate({
      ...group,
      conditions: [...group.conditions, { id: Date.now(), isGroup: true, join: "OR", conditions: [{ id: Date.now() + 1, filterId: "rvol", op: ">", value: "", value2: "", join: "AND" }] }],
    });
  };

  const updateCondition = (index, updated) => {
    const copy = [...group.conditions];
    copy[index] = updated;
    onUpdate({ ...group, conditions: copy });
  };

  const removeCondition = (index) => {
    onUpdate({ ...group, conditions: group.conditions.filter((_, conditionIndex) => conditionIndex !== index) });
  };

  return (
    <div style={{ border: depth > 0 ? "1px solid #1e2738" : "none", borderRadius: 6, background: depth > 0 ? "rgba(14,19,32,0.5)" : "transparent", padding: depth > 0 ? "6px 8px" : 0, marginTop: depth > 0 ? 4 : 0 }}>
      {depth > 0 ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <select value={group.join} onChange={(event) => onUpdate({ ...group, join: event.target.value })} style={{ background: "#151c2c", border: "1px solid #2a3448", borderRadius: 4, color: group.join === "OR" ? "#f0b232" : COLORS.accent, fontSize: 10, fontWeight: 700, padding: "2px 6px", cursor: "pointer", outline: "none" }}>
            <option value="AND">AND group</option>
            <option value="OR">OR group</option>
          </select>
          <button onClick={onRemove} style={{ background: "none", border: "none", color: COLORS.muted, fontSize: 12, cursor: "pointer" }}>x</button>
        </div>
      ) : null}
      {group.conditions.map((condition, index) => (
        condition.isGroup ? (
          <ConditionGroup key={condition.id} group={condition} depth={depth + 1} onUpdate={(updated) => updateCondition(index, updated)} onRemove={() => removeCondition(index)} />
        ) : (
          <ConditionRow key={condition.id} cond={condition} index={index} onUpdate={(updated) => updateCondition(index, updated)} onRemove={() => removeCondition(index)} />
        )
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button onClick={addCondition} style={{ background: "rgba(34,211,160,0.06)", border: "1px dashed #2a4a5a", borderRadius: 4, color: COLORS.accent, fontSize: 10, padding: "3px 10px", cursor: "pointer" }}>+ Condition</button>
        {depth < 2 ? (
          <button onClick={addGroup} style={{ background: "rgba(240,178,50,0.06)", border: "1px dashed #4a3a1a", borderRadius: 4, color: "#f0b232", fontSize: 10, padding: "3px 10px", cursor: "pointer" }}>+ Group</button>
        ) : null}
      </div>
    </div>
  );
}

function buildExpression(group) {
  return group.conditions.map((condition, index) => {
    if (condition.isGroup) {
      const inner = buildExpression(condition);
      return `${index > 0 ? `${condition.join} ` : ""}(${inner})`;
    }

    const filter = FILTERS_FLAT.find((item) => item.id === condition.filterId);
    const label = filter?.label || condition.filterId;
    let expression = "";

    if (condition.op === "between") {
      expression = `${label} ${condition.value}-${condition.value2}`;
    } else if (condition.op === "is true") {
      expression = `${label}`;
    } else if (condition.op === "is false") {
      expression = `!${label}`;
    } else {
      expression = `${label} ${condition.op} ${condition.value}`;
    }

    return `${index > 0 ? `${condition.join} ` : ""}${expression}`;
  }).join(" ");
}

export default function ScreenerFilterPanel({ onApply, onApplyBoolean, initialFilters = {} }) {
  const [mode, setMode] = useState("manual");
  const [expanded, setExpanded] = useState(true);
  const [openGroups, setOpenGroups] = useState({ momentum: true });
  const [filterValues, setFilterValues] = useState(initialFilters || {});
  const [booleanRoot, setBooleanRoot] = useState({
    id: 1,
    isGroup: true,
    join: "AND",
    conditions: [
      { id: 2, filterId: "price", op: ">", value: "5", value2: "", join: "AND" },
      { id: 3, filterId: "rvol", op: ">", value: "1.5", value2: "", join: "AND" },
      { id: 4, filterId: "gap_pct", op: "between", value: "2", value2: "100", join: "AND" },
    ],
  });

  useEffect(() => {
    setFilterValues(initialFilters || {});
  }, [initialFilters]);

  useEffect(() => {
    if (mode !== "manual") {
      return;
    }

    onApply?.(filterValues);
  }, [filterValues, mode, onApply]);

  useEffect(() => {
    if (mode !== "boolean") {
      return;
    }

    onApplyBoolean?.(booleanRoot);
  }, [booleanRoot, mode, onApplyBoolean]);

  const setFilter = (id, value) => {
    setFilterValues((previous) => {
      const next = { ...previous };
      const filter = FILTERS_FLAT.find((item) => item.id === id);

      if (filter && filter.type === "range" && Array.isArray(value) && value[0] === filter.min && value[1] === filter.max) {
        delete next[id];
      } else if (value === false || (Array.isArray(value) && value.length === 0)) {
        delete next[id];
      } else {
        next[id] = value;
      }

      return next;
    });
  };

  const applyPreset = (preset) => {
    const nextValues = {};
    Object.entries(preset.filters).forEach(([key, value]) => {
      nextValues[key] = value;
    });
    setFilterValues(nextValues);
  };

  const clearAll = () => {
    setFilterValues({});
    setBooleanRoot({
      id: 1,
      isGroup: true,
      join: "AND",
      conditions: [{ id: Date.now(), filterId: "price", op: ">", value: "", value2: "", join: "AND" }],
    });
  };

  const toggleGroup = (groupId) => setOpenGroups((previous) => ({ ...previous, [groupId]: !previous[groupId] }));
  const activeCount = Object.keys(filterValues).length;

  const handleApply = () => {
    if (mode === "boolean") {
      onApplyBoolean?.(booleanRoot);
      return;
    }

    onApply?.(filterValues);
  };

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', 'SF Pro Text', -apple-system, sans-serif", color: COLORS.text, width: "100%", userSelect: "none" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: `linear-gradient(135deg, ${COLORS.background} 0%, #131a2b 100%)`, borderBottom: `1px solid ${COLORS.border}`, borderRadius: expanded ? "8px 8px 0 0" : "8px", cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, color: COLORS.accent }}>⊞</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", letterSpacing: 0.5 }}>FILTERS</span>
          {activeCount > 0 ? (
            <span style={{ background: `linear-gradient(135deg, ${COLORS.accent}, #1ab390)`, color: COLORS.background, fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10, minWidth: 18, textAlign: "center" }}>{activeCount}</span>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={(event) => event.stopPropagation()}>
          <div style={{ display: "flex", background: "#0a0f1a", borderRadius: 5, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
            <button onClick={() => setMode("manual")} style={{ background: mode === "manual" ? "#1a2640" : "transparent", border: "none", color: mode === "manual" ? COLORS.accent : COLORS.muted, fontSize: 10, fontWeight: 600, padding: "4px 10px", cursor: "pointer", letterSpacing: 0.3, transition: "all 0.2s" }}>MANUAL</button>
            <button onClick={() => setMode("boolean")} style={{ background: mode === "boolean" ? "#1a2640" : "transparent", border: "none", color: mode === "boolean" ? "#f0b232" : COLORS.muted, fontSize: 10, fontWeight: 600, padding: "4px 10px", cursor: "pointer", letterSpacing: 0.3, transition: "all 0.2s" }}>BOOLEAN</button>
          </div>
          {activeCount > 0 ? <button onClick={clearAll} style={{ background: "none", border: "none", color: COLORS.muted, fontSize: 10, cursor: "pointer", padding: "2px 4px" }}>Clear</button> : null}
          <span style={{ color: "#3a4560", fontSize: 12, cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded ? (
        <div style={{ background: COLORS.background, border: `1px solid ${COLORS.border}`, borderTop: "none", borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 6, padding: "8px 12px", overflowX: "auto", borderBottom: "1px solid #141c2e", background: "rgba(14,19,32,0.6)" }}>
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  setMode("manual");
                  applyPreset(preset);
                }}
                style={{ background: "#141c2e", border: "1px solid #1e2738", borderRadius: 5, color: "#8a94a6", fontSize: 10, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4, transition: "all 0.15s" }}
              >
                <span>{preset.icon}</span>
                {preset.label}
              </button>
            ))}
          </div>

          {mode === "manual" ? (
            <div style={{ maxHeight: 420, overflowY: "auto", padding: "0 4px" }}>
              {FILTER_GROUPS.map((group) => {
                const isOpen = openGroups[group.id];
                const groupActiveCount = group.filters.filter((filter) => filterValues[filter.id] !== undefined).length;

                return (
                  <div key={group.id} style={{ borderBottom: "1px solid #141c2e" }}>
                    <div onClick={() => toggleGroup(group.id)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 8px", cursor: "pointer", transition: "background 0.15s" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13 }}>{group.icon}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.text, letterSpacing: 0.4, textTransform: "uppercase" }}>{group.label}</span>
                        {groupActiveCount > 0 ? <span style={{ background: COLORS.accent, color: COLORS.background, fontSize: 9, fontWeight: 700, padding: "0 5px", borderRadius: 8 }}>{groupActiveCount}</span> : null}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, color: COLORS.muted }}>{group.filters.length}</span>
                        <span style={{ color: "#3a4560", fontSize: 10, transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
                      </div>
                    </div>
                    {isOpen ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px 16px", padding: "4px 12px 12px 12px" }}>
                        {group.filters.map((filter) => {
                          if (filter.type === "range") {
                            return <RangeSlider key={filter.id} filter={filter} value={filterValues[filter.id]} onChange={(value) => setFilter(filter.id, value)} />;
                          }

                          if (filter.type === "toggle") {
                            return <ToggleFilter key={filter.id} filter={filter} value={filterValues[filter.id]} onChange={(value) => setFilter(filter.id, value)} />;
                          }

                          if (filter.type === "multiselect") {
                            return <MultiSelectFilter key={filter.id} filter={filter} value={filterValues[filter.id]} onChange={(value) => setFilter(filter.id, value)} />;
                          }

                          return null;
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: "8px 12px", maxHeight: 420, overflowY: "auto" }}>
              <div style={{ background: "#0a0f1a", border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "6px 10px", marginBottom: 10, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: COLORS.muted, lineHeight: 1.5, overflowX: "auto", whiteSpace: "nowrap" }}>
                <span style={{ color: "#3a4560", fontSize: 9, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 2 }}>Expression</span>
                <span style={{ color: "#8a94a6" }}>{buildExpression(booleanRoot) || "-"}</span>
              </div>
              <ConditionGroup group={booleanRoot} onUpdate={setBooleanRoot} onRemove={() => {}} depth={0} />
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderTop: "1px solid #141c2e", background: "rgba(14,19,32,0.6)" }}>
            <span style={{ fontSize: 10, color: COLORS.muted }}>
              {mode === "manual" ? `${activeCount} active filter${activeCount !== 1 ? "s" : ""}` : `${booleanRoot.conditions.length} condition${booleanRoot.conditions.length !== 1 ? "s" : ""}`}
            </span>
            <button style={{ background: `linear-gradient(135deg, ${COLORS.accent}, #1ab390)`, border: "none", borderRadius: 5, color: COLORS.background, fontSize: 11, fontWeight: 700, padding: "6px 20px", cursor: "pointer", letterSpacing: 0.5, boxShadow: "0 2px 12px rgba(34,211,160,0.2)" }} onClick={handleApply}>
              REFRESH FILTERS
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}