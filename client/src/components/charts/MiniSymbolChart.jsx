import MiniSparkline from './MiniSparkline';

export default function MiniSymbolChart({ symbol, height = 42 }) {
  if (!symbol) {
    return <div className="h-[42px] text-[10px] text-[var(--text-muted)]">No mini chart</div>;
  }

  return <MiniSparkline symbol={symbol} height={height} />;
}
