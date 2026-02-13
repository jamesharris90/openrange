import { SOURCE_COLORS } from '../../utils/constants';

export default function TickerChip({ symbol, source, selected, onClick, onRemove }) {
  const colors = SOURCE_COLORS[source] || SOURCE_COLORS.manual;
  return (
    <button
      className={`ticker-chip${selected ? ' ticker-chip--selected' : ''}`}
      style={{
        background: selected ? colors.color : colors.bg,
        color: selected ? '#fff' : colors.color,
        borderColor: colors.color,
      }}
      onClick={() => onClick?.(symbol)}
    >
      <span className="ticker-chip__symbol">{symbol}</span>
      {onRemove && (
        <span
          className="ticker-chip__remove"
          onClick={(e) => { e.stopPropagation(); onRemove(symbol); }}
        >
          &times;
        </span>
      )}
    </button>
  );
}
