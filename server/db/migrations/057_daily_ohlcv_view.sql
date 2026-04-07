CREATE OR REPLACE VIEW daily_ohlcv AS
SELECT
  symbol,
  date,
  open,
  high,
  low,
  close,
  volume
FROM daily_ohlc;
