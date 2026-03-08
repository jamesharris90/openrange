export default function TickerTile({ x, y, width, height, symbol, change, rvol, fontSize, detailSize }) {
  const safeSymbol = String(symbol || '?').toUpperCase();
  const safeChange = Number.isFinite(Number(change)) ? Number(change) : 0;
  const safeRvol = Number.isFinite(Number(rvol)) ? Number(rvol) : 0;
  const logoKey = import.meta.env.VITE_LOGO_DEV_KEY;
  const logoUrl = logoKey ? `https://img.logo.dev/ticker/${safeSymbol}?token=${logoKey}` : null;
  const showLogo = width > 70 && height > 70 && logoUrl;
  const logoSize = Math.round(Math.min(width * 0.38, height * 0.38, 56));

  return (
    <g transform={`translate(${x},${y})`}>
      <foreignObject width={width} height={height}>
        <div className="ticker-tile" style={{ pointerEvents: 'none' }}>
          {showLogo && (
            <div className="ticker-logo-wrap">
              <img
                src={logoUrl}
                alt={`${safeSymbol} logo`}
                loading="lazy"
                style={{ width: logoSize, height: logoSize, borderRadius: '50%', objectFit: 'contain', display: 'block' }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
          )}

          <div className="ticker-symbol" style={{ fontSize: `${fontSize}px` }}>{safeSymbol}</div>
          <div className="ticker-change" style={{ fontSize: `${detailSize}px` }}>{`${safeChange > 0 ? '+' : ''}${safeChange.toFixed(2)}%`}</div>
          <div className="ticker-rvol" style={{ fontSize: `${detailSize}px` }}>RVOL {safeRvol.toFixed(2)}</div>
        </div>
      </foreignObject>
    </g>
  );
}
