import { useState, useCallback, useRef } from 'react';
import MarketContextPanel from './MarketContextPanel';
import StrategyPanel from './StrategyPanel';
import DeepDivePanel from './DeepDivePanel';
import TradePlanModal from './TradePlanModal';
import BiasChallenge from './BiasChallenge';
import AIChatBar from './AIChatBar';
import GlobalFiltersPanel from './GlobalFiltersPanel';
import ToastContainer, { useToast } from './ToastContainer';
import { getConfidenceTier } from './scoring';
import useWatchlist from '../../hooks/useWatchlist';
import { MessageSquareWarning } from 'lucide-react';

export default function AIQuantPage() {
  const [activeStrategy, setActiveStrategy] = useState('orb');
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [tradePlan, setTradePlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [showBiasChallenge, setShowBiasChallenge] = useState(false);

  // New state for the 10 improvements
  const [filters, setFilters] = useState({});
  const [validationMode, setValidationMode] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const allDataRef = useRef({ orb: [], earnings: [], continuation: [] });
  const [allData, setAllData] = useState({ orb: [], earnings: [], continuation: [] });
  const { toasts, addToast } = useToast();
  const watchlist = useWatchlist();

  // Merge validationMode into filters for downstream consumption
  const effectiveFilters = { ...filters, validationMode };

  // Cross-scanner confirmation: when a module reports its data, compute confirmations across all strategies
  const handleDataReady = useCallback((strategy, data) => {
    allDataRef.current = { ...allDataRef.current, [strategy]: data };
    // Build cross-scanner ticker sets
    const sets = {};
    for (const [strat, rows] of Object.entries(allDataRef.current)) {
      for (const r of rows) {
        if (!sets[r.ticker]) sets[r.ticker] = new Set();
        sets[r.ticker].add(strat);
      }
    }
    // Enrich all datasets with confirmations
    const updated = {};
    for (const [strat, rows] of Object.entries(allDataRef.current)) {
      updated[strat] = rows.map(r => {
        const others = sets[r.ticker] ? [...sets[r.ticker]].filter(s => s !== strat) : [];
        const badgeMap = { orb: 'ORB', earnings: 'EARN', continuation: 'CONT' };
        const confirmBadges = others.map(s => badgeMap[s]).filter(Boolean);
        const confirmations = confirmBadges.length;
        return { ...r, confirmations, confirmBadges, confidenceTier: getConfidenceTier(r.score, confirmations) };
      });
    }
    setAllData(updated);
  }, []);

  const handleToggleSelect = useCallback((ticker, forceState) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (forceState === true) next.add(ticker);
      else if (forceState === false) next.delete(ticker);
      else if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }, []);

  const handleSelectTicker = useCallback((ticker) => setSelectedTicker(ticker), []);
  const handleCloseDive = useCallback(() => setSelectedTicker(null), []);

  const handleBuildPlan = useCallback(async ({ ticker, strategy, data }) => {
    setPlanLoading(true);
    try {
      const body = {
        ticker,
        strategy: strategy || activeStrategy,
        direction: 'long',
        entryPrice: data?.price || null,
        atr: data?.technicals?.atr || null,
        expectedMove: data?.expectedMove?.expectedMove || null,
      };
      const r = await fetch('/api/ai-quant/build-plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const plan = await r.json();
      if (!r.ok) throw new Error(plan.error || 'Failed to build plan');
      setTradePlan(plan);
    } catch (e) { console.error('Build plan error:', e); }
    finally { setPlanLoading(false); }
  }, [activeStrategy]);

  // Find selected ticker's row data for deep dive
  const selectedRow = selectedTicker
    ? Object.values(allData).flat().find(r => r.ticker === selectedTicker)
    : null;

  return (
    <div className={`aiq-page ${selectedTicker ? 'aiq-page--has-dive' : ''}`}>
      {/* Left Column: Market Context */}
      <MarketContextPanel />

      {/* Center Column: Filters + Strategy Tabs + Candidates */}
      <div className="aiq-center-col">
        <GlobalFiltersPanel filters={filters} setFilters={setFilters}
          validationMode={validationMode} setValidationMode={setValidationMode}
          collapsed={filtersCollapsed} setCollapsed={setFiltersCollapsed} />

        <StrategyPanel
          activeStrategy={activeStrategy} onChangeStrategy={setActiveStrategy}
          onSelectTicker={handleSelectTicker}
          filters={effectiveFilters} selected={selected} onToggleSelect={handleToggleSelect}
          onDataReady={handleDataReady} allData={allData} addToast={addToast} watchlist={watchlist}
        />
      </div>

      {/* Right Column: Deep Dive */}
      {selectedTicker && (
        <DeepDivePanel
          ticker={selectedTicker} onClose={handleCloseDive}
          onBuildPlan={handleBuildPlan} activeStrategy={activeStrategy}
          rowData={selectedRow} watchlist={watchlist} addToast={addToast}
        />
      )}

      {/* Bias Challenge trigger */}
      {selectedTicker && !showBiasChallenge && (
        <button className="aiq-bias-trigger" onClick={() => setShowBiasChallenge(true)} title="Challenge your bias">
          <MessageSquareWarning size={16} /> Challenge Bias
        </button>
      )}

      {/* Bottom: AI Chat */}
      <AIChatBar />

      {/* Toast */}
      <ToastContainer toasts={toasts} />

      {/* Modals */}
      {tradePlan && <TradePlanModal plan={tradePlan} onClose={() => setTradePlan(null)} />}
      {showBiasChallenge && selectedTicker && (
        <BiasChallenge ticker={selectedTicker} onClose={() => setShowBiasChallenge(false)} />
      )}
    </div>
  );
}
