function mapMarket(row) {
  return {
    symbol: row?.symbol,
    price: Number(row?.price) || 0,
    change_percent: Number(row?.change_percent) || 0,
    volume: Number(row?.volume) || 0,
    relative_volume: Number(row?.relative_volume) || 1,
    atr: row?.atr ?? null,
    rsi: row?.rsi ?? null,
  };
}

module.exports = {
  mapMarket,
};
