// Broker monitoring widgets (read-only)

const BrokerUI = (() => {
  let positionsCache = [];
  let virtualization = { rowHeight: 44, buffer: 20 };

  function authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = AUTH.getToken && AUTH.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (window.API_KEY) headers['x-api-key'] = window.API_KEY;
    return headers;
  }

  async function getJson(path) {
    const res = await fetch(path, { headers: authHeaders() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
    return res.json();
  }

  async function postJson(path, body = {}) {
    const res = await fetch(path, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
    return res.json();
  }

  function show(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.style.display = '';
  }

  function hide(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.style.display = 'none';
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function formatCurrency(num) {
    if (num == null || Number.isNaN(num)) return '-';
    return `$${Number(num).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  function formatPercent(num) {
    if (num == null || Number.isNaN(num)) return '-';
    return `${Number(num).toFixed(2)}%`;
  }

  function renderConnect(status) {
    if (!status.connected) {
      hide('brokerWidgets');
      show('brokerConnectPanel');
      return;
    }
    hide('brokerConnectPanel');
    show('brokerWidgets');
  }

  async function connectSelected() {
    const broker = (document.getElementById('brokerSelect')?.value || 'ibkr').toLowerCase();
    const accessToken = document.getElementById('brokerAccessToken')?.value || null;
    const refreshToken = document.getElementById('brokerRefreshToken')?.value || null;
    await postJson(`/api/broker/connect/${broker}`, { accessToken, refreshToken });
    await load();
  }

  async function disconnect() {
    await postJson('/api/broker/disconnect');
    await load();
  }

  function renderAccount(snapshot, pnl) {
    setText('accountBalance', formatCurrency(snapshot?.netLiquidation));
    setText('accountBuyingPower', formatCurrency(snapshot?.buyingPower));
    setText('accountCash', formatCurrency(snapshot?.cash));
    setText('accountMarginUsed', formatPercent(snapshot?.marginUsedPercent));
    setText('accountUnrealized', formatCurrency(snapshot?.unrealizedPnL));
    setText('accountRealized', formatCurrency(snapshot?.realizedPnL));
    setText('accountDailyPnL', pnl ? formatCurrency(pnl.net ?? pnl.gross) : '-');
  }

  function computeExposure(positions = []) {
    let long = 0; let short = 0;
    positions.forEach(p => {
      const mv = Number(p.marketValue) || 0;
      if (mv >= 0) long += mv; else short += Math.abs(mv);
    });
    const net = long - short;
    const total = long + short || 1;
    return {
      longPct: +(long / total * 100).toFixed(2),
      shortPct: +(short / total * 100).toFixed(2),
      netPct: +(net / total * 100).toFixed(2)
    };
  }

  function renderExposure(positions) {
    const exp = computeExposure(positions);
    setText('exposureLong', `${exp.longPct}%`);
    setText('exposureShort', `${exp.shortPct}%`);
    setText('exposureNet', `${exp.netPct}%`);
  }

  function renderPositions(positions = []) {
    positionsCache = positions;
    setText('openPositions', positions.length);
    const container = document.getElementById('positionsVirtualContainer');
    const filler = document.getElementById('positionsVirtualFiller');
    const viewport = document.getElementById('positionsViewport');
    if (!container || !filler || !viewport) return;

    if (!positions.length) {
      filler.style.height = '0px';
      container.innerHTML = '<div class="empty-state">No open positions</div>';
      return;
    }

    filler.style.height = `${positions.length * virtualization.rowHeight}px`;

    function draw() {
      const startIndex = Math.max(0, Math.floor(viewport.scrollTop / virtualization.rowHeight) - virtualization.buffer);
      const endIndex = Math.min(positions.length, startIndex + virtualization.buffer * 2 + Math.ceil(viewport.clientHeight / virtualization.rowHeight));
      const visible = positions.slice(startIndex, endIndex);
      container.style.transform = `translateY(${startIndex * virtualization.rowHeight}px)`;
      container.innerHTML = visible.map(p => `
        <div class="position-row">
          <div class="col symbol">${p.symbol}</div>
          <div class="col side ${p.side}">${p.side}</div>
          <div class="col qty">${p.quantity}</div>
          <div class="col price">${formatCurrency(p.currentPrice)}</div>
          <div class="col mv">${formatCurrency(p.marketValue)}</div>
          <div class="col unreal">${formatCurrency(p.unrealizedDollar)} (${formatPercent(p.unrealizedPercent)})</div>
          <div class="col weight">${formatPercent(p.accountWeightPercent)}</div>
          <div class="col day">${formatCurrency(p.dayChangeDollar)}</div>
        </div>
      `).join('');
    }

    viewport.onscroll = draw;
    draw();
  }

  function renderWeeklyChart(points = []) {
    const el = document.getElementById('weeklyChart');
    if (!el) return;
    if (!points.length) {
      el.innerHTML = '<div class="empty-state">No data</div>';
      return;
    }
    const max = Math.max(...points.map(p => p.equity));
    const min = Math.min(...points.map(p => p.equity));
    const range = max - min || 1;
    const bars = points.map(p => {
      const height = ((p.equity - min) / range) * 80 + 10;
      return `<div class="bar" title="${p.date}: ${formatCurrency(p.equity)}" style="height:${height}px"></div>`;
    }).join('');
    el.innerHTML = `<div class="mini-chart">${bars}</div>`;
  }

  async function loadWidgets() {
    const [snapshot, positions, pnl, weekly] = await Promise.all([
      getJson('/api/broker/account'),
      getJson('/api/broker/positions'),
      getJson('/api/broker/pnl/daily'),
      getJson('/api/broker/performance/weekly')
    ]);

    renderAccount(snapshot, pnl);
    renderPositions(positions || []);
    renderExposure(positions || []);
    renderWeeklyChart(weekly || []);
  }

  async function load() {
    try {
      await AUTH.protect();
      const status = await getJson('/api/broker/status');
      renderConnect(status);
      if (status.connected) {
        await loadWidgets();
      }
    } catch (err) {
      console.error('Broker widgets error', err);
      show('brokerConnectPanel');
      hide('brokerWidgets');
    }
  }

  return {
    load,
    connectSelected,
    disconnect
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('brokerSection')) {
    BrokerUI.load();
    const connectBtn = document.getElementById('brokerConnectBtn');
    const disconnectBtn = document.getElementById('brokerDisconnectBtn');
    if (connectBtn) connectBtn.addEventListener('click', BrokerUI.connectSelected);
    if (disconnectBtn) disconnectBtn.addEventListener('click', BrokerUI.disconnect);
  }
});
