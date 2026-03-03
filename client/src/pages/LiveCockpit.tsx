import React, { useMemo, useState } from 'react';

import ChartEngine from '../components/chartEngine/ChartEngine';
import ChartContainer from '../components/layout/ChartContainer';
import DOMPanel from '../components/cockpit/DOMPanel';
import NewsFeed from '../components/cockpit/NewsFeed';
import Watchlist from '../components/cockpit/Watchlist';
import DynamicWatchlist from '../components/cockpit/DynamicWatchlist';
import TickerSearch from '../components/cockpit/TickerSearch';
import CollapsiblePanel from '../components/cockpit/CollapsiblePanel';
import RapidTicket from '../components/cockpit/RapidTicket';
import { getProfileForTimeframe } from '../components/chartEngine/indicatorRegistry';
import { SymbolProvider, useSymbol } from '../context/SymbolContext';
import { useCockpitWatchlists } from '../hooks/useCockpitWatchlists';

type IndicatorState = {
  ema9: boolean;
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
  vwap: boolean;
  volume: boolean;
  rsi: boolean;
  macd: boolean;
  structures: boolean;
};

const EMPTY_INDICATORS = {};
const EMPTY_LEVELS = {};
const EMPTY_EVENTS: any[] = [];

type ChartWidgetProps = {
  symbol: string;
  timeframe: '1m' | '5m' | '1D';
  indicatorState: IndicatorState;
  onToggleIndicator: (key: keyof IndicatorState) => void;
  chartId: string;
  crosshairSyncEnabled: boolean;
  label: string;
};

function buildIndicatorState(timeframe: '1m' | '5m' | '1D'): IndicatorState {
  return {
    ema9: false,
    ema20: false,
    ema50: false,
    ema200: false,
    vwap: false,
    volume: false,
    rsi: false,
    macd: false,
    structures: false,
  };
}

