import { useState, useCallback } from 'react';
import MarketContextStrip from './MarketContextStrip';
import TickerTape from './TickerTape';
import StrategyChips, { STRATEGIES } from './StrategyChips';
import ScreenerModule from './ScreenerModule';
import DeepDivePanel from './DeepDivePanel';
import TradePlanModal from './TradePlanModal';
import BiasChallenge from './BiasChallenge';
import AIChatBar from './AIChatBar';
import GlobalFiltersPanel from './GlobalFiltersPanel';
import ToastContainer, { useToast } from './ToastContainer';
import useWatchlist from '../../hooks/useWatchlist';
import { buildFilterDefaults } from '../../features/news/FilterConfigs';
import { apiJSON } from '@/config/api';

export default function AIQuantPage() {
  const [activeChip, setActiveChip] = useState(null);
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [tradePlan, setTradePlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [showBiasChallenge, setShowBiasChallenge] = useState(false);

  const [filters, setFilters] = useState(buildFilterDefaults);
  const [validationMode, setValidationMode] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [earningsData, setEarningsData] = useState([]);
  const { toasts, addToast } = useToast();
  const watchlist = useWatchlist();

  const effectiveFilters = { ...filters, validationMode };

  const handleDataReady = useCallback((_strategy, data) => {
    setEarningsData(data);
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

  const handleBuildPlan = useCallback(async ({ ticker, data }) => {
    setPlanLoading(true);
    try {
      const body = {
        ticker,
        strategy: activeChip || 'screener',
        direction: 'long',
        entryPrice: data?.price || null,
        atr: data?.atr || null,
      };
      const plan = await apiJSON('/api/ai-quant/build-plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setTradePlan(plan);
    } catch (e) { console.error('Build plan error:', e); }
    finally { setPlanLoading(false); }
  }, [activeChip]);

  const strategyFilter = activeChip
    ? STRATEGIES.find(s => s.id === activeChip)?.filter
    : null;

  const selectedRow = selectedTicker
    ? earningsData.find(r => r.ticker === selectedTicker)
    : null;

  return (
    <div className="page-container page-stack aiq-page-v2">
      {/* Scrolling Ticker Tape */}
      <TickerTape />

      {/* Top Strip: Market Context */}
      <MarketContextStrip />

      {/* Strategy Filter Chips */}
      <div className="aiq-chips-bar">
        <StrategyChips active={activeChip} onSelect={setActiveChip} />
      </div>

      {/* Main Content Area */}
      <div className={`aiq-main ${selectedTicker ? 'aiq-main--has-dive' : ''}`}>
        {/* Center Column */}
        <div className="aiq-center-col">
          <GlobalFiltersPanel filters={filters} setFilters={setFilters}
            validationMode={validationMode} setValidationMode={setValidationMode}
            collapsed={filtersCollapsed} setCollapsed={setFiltersCollapsed}
            activeStrategy="screener"
          />

          <ScreenerModule
            onSelectTicker={handleSelectTicker}
            filters={effectiveFilters}
            selected={selected}
            onToggleSelect={handleToggleSelect}
            onDataReady={handleDataReady}
            watchlist={watchlist}
            strategyFilter={strategyFilter}
          />
        </div>

        {/* Right Column: Deep Dive */}
        {selectedTicker && (
          <DeepDivePanel
            ticker={selectedTicker} onClose={handleCloseDive}
            onBuildPlan={handleBuildPlan} activeStrategy={activeChip || 'screener'}
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
    </div>
  );
}
