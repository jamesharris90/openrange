import { useState, useCallback, useRef } from 'react';
import MarketContextStrip from './MarketContextStrip';
import StrategyPanel from './StrategyPanel';
import DeepDivePanel from './DeepDivePanel';
import TradePlanModal from './TradePlanModal';
import BiasChallenge from './BiasChallenge';
import AIChatBar from './AIChatBar';
import GlobalFiltersPanel from './GlobalFiltersPanel';
import CustomStrategyBuilder, { loadCustomStrategies } from './CustomStrategyBuilder';
import CustomModule from './CustomModule';
import ToastContainer, { useToast } from './ToastContainer';
import { getConfidenceTier } from './scoring';
import { loadStrategyPrefs } from './StrategyManager';
import useWatchlist from '../../hooks/useWatchlist';
import { buildFilterDefaults } from '../../features/news/FilterConfigs';

export default function AIQuantPage() {
  const [strategyPrefs, setStrategyPrefs] = useState(loadStrategyPrefs);
  const [activeStrategy, setActiveStrategy] = useState(() => {
    const prefs = loadStrategyPrefs();
    const firstActive = prefs.order.find(id => prefs.active[id] !== false);
    return firstActive || 'orb';
  });
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [tradePlan, setTradePlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [showBiasChallenge, setShowBiasChallenge] = useState(false);
  const [showCustomBuilder, setShowCustomBuilder] = useState(false);
  const [customStrategies, setCustomStrategies] = useState(loadCustomStrategies);

  const [filters, setFilters] = useState(buildFilterDefaults);
  const [validationMode, setValidationMode] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const allDataRef = useRef({ orb: [], earnings: [], continuation: [] });
  const [allData, setAllData] = useState({ orb: [], earnings: [], continuation: [] });
  const { toasts, addToast } = useToast();
  const watchlist = useWatchlist();

  const effectiveFilters = { ...filters, validationMode };

  const handleDataReady = useCallback((strategy, data) => {
    allDataRef.current = { ...allDataRef.current, [strategy]: data };
    const sets = {};
    for (const [strat, rows] of Object.entries(allDataRef.current)) {
      for (const r of rows) {
        if (!sets[r.ticker]) sets[r.ticker] = new Set();
        sets[r.ticker].add(strat);
      }
    }
    const updated = {};
    const badgeMap = { orb: 'ORB', earnings: 'EARN', continuation: 'CONT' };
    for (const [strat, rows] of Object.entries(allDataRef.current)) {
      updated[strat] = rows.map(r => {
        const others = sets[r.ticker] ? [...sets[r.ticker]].filter(s => s !== strat) : [];
        const confirmBadges = others.map(s => badgeMap[s] || s.toUpperCase()).filter(Boolean);
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

  const handleSaveCustomStrategy = useCallback((strategy) => {
    setCustomStrategies(loadCustomStrategies());
    // Add to strategy prefs if not already present
    setStrategyPrefs(prev => {
      if (prev.order.includes(strategy.id)) return prev;
      const next = {
        ...prev,
        order: [...prev.order, strategy.id],
        active: { ...prev.active, [strategy.id]: true },
      };
      try { localStorage.setItem('aiq-strategy-prefs', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    setActiveStrategy(strategy.id);
    addToast?.(`Strategy "${strategy.name}" saved`, 'success');
  }, [addToast]);

  const selectedRow = selectedTicker
    ? Object.values(allData).flat().find(r => r.ticker === selectedTicker)
    : null;

  return (
    <div className="aiq-page-v2">
      {/* Top Strip: Market Context */}
      <MarketContextStrip />

      {/* Main Content Area */}
      <div className={`aiq-main ${selectedTicker ? 'aiq-main--has-dive' : ''}`}>
        {/* Center Column */}
        <div className="aiq-center-col">
          <GlobalFiltersPanel filters={filters} setFilters={setFilters}
            validationMode={validationMode} setValidationMode={setValidationMode}
            collapsed={filtersCollapsed} setCollapsed={setFiltersCollapsed}
            activeStrategy={activeStrategy}
          />

          <StrategyPanel
            activeStrategy={activeStrategy} onChangeStrategy={(id) => {
              if (strategyPrefs.active[id] !== false) setActiveStrategy(id);
            }}
            onSelectTicker={handleSelectTicker}
            filters={effectiveFilters} selected={selected} onToggleSelect={handleToggleSelect}
            onDataReady={handleDataReady} allData={allData} addToast={addToast} watchlist={watchlist}
            strategyPrefs={strategyPrefs} setStrategyPrefs={(next) => {
              setStrategyPrefs(next);
              if (next.active[activeStrategy] === false) {
                const firstActive = next.order.find(id => next.active[id] !== false);
                if (firstActive) setActiveStrategy(firstActive);
              }
            }}
            customStrategies={customStrategies}
            onAddCustom={() => setShowCustomBuilder(true)}
            CustomModuleComponent={CustomModule}
          />
        </div>

        {/* Right Column: Deep Dive */}
        {selectedTicker && (
          <DeepDivePanel
            ticker={selectedTicker} onClose={handleCloseDive}
            onBuildPlan={handleBuildPlan} activeStrategy={activeStrategy}
            rowData={selectedRow} watchlist={watchlist} addToast={addToast}
            onChallengeBias={() => setShowBiasChallenge(true)}
          />
        )}
      </div>

      {/* Bottom: AI Chat */}
      <AIChatBar />

      {/* Toast */}
      <ToastContainer toasts={toasts} />

      {/* Modals */}
      {tradePlan && <TradePlanModal plan={tradePlan} onClose={() => setTradePlan(null)} />}
      {showBiasChallenge && selectedTicker && (
        <BiasChallenge ticker={selectedTicker} onClose={() => setShowBiasChallenge(false)} />
      )}
      {showCustomBuilder && (
        <CustomStrategyBuilder
          onClose={() => setShowCustomBuilder(false)}
          onSave={handleSaveCustomStrategy}
        />
      )}
    </div>
  );
}
