export default function TickerTile({ x, y, width, height, symbol, change, rvol }) {
  const safeSymbol = String(symbol || '?').toUpperCase();
  const safeChange = Number.isFinite(Number(change)) ? Number(change) : 0;
  const safeRvol = Number.isFinite(Number(rvol)) ? Number(rvol) : 0;
  const logoKey = import.meta.env.VITE_LOGO_DEV_KEY;
  const logoUrl = logoKey ? `https://img.logo.dev/ticker/${safeSymbol.toLowerCase()}?token=${logoKey}` : null;

  const showLogo = width > 70 && height > 80 && logoUrl;
  const logoSize = Math.round(Math.min(width * 0.4, 120));

  // Font size so symbol fills ~80% of tile width
  const symbolFontSize = Math.max(9, Math.min(
    Math.floor((width * 0.8) / (safeSymbol.length * 0.58)),
    Math.floor(height * 0.20),
    36,
  ));
  const detailFontSize = Math.max(9, Math.floor(symbolFontSize * 0.65));

  if (width < 20 || height < 16) return null;

  return (
    <g transform={`translate(${x},${y})`}>
      <foreignObject width={width} height={height}>
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '4px',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            color: 'var(--text-primary)',
            overflow: 'hidden',
            lineHeight: 1.15,
          }}
        >
          {showLogo && (
            <img
              src={logoUrl}
              alt={safeSymbol}
              loading="lazy"
              style={{
                width: logoSize,
                height: logoSize,
                borderRadius: '50%',
                objectFit: 'contain',
                display: 'block',
                marginBottom: 4,
                flexShrink: 0,
              }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
          <div style={{ fontSize: symbolFontSize, fontWeight: 800, letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>
            {safeSymbol}
          </div>
          <div style={{ fontSize: detailFontSize, fontWeight: 700, marginTop: 2 }}>
            {`${safeChange > 0 ? '+' : ''}${safeChange.toFixed(2)}%`}
          </div>
          <div style={{ fontSize: detailFontSize, opacity: 0.85 }}>
            RVOL {safeRvol.toFixed(2)}
          </div>
        </div>
      </foreignObject>
    </g>
  );
}