const ChartWidget = React.memo(function ChartWidget({
  symbol,
  timeframe,
  indicatorState,
  onToggleIndicator,
  chartId,
  crosshairSyncEnabled,
  label,
}: ChartWidgetProps) {
  const profile = useMemo(() => getProfileForTimeframe(timeframe), [timeframe]);
  const isDailyTimeframe = timeframe === '1D';

  return (
    <div className="relative h-full min-h-0 rounded-md bg-gray-950 p-2">
      <div className="pointer-events-none absolute left-2 top-2 z-10 text-xs font-medium tracking-wide text-gray-300">
        {label}
      </div>
      <div className="absolute right-2 top-8 z-10 flex max-w-[60%] flex-wrap justify-end gap-1 rounded bg-gray-950/70 p-1">
        {[
          { key: 'ema9', label: 'EMA9' },
          { key: 'ema20', label: 'EMA20' },
          { key: 'ema50', label: 'EMA50' },
          { key: 'ema200', label: 'EMA200' },
          { key: 'vwap', label: 'VWAP' },
          { key: 'rsi', label: 'RSI' },
          { key: 'macd', label: 'MACD' },
        ].map((item) => {
          const key = item.key as keyof IndicatorState;
          const disabled = key === 'vwap' && isDailyTimeframe;
          const active = disabled ? false : Boolean(indicatorState[key]);
          return (
          <button
            key={item.key}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              onToggleIndicator(key);
            }}
            className={`rounded border px-1.5 py-0.5 text-[10px] ${active ? 'border-sky-500/70 bg-sky-500/20 text-sky-100' : 'border-gray-700 bg-gray-900/80 text-gray-400'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            {item.label}
          </button>
          );
        })}
      </div>
      <ChartContainer>
        <ChartEngine
          key={`${symbol}-${timeframe}`}
          symbol={symbol}
          timeframe={timeframe}
          mode="cockpit"
          profile={profile}
          candles={[]}
          lastUpdateTime={undefined}
          indicators={EMPTY_INDICATORS}
          levels={EMPTY_LEVELS}
          events={EMPTY_EVENTS}
          indicatorState={indicatorState}
          marketOverlay="none"
          sectorEtfSymbol={null}
          patternMode={false}
          loading={false}
          error=""
          chartId={chartId}
          crosshairSyncEnabled={crosshairSyncEnabled}
        />
      </ChartContainer>
    </div>
  );
});

function LiveCockpitContent() {
  console.log('LiveCockpit render');

  const { symbol, setSymbol } = useSymbol();
  const [crosshairSyncEnabled, setCrosshairSyncEnabled] = useState(true);
  const [visibleStaticSymbols, setVisibleStaticSymbols] = useState<string[]>([]);
  const [visibleDynamicSymbols, setVisibleDynamicSymbols] = useState<string[]>([]);
  const {
    staticRows,
    dynamicRows,
    addStaticSymbol,
    removeStaticSymbol,
    promoteDynamicSymbol,
    staticCount,
    staticMax,
    staticAtCap,
  } = useCockpitWatchlists({
    visibleStaticSymbols,
    visibleDynamicSymbols,
  });

  const [indicatorState1m, setIndicatorState1m] = useState<IndicatorState>(() => buildIndicatorState('1m'));
  const [indicatorState5m, setIndicatorState5m] = useState<IndicatorState>(() => buildIndicatorState('5m'));
  const [indicatorState1d, setIndicatorState1d] = useState<IndicatorState>(() => buildIndicatorState('1D'));

  const baseSmallChartHeight = 280;
  const baseLargeChartHeight = 420;
  const chart1dHeight = baseSmallChartHeight;
  const chart5mHeight = baseSmallChartHeight;
  const chart1mHeight = baseLargeChartHeight;
  const topRowMinHeight = baseSmallChartHeight;

  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col bg-gray-950 text-gray-200">
      <header className="border-b border-gray-800 bg-gray-950 px-4 py-3">
        <div className="mx-auto flex items-center gap-2">
          <TickerSearch symbol={symbol} onSelect={setSymbol} />
          <button
            type="button"
            onClick={() => setCrosshairSyncEnabled((previous) => !previous)}
            className="h-9 rounded-md border border-gray-800 bg-gray-900 px-3 text-xs font-medium uppercase tracking-wider text-gray-200"
          >
            Sync: {crosshairSyncEnabled ? 'ON' : 'OFF'}
          </button>
          <select
            className="h-9 rounded-md border border-gray-800 bg-gray-900 px-3 text-xs font-medium uppercase tracking-wider text-gray-300 outline-none"
            defaultValue="default"
          >
            <option value="default">Layout: Default</option>
          </select>
          <div className="ml-auto text-xs uppercase tracking-wider text-gray-400">Market Clock — --:--:--</div>
        </div>
      </header>

      <main className="flex flex-1 min-h-0 flex-row gap-4 overflow-hidden px-4 py-4">
        <section className="w-[70%] min-h-0 flex flex-col gap-4">
          <div className="flex min-h-0 gap-4" style={{ minHeight: `${topRowMinHeight}px` }}>
            <div className="min-h-0 flex-1" style={{ height: `${chart1dHeight}px` }}>
              <ChartWidget
                symbol={symbol}
                timeframe="1D"
                indicatorState={indicatorState1d}
                onToggleIndicator={(key) => setIndicatorState1d((prev) => ({ ...prev, [key]: !prev[key] }))}
                chartId="chart-1d"
                crosshairSyncEnabled={crosshairSyncEnabled}
                label={`${symbol} • 1D`}
              />
            </div>
            <div className="min-h-0 flex-1" style={{ height: `${chart5mHeight}px` }}>
              <ChartWidget
                symbol={symbol}
                timeframe="5m"
                indicatorState={indicatorState5m}
                onToggleIndicator={(key) => setIndicatorState5m((prev) => ({ ...prev, [key]: !prev[key] }))}
                chartId="chart-5m"
                crosshairSyncEnabled={crosshairSyncEnabled}
                label={`${symbol} • 5m`}
              />
            </div>
          </div>

          <div className="min-h-0" style={{ height: `${chart1mHeight}px` }}>
            <ChartWidget
              symbol={symbol}
              timeframe="1m"
              indicatorState={indicatorState1m}
              onToggleIndicator={(key) => setIndicatorState1m((prev) => ({ ...prev, [key]: !prev[key] }))}
              chartId="chart-1m"
              crosshairSyncEnabled={crosshairSyncEnabled}
              label={`${symbol} • 1m`}
            />
          </div>

          <NewsFeed symbol={symbol} />
        </section>

        <section className="w-[30%] min-h-0 overflow-auto flex flex-col gap-4">
          <CollapsiblePanel title="DOM" storageKey="panel-cockpit-dom">
              <DOMPanel midPrice={null} symbol={symbol} />
          </CollapsiblePanel>

          <CollapsiblePanel title="Rapid Ticket" storageKey="panel-cockpit-rapid-ticket">
            <RapidTicket symbol={symbol} />
          </CollapsiblePanel>

          <CollapsiblePanel title="Watchlist (Premarket Plan)" storageKey="panel-cockpit-watchlist">
              <Watchlist
                rows={staticRows}
                onAdd={addStaticSymbol}
                onRemove={removeStaticSymbol}
                staticCount={staticCount}
                staticMax={staticMax}
                staticAtCap={staticAtCap}
                onVisibleSymbolsChange={setVisibleStaticSymbols}
              />
          </CollapsiblePanel>

          <CollapsiblePanel title="Live Signals" storageKey="panel-cockpit-live-signals">
              <DynamicWatchlist
                rows={dynamicRows}
                onPlan={promoteDynamicSymbol}
                staticAtCap={staticAtCap}
                onVisibleSymbolsChange={setVisibleDynamicSymbols}
              />
          </CollapsiblePanel>

        </section>
      </main>
    </div>
  );
}

export default function LiveCockpit() {
  return (
    <SymbolProvider>
      <LiveCockpitContent />
    </SymbolProvider>
  );
}
