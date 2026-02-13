// Pre-Market screener + watchlist renderer (consumes report.json from CLI output)
(() => {
  const DEFAULT_JSON = `${CONFIG.API_BASE}/api/premarket/report`;
  const DEFAULT_MD = `${CONFIG.API_BASE}/api/premarket/report-md`;
  const PAGE_SIZE = 20;
  const MAX_STOCKS = 500; // cap to reduce upstream strain
  const NEWS_BATCH = 150;
  const FRESHNESS_BUCKETS = {
    breaking: { label: 'Breaking', maxMinutes: 30 },
    lt1h: { label: '<1h', maxMinutes: 60 },
    lt6h: { label: '<6h', maxMinutes: 6 * 60 },
    lt24h: { label: '<24h', maxMinutes: 24 * 60 },
    lt2d: { label: '<2d', maxMinutes: 2 * 24 * 60 },
    lt5d: { label: '<5d', maxMinutes: 5 * 24 * 60 },
    lt7d: { label: '<7d', maxMinutes: 7 * 24 * 60 },
    lt14d: { label: '<14d', maxMinutes: 14 * 24 * 60 },
    lt30d: { label: '<30d', maxMinutes: 30 * 24 * 60 }
  };

  let currentReport = null;
  let currentNews = [];
  let currentScreener = [];
  let latestNewsMap = {};
  let allNewsMap = {};
  let filteredScreener = null;
  let rawFinnhubNews = [];
  let sortState = { column: 'Change', direction: 'desc' };
  const activeCatalysts = new Set();
  let activeFreshness = null;
  const selectedForWL = new Set();

  async function loadPremarketReport(url = DEFAULT_JSON) {
    setStatus('Loading pre-market report...', 'info');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      currentReport = data;
      renderReport(data);
      setStatus('Report loaded from mock scan. You can upload your own JSON output from the CLI.', 'success');
    } catch (err) {
      console.error('Failed to load report', err);
      setStatus(`Failed to load report: ${err.message}`, 'error');
    }
  }

  function handleReportUpload(evt) {
    const file = evt.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        currentReport = data;
        renderReport(data);
        setStatus(`Loaded report from ${file.name}`, 'success');
      } catch (err) {
        console.error('Invalid JSON upload', err);
        setStatus('Invalid JSON file', 'error');
      }
    };
    reader.readAsText(file);
  }

  function renderReport(report) {
    // Deprecated: report rendering removed from UI
    return report;
  }

  // Fetch supplementary data (Rel Vol from v=141, Float from v=131) and merge by ticker
  async function fetchSupplementaryData(tickerList) {
    const supplementMap = {};
    if (!tickerList.length) return supplementMap;

    const batchSize = 100;
    for (let i = 0; i < tickerList.length; i += batchSize) {
      const slice = tickerList.slice(i, i + batchSize).join(',');
      try {
        // v=141 = Performance: has "Relative Volume", "Average Volume", "Volatility (Week)"
        // v=131 = Ownership: has "Shares Float", "Short Float"
        const [perfRes, ownRes] = await Promise.all([
          AUTH.fetchSaxo(`/api/finviz/screener?v=141&o=-change&t=${slice}`),
          AUTH.fetchSaxo(`/api/finviz/screener?v=131&o=-change&t=${slice}`)
        ]);

        if (perfRes.ok) {
          const perfData = await perfRes.json();
          (perfData || []).forEach(row => {
            if (!row.Ticker) return;
            if (!supplementMap[row.Ticker]) supplementMap[row.Ticker] = {};
            supplementMap[row.Ticker]['Relative Volume'] = row['Relative Volume'] || '';
            supplementMap[row.Ticker]['Average Volume'] = row['Average Volume'] || '';
            supplementMap[row.Ticker]['Volatility (Week)'] = row['Volatility (Week)'] || '';
          });
        }

        if (ownRes.ok) {
          const ownData = await ownRes.json();
          (ownData || []).forEach(row => {
            if (!row.Ticker) return;
            if (!supplementMap[row.Ticker]) supplementMap[row.Ticker] = {};
            supplementMap[row.Ticker]['Shares Float'] = row['Shares Float'] || '';
            supplementMap[row.Ticker]['Short Float'] = row['Short Float'] || '';
          });
        }
      } catch (e) {
        console.warn('Supplementary data fetch failed for batch', e);
      }
    }
    return supplementMap;
  }

  async function fetchLiveNews(tickers = []) {
    setStatus('Running live pre-market stock scanner...', 'info');
    try {
      // Gather screener pages (paginate) up to MAX_STOCKS
      let offset = 0;
      const rows = [];
      let errorCode = null;
      while (rows.length < MAX_STOCKS) {
        const screenerParams = new URLSearchParams({ v: '111', o: '-change', r: offset + 1, f: 'sh_avgvol_o100' });
        if (tickers.length) screenerParams.set('t', tickers.join(','));

        const screenerRes = await AUTH.fetchSaxo(`/api/finviz/screener?${screenerParams.toString()}`, { method: 'GET' });
        if (!screenerRes.ok) {
          errorCode = screenerRes.status;
          break;
        }
        const page = await screenerRes.json();
        if (!page || !page.length) break;
        rows.push(...page);
        if (page.length < PAGE_SIZE || tickers.length) break; // stop if last page or explicit tickers
        offset += PAGE_SIZE;
      }

      currentScreener = dedupeByTicker(rows).slice(0, MAX_STOCKS);
      if (!currentScreener.length && errorCode) throw new Error(`Screener HTTP ${errorCode}`);

      // Fetch supplementary data (Rel Vol, Float) and news in parallel
      const allTickers = (tickers.length ? tickers : currentScreener.map(s => s.Ticker)).filter(Boolean);

      const [supplementMap, ...newsResults] = await Promise.all([
        fetchSupplementaryData(allTickers),
        ...batchNewsRequests(allTickers)
      ]);

      // Merge supplementary data into screener rows
      currentScreener.forEach(stock => {
        const supp = supplementMap[stock.Ticker];
        if (supp) Object.assign(stock, supp);
      });

      currentNews = newsResults.flat();
      latestNewsMap = buildLatestNewsMap(currentNews);
      allNewsMap = buildAllNewsMap(currentNews);
      applyFilters();
      if (errorCode) {
        setStatus(`Partial load: ${currentScreener.length} stocks (stopped at screener HTTP ${errorCode}).`, 'error');
      } else {
        setStatus(`Loaded ${currentScreener.length} stocks with latest headlines${tickers.length ? ` for ${tickers.join(', ')}` : ''}.`, 'success');
      }
    } catch (err) {
      console.error('Live scanner fetch failed', err);
      setStatus(`Failed to run live scanner: ${err.message}`, 'error');
    }
  }

  // Return array of Promises for batched news fetches
  function batchNewsRequests(tickerList) {
    const promises = [];
    for (let i = 0; i < tickerList.length; i += NEWS_BATCH) {
      const slice = tickerList.slice(i, i + NEWS_BATCH);
      const newsParams = new URLSearchParams({ v: '3', c: '1', t: slice.join(',') });
      promises.push(
        AUTH.fetchSaxo(`/api/finviz/news-scanner?${newsParams.toString()}`, { method: 'GET' })
          .then(res => res.ok ? res.json() : [])
          .catch(() => [])
      );
    }
    return promises;
  }

  function dedupeByTicker(rows) {
    const seen = new Set();
    return (rows || []).filter(row => {
      const ticker = row.Ticker;
      if (!ticker || seen.has(ticker)) return false;
      seen.add(ticker);
      return true;
    });
  }

  function renderLiveScanner(stocks, newsMap) {
    const el = document.getElementById('premarketLiveNews');
    if (!el) return;
    if (!stocks || !stocks.length) {
      el.innerHTML = '<div class="no-data">No scanner data loaded</div>';
      updateFloatingActionBar();
      return;
    }

    const header = [
      { label: '<input type="checkbox" id="pmSelectAll" style="width:16px;height:16px;accent-color:var(--accent-blue);">', key: 'WL', sortable: false },
      { label: 'Ticker', key: 'Ticker' },
      { label: 'Price', key: 'Price' },
      { label: 'Change', key: 'Change' },
      { label: 'Volume', key: 'Volume' },
      { label: 'Rel Vol', key: 'RelVol' },
      { label: 'Float', key: 'Float' },
      { label: 'Avg Vol', key: 'AvgVol' },
      { label: 'News', key: 'News', sortable: false }
    ];

    const rows = stocks.map(stock => {
      const changeNum = parseFloat((stock.Change || '').replace('%', ''));
      const relVol = stock['Relative Volume'] || stock['Rel Volume'] || '-';
      const floatVal = stock['Shares Float'] || stock['Shs Float'] || stock.Float || '-';
      const rawAvgVol = stock['Average Volume'];
      const avgVol = rawAvgVol && rawAvgVol !== '-' ? parseFloat(String(rawAvgVol).replace(/,/g, '')) * 1000 : '-';
      const news = newsMap[stock.Ticker];
      const age = news?.ageLabel ? `<span style="color:var(--text-secondary);">(${news.ageLabel})</span>` : '';
      const latestHeadline = news
        ? `${news.icon} <a href="${news.url}" target="_blank">${escapeHtml(news.title || 'Headline')}</a> ${age}`
        : '—';

      // Expandable news badge
      const tickerNews = allNewsMap[stock.Ticker] || [];
      const expandBtn = tickerNews.length > 1
        ? ` <button class="pm-news-expand-btn" data-expand-ticker="${stock.Ticker}">${tickerNews.length} articles</button>`
        : '';

      const checked = selectedForWL.has(stock.Ticker) ? 'checked' : '';
      return {
        ticker: stock.Ticker,
        cells: [
          `<input type="checkbox" class="pm-wl-checkbox" data-symbol="${stock.Ticker}" ${checked} style="width:16px;height:16px;accent-color:var(--accent-blue);">`,
          `<strong style="color:var(--accent-blue);">${stock.Ticker}</strong>`,
          fmt(stock.Price),
          `<span style="color:${changeNum >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'};">${stock.Change || '-'}</span>`,
          formatNumber(stock.Volume),
          fmt(relVol),
          formatFloat(floatVal),
          formatNumber(avgVol),
          latestHeadline + expandBtn
        ]
      };
    });

    el.innerHTML = sortableTableWithTickers(header, rows);
    updateFloatingActionBar();
  }

  function sortableTableWithTickers(header, rows) {
    const headHtml = `<thead><tr>${header.map(h => {
      const sortable = h.sortable === false ? '' : 'data-sortable="true"';
      const active = sortState.column === h.key;
      const dir = active ? (sortState.direction === 'asc' ? '↑' : '↓') : '';
      const click = h.sortable === false ? '' : `onclick="sortScanner('${h.key}')" style="cursor:pointer;"`;
      return `<th ${sortable} ${click} style="text-align:left;padding:6px 8px;">${h.label} ${dir}</th>`;
    }).join('')}</tr></thead>`;
    const bodyHtml = `<tbody>${rows.map(r =>
      `<tr data-ticker="${r.ticker}">${r.cells.map(c => `<td style="padding:6px 8px;border-top:1px solid var(--border-color);">${c ?? '-'}</td>`).join('')}</tr>`
    ).join('')}</tbody>`;
    return `<table style="width:100%;border-collapse:collapse;">${headHtml}${bodyHtml}</table>`;
  }

  function toggleNewsExpand(ticker) {
    const table = document.querySelector('.pm-scanner-table table tbody');
    if (!table) return;
    const existing = table.querySelectorAll(`tr.pm-news-subrow[data-parent-ticker="${ticker}"]`);
    if (existing.length) {
      existing.forEach(r => r.remove());
      return;
    }
    const mainRow = table.querySelector(`tr[data-ticker="${ticker}"]`);
    if (!mainRow) return;
    const newsItems = (allNewsMap[ticker] || []).slice(0, 20);
    const colCount = mainRow.children.length;
    const fragment = document.createDocumentFragment();
    newsItems.forEach(item => {
      const tr = document.createElement('tr');
      tr.className = 'pm-news-subrow';
      tr.dataset.parentTicker = ticker;
      const age = item.ageLabel ? `<span style="color:var(--text-secondary);">(${item.ageLabel})</span>` : '';
      const src = item.source ? `<span style="color:var(--text-muted);margin-left:8px;">${escapeHtml(item.source)}</span>` : '';
      tr.innerHTML = `<td colspan="${colCount}" style="padding:4px 10px 4px 40px;background:var(--bg-secondary);font-size:0.82em;border-bottom:1px solid rgba(45,55,72,0.4);">
        ${item.icon} <a href="${item.url}" target="_blank" style="color:var(--accent-blue);">${escapeHtml(item.title || 'Headline')}</a> ${age}${src}
      </td>`;
      fragment.appendChild(tr);
    });
    mainRow.after(fragment);
  }

  function updateFloatingActionBar() {
    const checked = document.querySelectorAll('.pm-wl-checkbox:checked');
    let bar = document.getElementById('pmFloatingActionBar');
    if (checked.length === 0) {
      if (bar) bar.remove();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'pmFloatingActionBar';
      bar.className = 'pm-floating-action-bar';
      document.querySelector('.pm-scanner-table')?.parentElement?.appendChild(bar);
    }
    bar.innerHTML = `
      <span>${checked.length} selected</span>
      <button class="btn-primary" style="padding:6px 14px;font-size:0.85em;" onclick="addSelectedToWatchlist()">
        <i data-lucide="star" style="width:14px;height:14px;margin-right:4px;vertical-align:middle;"></i>
        Add to Watchlist
      </button>
      <button class="btn-secondary" style="padding:6px 14px;font-size:0.85em;" onclick="clearSelection()">Clear</button>
    `;
    if (window.lucide) lucide.createIcons();
  }

  function renderSessionInfo(info) {
    const el = document.getElementById('premarketSessionInfo');
    if (!el) return;
    el.innerHTML = [
      `Date: ${info.date}`,
      `Day of Week: ${info.dayOfWeek}`,
      `Market Open (UK Time): ${info.marketOpenUk}`,
      `Scanner Sources Used: ${(info.scannerSources || []).join(', ')}`,
      `Number of Tickers Scanned: ${info.tickersScanned}`,
      `Number Passing Initial Filter: ${info.tickersPassing}`,
      `Macro/Sector Notes: ${info.macroNotes || 'N/A'}`
    ].map(item => `<li>${item}</li>`).join('');
  }

  function renderStops(stops) {
    const el = document.getElementById('premarketStops');
    if (!el) return;
    el.innerHTML = [
      `Daily Monetary Loss Limit: ${stops.dailyLossLimit}`,
      `Maximum Losing Trades: ${stops.maxLosingTrades}`,
      `Emotional Check-In Time: ${stops.emotionalCheckTime}`,
      `Hard Close Time (UK): ${stops.hardCloseUk}`
    ].map(item => `<li>${item}</li>`).join('');
  }

  function renderTickers(tickers) {
    const el = document.getElementById('premarketTickers');
    if (!el) return;
    if (!tickers.length) {
      el.innerHTML = '<div class="no-data">No tickers loaded</div>';
      return;
    }

    const header = ['Ticker', 'Price', 'Catalyst', 'Class', 'Primary Strategy', 'PM High/Low', 'Conviction', 'Tier'];
    const rows = tickers.map(t => [
      t.ticker,
      fmt(t.pmPrice ?? t.last),
      `${t.catalyst?.type || 'none'} — ${t.catalyst?.detail || 'N/A'}`,
      t.classification || '-',
      t.primaryStrategy || '-',
      `${fmt(t.levels?.pmHigh)} / ${fmt(t.levels?.pmLow)}`,
      t.conviction || '-',
      t.tier || '-'
    ]);

    el.innerHTML = tableMarkup(header, rows);
  }

  function renderPriority(priority) {
    const el = document.getElementById('premarketPriority');
    if (!el) return;
    const parts = [];

    parts.push('<div class="pill">Tier 1: Primary Focus (max 4)</div>');
    parts.push(tableMarkup(['Rank', 'Ticker', 'Class', 'Primary Strategy', 'Conviction', 'Key Level'],
      (priority.tier1 || []).map(p => [p.rank, p.ticker, p.classification || '-', p.primaryStrategy || '-', p.conviction || '-', fmt(p.keyLevel)])) || '<div class="no-data">None</div>');

    parts.push('<div class="pill">Tier 2: Secondary Watch</div>');
    parts.push(tableMarkup(['Rank', 'Ticker', 'Class', 'If Active', 'Conviction', 'Why Secondary'],
      (priority.tier2 || []).map(p => [p.rank, p.ticker, p.classification || '-', p.primaryStrategy || '-', p.conviction || '-', p.whySecondary || '-'])) || '<div class="no-data">None</div>');

    parts.push('<div class="pill">Tier 3: Do Not Trade Today</div>');
    parts.push(tableMarkup(['Ticker', 'Reason'], (priority.tier3 || []).map(p => [p.ticker, p.reason || 'Excluded'])) || '<div class="no-data">None</div>');

    el.innerHTML = parts.join('');
  }

  function renderActionPlan(plan) {
    const el = document.getElementById('premarketActionPlan');
    if (!el) return;
    if (!plan) {
      el.innerHTML = '<div class="no-data">No action plan</div>';
      return;
    }
    const blocks = [
      ['Opening Phase (14:30–15:30 UK)', plan.openingPhase?.items],
      ['Mid-Session (15:30–18:30 UK)', plan.midSession?.items],
      ['Late Session (18:30–20:45 UK)', plan.lateSession?.items]
    ];

    el.innerHTML = blocks.map(([title, items]) => {
      const list = (items || []).map(i => `<li>${i}</li>`).join('');
      return `<div style="margin-bottom:12px;"><strong>${title}</strong><ul>${list}</ul></div>`;
    }).join('');
  }

  function exportLiveNews(format = 'csv') {
    const source = (filteredScreener && filteredScreener.length) ? filteredScreener : currentScreener;
    if (!source || !source.length) {
      setStatus('Run the live scanner before exporting.', 'error');
      return;
    }

    const rows = source.map(stock => {
      const news = latestNewsMap[stock.Ticker];
      return {
        ticker: stock.Ticker,
        price: stock.Price,
        change: stock.Change,
        volume: stock.Volume,
        relVol: stock['Relative Volume'] || stock['Rel Volume'] || '',
        float: stock['Shares Float'] || stock['Shs Float'] || stock.Float || '',
        avgVol: stock['Average Volume'] || '',
        headline: news?.title || '',
        age: news?.ageLabel || '',
        url: news?.url || ''
      };
    });

    if (format === 'text') {
      const text = rows.map(r => `${r.ticker} | ${r.price} | ${r.change} | ${r.relVol} | ${r.float} | ${r.headline} | ${r.age} | ${r.url}`).join('\n');
      downloadBlob(text, 'text/plain', 'premarket-scanner.txt');
      return;
    }

    const header = ['Ticker', 'Price', 'Change', 'Volume', 'Rel Vol', 'Float', 'Avg Vol', 'Headline', 'Age', 'Link'];
    const csvLines = [header.join(',')].concat(rows.map(r => [r.ticker, r.price, r.change, r.volume, r.relVol, r.float, r.avgVol, r.headline, r.age, r.url].map(toCsvValue).join(',')));
    downloadBlob(csvLines.join('\n'), 'text/csv', 'premarket-scanner.csv');
  }

  function fetchLiveNewsFromInput() {
    const input = document.getElementById('premarketTickerInput');
    const tickers = parseTickers(input?.value || '');
    fetchLiveNews(tickers);
  }

  function downloadReport(format) {
    if (format === 'md') {
      if (currentReport) {
        const md = buildMarkdown(currentReport);
        downloadBlob(md, 'text/markdown', 'report.md');
      } else {
        fetch(DEFAULT_MD)
          .then(r => r.text())
          .then(md => downloadBlob(md, 'text/markdown', 'report.md'))
          .catch(() => setStatus('Failed to download markdown', 'error'));
      }
      return;
    }

    // JSON download
    if (currentReport) {
      downloadBlob(JSON.stringify(currentReport, null, 2), 'application/json', 'report.json');
    } else {
      fetch(DEFAULT_JSON)
        .then(r => r.json())
        .then(data => downloadBlob(JSON.stringify(data, null, 2), 'application/json', 'report.json'))
        .catch(() => setStatus('Failed to download JSON', 'error'));
    }
  }

  function exportWatchlistCsv() {
    if (!currentReport) {
      setStatus('Load a report before exporting CSV', 'error');
      return;
    }
    const rows = [];
    const header = ['Ticker', 'Classification', 'Primary Strategy', 'Conviction', 'Key Level'];
    const tiers = [...(currentReport.priority?.tier1 || []), ...(currentReport.priority?.tier2 || [])];
    tiers.forEach(t => {
      rows.push([t.ticker, t.classification || '-', t.primaryStrategy || '-', t.conviction || '-', fmt(t.keyLevel)]);
    });
    const csv = [header.join(',')].concat(rows.map(r => r.map(csvEscape).join(','))).join('\n');
    downloadBlob(csv, 'text/csv', 'watchlist.csv');
  }

  function tableMarkup(header, rows) {
    const headHtml = `<thead><tr>${header.map(h => `<th style="text-align:left;padding:6px 8px;">${h}</th>`).join('')}</tr></thead>`;
    const bodyHtml = `<tbody>${rows.map(r => `<tr>${r.map(c => `<td style="padding:6px 8px;border-top:1px solid var(--border-color);">${c ?? '-'}</td>`).join('')}</tr>`).join('')}</tbody>`;
    return `<table style="width:100%;border-collapse:collapse;">${headHtml}${bodyHtml}</table>`;
  }

  function sortableTableMarkup(header, rows) {
    const headHtml = `<thead><tr>${header.map(h => {
      const sortable = h.sortable === false ? '' : 'data-sortable="true"';
      const active = sortState.column === h.key;
      const dir = active ? (sortState.direction === 'asc' ? '↑' : '↓') : '';
      const click = h.sortable === false ? '' : `onclick="sortScanner('${h.key}')" style="cursor:pointer;"`;
      return `<th ${sortable} ${click} style="text-align:left;padding:6px 8px;">${h.label} ${dir}</th>`;
    }).join('')}</tr></thead>`;
    const bodyHtml = `<tbody>${rows.map(r => `<tr>${r.map(c => `<td style="padding:6px 8px;border-top:1px solid var(--border-color);">${c ?? '-'}</td>`).join('')}</tr>`).join('')}</tbody>`;
    return `<table style="width:100%;border-collapse:collapse;">${headHtml}${bodyHtml}</table>`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function fmt(val) {
    if (val === undefined || val === null || Number.isNaN(val)) return '-';
    if (typeof val === 'number') return val.toFixed(2);
    return val;
  }

  function formatNumber(val) {
    if (val === undefined || val === null || val === '' || val === '-') return '-';
    const num = Number(String(val).replace(/,/g, ''));
    if (Number.isNaN(num)) return val;
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toString();
  }

  function formatFloat(val) {
    if (!val || val === '-') return '-';
    // Finviz returns float in millions (e.g. "48.34" = 48.34M shares)
    const num = parseFloat(String(val).replace(/,/g, ''));
    if (Number.isNaN(num)) return val;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}B`;
    return `${num.toFixed(1)}M`;
  }

  function csvEscape(val) {
    const safe = (val ?? '').toString().replace(/"/g, '""');
    return `"${safe}"`;
  }

  function toCsvValue(value) {
    const safe = (value ?? '').toString().replace(/"/g, '""');
    return `"${safe}"`;
  }

  function parseFinvizDate(dateString) {
    if (!dateString) return null;
    const date = new Date(`${dateString} EST`);
    if (!Number.isNaN(date.getTime())) return date;

    const parts = dateString.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (parts) {
      const utcDate = new Date(Date.UTC(
        parseInt(parts[1]), parseInt(parts[2]) - 1, parseInt(parts[3]),
        parseInt(parts[4]), parseInt(parts[5]), parseInt(parts[6])
      ));
      return new Date(utcDate.getTime() + 5 * 60 * 60 * 1000);
    }
    return null;
  }

  function formatAge(date) {
    if (!date) return '';
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  function newsBadge(date) {
    if (!date) return { icon: '🟢', ageLabel: '' };
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 30) return { icon: '🔥', ageLabel: `${minutes}m` };
    if (minutes < 60) return { icon: '🔴', ageLabel: `${minutes}m` };
    const hours = Math.floor(minutes / 60);
    if (hours < 6) return { icon: '🟠', ageLabel: `${hours}h` };
    if (hours < 24) return { icon: '🟡', ageLabel: `${hours}h` };
    const days = Math.floor(hours / 24);
    if (days < 7) return { icon: '🟢', ageLabel: `${days}d` };
    return { icon: '⚪', ageLabel: `${days}d` };
  }

  function buildLatestNewsMap(newsItems) {
    const map = {};
    (newsItems || []).forEach(item => {
      const tickers = parseTickers(item.Ticker || '');
      const parsedDate = parseFinvizDate(item.Date);
      tickers.forEach(ticker => {
        const existing = map[ticker];
        if (!parsedDate) return;
        if (!existing || parsedDate > existing.date) {
          const badge = newsBadge(parsedDate);
          map[ticker] = {
            title: item.Title,
            url: item.Url || item.URL || '#',
            date: parsedDate,
            ageLabel: badge.ageLabel,
            icon: badge.icon
          };
        }
      });
    });
    return map;
  }

  function buildAllNewsMap(newsItems) {
    const map = {};
    (newsItems || []).forEach(item => {
      const tickers = parseTickers(item.Ticker || '');
      const parsedDate = parseFinvizDate(item.Date);
      tickers.forEach(ticker => {
        if (!map[ticker]) map[ticker] = [];
        const badge = newsBadge(parsedDate);
        map[ticker].push({
          title: item.Title,
          url: item.Url || item.URL || '#',
          date: parsedDate,
          ageLabel: badge.ageLabel,
          icon: badge.icon,
          source: item.Source || 'Finviz'
        });
      });
    });
    Object.values(map).forEach(arr => arr.sort((a, b) => (b.date || 0) - (a.date || 0)));
    return map;
  }

  function applyFilters() {
    const text = document.getElementById('scannerFilterText')?.value?.toLowerCase() || '';
    const priceMin = parseFloat(document.getElementById('scannerFilterPrice')?.value || '');
    const priceMax = parseFloat(document.getElementById('scannerFilterPriceMax')?.value || '');
    const relVolMin = parseFloat(document.getElementById('scannerFilterRelVol')?.value || '');
    const changeMin = parseFloat(document.getElementById('scannerFilterGap')?.value || '');
    const volMin = parseInt(document.getElementById('scannerFilterVolume')?.value || '', 10);

    const source = currentScreener || [];
    const filtered = source.filter(stock => {
      const change = parseFloat((stock.Change || '').replace('%', ''));
      const relVol = parseFloat(stock['Relative Volume'] || stock['Rel Volume'] || '');
      const price = parseFloat(stock.Price || '');
      const vol = parseInt((stock.Volume || '').toString().replace(/,/g, ''), 10);

      if (!Number.isNaN(priceMin) && (Number.isNaN(price) || price < priceMin)) return false;
      if (!Number.isNaN(priceMax) && (Number.isNaN(price) || price > priceMax)) return false;
      if (!Number.isNaN(relVolMin) && (Number.isNaN(relVol) || relVol < relVolMin)) return false;
      if (!Number.isNaN(changeMin) && (Number.isNaN(change) || Math.abs(change) < changeMin)) return false;
      if (!Number.isNaN(volMin) && (Number.isNaN(vol) || vol < volMin)) return false;

      if (activeCatalysts.size) {
        const catalysts = detectCatalysts(latestNewsMap[stock.Ticker]?.title || '');
        if (!catalysts.some(c => activeCatalysts.has(c))) return false;
      }

      if (activeFreshness) {
        const news = latestNewsMap[stock.Ticker];
        if (!news || !news.date) return false;
        const minutes = (Date.now() - news.date.getTime()) / 60000;
        const bucket = FRESHNESS_BUCKETS[activeFreshness];
        if (!bucket || minutes > bucket.maxMinutes) return false;
      }

      if (text) {
        const headline = latestNewsMap[stock.Ticker]?.title?.toLowerCase() || '';
        if (!stock.Ticker?.toLowerCase().includes(text) && !headline.includes(text)) return false;
      }
      return true;
    });

    filteredScreener = filtered;
    applySort();
    filterNewsPanel(text);
  }

  function applySort() {
    const data = filteredScreener !== null ? filteredScreener : currentScreener || [];
    const sorted = [...data];
    const { column, direction } = sortState;
    const dir = direction === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      const getVal = (row) => {
        switch (column) {
          case 'Ticker': return row.Ticker || '';
          case 'Price': return parseFloat(row.Price) || 0;
          case 'Change': return parseFloat((row.Change || '').replace('%', '')) || 0;
          case 'Volume': return parseInt((row.Volume || '').toString().replace(/,/g, ''), 10) || 0;
          case 'RelVol': return parseFloat(row['Relative Volume'] || row['Rel Volume'] || 0) || 0;
          case 'Float': return parseFloat(String(row['Shares Float'] || row['Shs Float'] || row.Float || '').replace(/,/g, '')) || 0;
          case 'AvgVol': return (parseFloat(String(row['Average Volume'] || '').replace(/,/g, '')) || 0) * 1000;
          default: return 0;
        }
      };
      const aVal = getVal(a);
      const bVal = getVal(b);
      if (typeof aVal === 'string' || typeof bVal === 'string') {
        return dir * aVal.toString().localeCompare(bVal.toString());
      }
      return dir * (aVal - bVal);
    });

    renderLiveScanner(sorted, latestNewsMap);
  }

  function sortScanner(column) {
    if (sortState.column === column) {
      sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
      sortState.column = column;
      sortState.direction = 'desc';
    }
    applySort();
  }

  function resetScannerFilters() {
    ['scannerFilterText', 'scannerFilterPrice', 'scannerFilterPriceMax', 'scannerFilterRelVol', 'scannerFilterGap', 'scannerFilterVolume'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    activeCatalysts.clear();
    document.querySelectorAll('.catalyst-filter.active').forEach(btn => btn.classList.remove('active'));
    activeFreshness = null;
    document.querySelectorAll('.freshness-pill.active').forEach(btn => btn.classList.remove('active'));
    filteredScreener = null;
    applySort();
    filterNewsPanel('');
  }

  function togglePremarketCatalyst(key) {
    const btn = document.querySelector(`.catalyst-filter[data-catalyst="${key}"]`);
    if (activeCatalysts.has(key)) {
      activeCatalysts.delete(key);
      btn?.classList.remove('active');
    } else {
      activeCatalysts.add(key);
      btn?.classList.add('active');
    }
    applyFilters();
  }

  function selectPremarketFreshness(key) {
    document.querySelectorAll('.freshness-pill').forEach(btn => btn.classList.remove('active'));
    activeFreshness = key || null;
    if (key) {
      const btn = document.querySelector(`.freshness-pill[data-freshness="${key}"]`);
      btn?.classList.add('active');
    }
    applyFilters();
  }

  function detectCatalysts(title) {
    const titleLower = (title || '').toLowerCase();
    const keywords = {
      earnings: ['earnings', 'q1', 'q2', 'q3', 'q4', 'quarterly', 'revenue', 'eps'],
      fda: ['fda', 'approval', 'clinical trial', 'phase', 'drug'],
      product: ['launches', 'unveils', 'introduces', 'new product', 'release'],
      merger: ['merger', 'acquisition', 'acquires', 'buys', 'takes over', 'm&a'],
      contract: ['wins contract', 'awarded', 'deal', 'partnership', 'agreement'],
      upgrade: ['upgrade', 'rating', 'initiated', 'target', 'buy', 'sell', 'downgrade'],
      offering: ['offering', 'ipo', 'secondary', 'raises', 'funding'],
      guidance: ['guidance', 'outlook', 'forecast', 'expects']
    };

    const detected = [];
    Object.entries(keywords).forEach(([key, words]) => {
      if (words.some(w => titleLower.includes(w))) detected.push(key);
    });
    return detected.length ? detected : ['general'];
  }

  function parseTickers(tickerString) {
    return (tickerString || '').split(/[,\s]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
  }

  function downloadBlob(content, mime, filename) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function buildMarkdown(report) {
    const lines = [];
    const s = report.sessionInfo;
    lines.push('# Daily Scanner Analysis — Pre-Market Watchlist');
    lines.push('');
    lines.push('## SESSION INFO');
    lines.push(`- Date: ${s.date}`);
    lines.push(`- Day of Week: ${s.dayOfWeek}`);
    lines.push(`- Market Open (UK Time): ${s.marketOpenUk}`);
    lines.push(`- Scanner Sources Used: ${(s.scannerSources || []).join(', ')}`);
    lines.push(`- Number of Tickers Scanned: ${s.tickersScanned}`);
    lines.push(`- Number Passing Initial Filter: ${s.tickersPassing}`);
    lines.push(`- Macro/Sector Notes: ${s.macroNotes || 'N/A'}`);
    lines.push('');

    (report.tickers || []).forEach(t => {
      lines.push('---');
      lines.push(`**Ticker:** ${t.ticker}`);
      lines.push(`Price: ${t.pmPrice ?? t.last ?? 'N/A'}`);
      lines.push(`Catalyst Type: ${t.catalyst?.type || 'none'}`);
      lines.push(`Catalyst Detail: ${t.catalyst?.detail || 'N/A'}`);
      lines.push(`Earnings Timing: ${t.catalyst?.earningsTiming || 'N/A'}`);
      lines.push(`Float / Avg Volume: ${(t.float ?? 'N/A')} / ${(t.avgVolume ?? 'N/A')}`);
      lines.push(`Relative Volume (PM): ${t.relVolume ?? 'N/A'}`);
      lines.push('KEY LEVELS:');
      lines.push(`  Previous Day High: ${fmt(t.levels?.prevHigh)}`);
      lines.push(`  Previous Day Low: ${fmt(t.levels?.prevLow)}`);
      lines.push(`  Previous Day Close: ${fmt(t.levels?.prevClose)}`);
      lines.push(`  Pre-Market High: ${fmt(t.levels?.pmHigh)}`);
      lines.push(`  Pre-Market Low: ${fmt(t.levels?.pmLow)}`);
      lines.push(`  52-Week High / Low: ${fmt(t.levels?.week52High)} / ${fmt(t.levels?.week52Low)}`);
      lines.push(`  HTF Resistance: ${fmt(t.levels?.htfResistance)}`);
      lines.push(`  HTF Support: ${fmt(t.levels?.htfSupport)}`);
      lines.push('CLASSIFICATION:');
      lines.push(`  Classification: ${t.classification || 'N/A'}`);
      lines.push(`  Classification Reasoning: ${t.classificationReason || 'N/A'}`);
      lines.push(`  Permitted Strategies: ${(t.permittedStrategies || []).join(', ')}`);
      lines.push(`  Primary Strategy: ${t.primaryStrategy || 'N/A'}`);
      lines.push(`  Secondary Strategy: ${t.secondaryStrategy || 'N/A'}`);
      lines.push(`  Conditional Note: ${t.conditionalNote || 'N/A'}`);
      lines.push('RISK ASSESSMENT:');
      lines.push(`  Primary Risk: ${t.primaryRisk || 'N/A'}`);
      lines.push(`  Invalidation: ${t.invalidation || 'N/A'}`);
      lines.push(`  Conviction: ${t.conviction || 'N/A'}`);
      lines.push('');
    });

    lines.push('## PRIORITY RANKING');
    lines.push('Tier 1: Primary Focus (MAX 4 tickers)');
    (report.priority?.tier1 || []).forEach(p => {
      lines.push(`- Rank ${p.rank}: ${p.ticker} | Class ${p.classification || '-'} | ${p.primaryStrategy || '-'} | Conviction ${p.conviction || '-'} | Key Level: ${fmt(p.keyLevel)}`);
    });
    if (!report.priority?.tier1?.length) lines.push('- None');

    lines.push('Tier 2: Secondary Watch');
    (report.priority?.tier2 || []).forEach(p => {
      lines.push(`- Rank ${p.rank}: ${p.ticker} | Class ${p.classification || '-'} | If Active: ${p.primaryStrategy || '-'} | Conviction ${p.conviction || '-'} | Why Secondary: ${p.whySecondary || 'N/A'}`);
    });
    if (!report.priority?.tier2?.length) lines.push('- None');

    lines.push('Tier 3: Do Not Trade Today');
    (report.priority?.tier3 || []).forEach(p => {
      lines.push(`- ${p.ticker}: ${p.reason || 'Excluded'}`);
    });
    if (!report.priority?.tier3?.length) lines.push('- None');

    lines.push('');
    lines.push('## SESSION ACTION PLAN');
    lines.push('Opening Phase (14:30–15:30 UK)');
    (report.actionPlan?.openingPhase?.items || []).forEach(i => lines.push(`- ${i}`));
    lines.push('Mid-Session (15:30–18:30 UK)');
    (report.actionPlan?.midSession?.items || []).forEach(i => lines.push(`- ${i}`));
    lines.push('Late Session (18:30–20:45 UK)');
    (report.actionPlan?.lateSession?.items || []).forEach(i => lines.push(`- ${i}`));

    lines.push('');
    lines.push('## STOP CONDITIONS');
    lines.push(`- Daily Monetary Loss Limit: ${report.stopConditions?.dailyLossLimit ?? 'N/A'}`);
    lines.push(`- Maximum Losing Trades: ${report.stopConditions?.maxLosingTrades ?? 'N/A'}`);
    lines.push(`- Emotional Check-In Time: ${report.stopConditions?.emotionalCheckTime ?? 'N/A'}`);
    lines.push(`- Hard Close Time (UK): ${report.stopConditions?.hardCloseUk ?? 'N/A'}`);

    return lines.join('\n');
  }

  function setStatus(message, type = 'info') {
    const el = document.getElementById('premarketStatus');
    if (!el) return;
    const colors = {
      info: 'var(--text-secondary)',
      success: 'var(--accent-green)',
      error: 'var(--accent-red)'
    };
    el.style.color = colors[type] || 'var(--text-secondary)';
    el.textContent = message;
  }

  // --- Stat Cards: real data ---

  async function updateStatCards() {
    // SPY Price from Yahoo Finance
    try {
      const res = await fetch(`${CONFIG.API_BASE}/api/yahoo/quote?t=SPY`);
      if (res.ok) {
        const data = await res.json();
        const priceEl = document.getElementById('spyPrice');
        const changeEl = document.getElementById('spyChange');
        if (priceEl) priceEl.textContent = `$${data.price.toFixed(2)}`;
        if (changeEl) {
          const pct = data.changePercent;
          changeEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
          changeEl.style.color = pct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        }
      }
    } catch (e) {
      console.warn('SPY quote fetch failed', e);
    }
    updateTopGainerFromScreener();
  }

  function updateTopGainerFromScreener() {
    const gainerEl = document.getElementById('topGainer');
    const subEl = document.getElementById('topGainerSub');
    if (!gainerEl) return;
    if (currentScreener && currentScreener.length) {
      const top = currentScreener[0];
      gainerEl.textContent = `${top.Ticker} ${top.Change || ''}`;
      gainerEl.style.color = '#fff';
      if (subEl) subEl.textContent = top.Company || top.Sector || 'Pre-market mover';
    }
  }

  // --- Time to Open ---

  function updateTimeToOpenDisplay() {
    const el = document.getElementById('timeToOpen');
    if (!el) return;
    if (window.marketStatus && typeof window.marketStatus.getTimeToOpen === 'function') {
      const time = window.marketStatus.getTimeToOpen();
      el.textContent = `${time.hours}h ${time.minutes}m`;
    } else {
      // Fallback if marketStatus not loaded
      const now = new Date();
      const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const open = new Date(ny);
      open.setHours(9, 30, 0, 0);
      if (ny > open) open.setDate(open.getDate() + 1);
      while (open.getDay() === 0 || open.getDay() === 6) open.setDate(open.getDate() + 1);
      const diff = open - ny;
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      el.textContent = `${h}h ${m}m`;
    }
  }

  // --- Breaking News ---

  async function loadNews() {
    const content = document.getElementById('newsContent');
    if (!content) return;
    try {
      const res = await fetch(`${CONFIG.API_BASE}/api/news`);
      const news = await res.json();
      rawFinnhubNews = news || [];
      if (!rawFinnhubNews.length) {
        content.innerHTML = '<div style="color:var(--text-muted);padding:16px;">No news available</div>';
        return;
      }
      renderNewsPanel(rawFinnhubNews);
    } catch (err) {
      console.error('Error loading news:', err);
      content.innerHTML = '<div style="color:var(--text-muted);padding:16px;">Unable to load news.</div>';
    }
  }

  function renderNewsPanel(newsItems) {
    const content = document.getElementById('newsContent');
    if (!content) return;
    if (!newsItems.length) {
      content.innerHTML = '<div style="color:var(--text-muted);padding:16px;">No matching news</div>';
      return;
    }
    content.innerHTML = newsItems.slice(0, 20).map(renderNewsItem).join('');
  }

  function filterNewsPanel(searchText) {
    if (!searchText) {
      renderNewsPanel(rawFinnhubNews);
      return;
    }
    const lower = searchText.toLowerCase();
    const filtered = rawFinnhubNews.filter(item => {
      const headline = (item.headline || '').toLowerCase();
      const symbol = (item.symbol || item.related || '').toLowerCase();
      const source = (item.source || '').toLowerCase();
      return headline.includes(lower) || symbol.includes(lower) || source.includes(lower);
    });
    renderNewsPanel(filtered);
  }

  function renderNewsItem(item) {
    const date = new Date(item.datetime * 1000);
    const timeAgo = getTimeAgo(date);
    const symbol = (item.symbol || item.related || '').split(',')[0].trim().toUpperCase();
    const safeSymbol = symbol || 'MKT';
    const checked = symbol && window.WATCHLIST && WATCHLIST.has(symbol) ? 'checked' : '';
    const disabled = symbol ? '' : 'disabled';
    return `
      <div class="pm-news-item" onclick="window.open('${escapeHtml(item.url)}', '_blank')">
        <div class="pm-news-title">${escapeHtml(item.headline)}</div>
        <div class="pm-news-meta">
          <span class="pm-news-symbol">${safeSymbol}</span>
          <span class="pm-news-divider">&middot;</span>
          <span>${escapeHtml(item.source)}</span>
          <span class="pm-news-divider">&middot;</span>
          <span>${timeAgo}</span>
          <label class="pm-news-wl" onclick="event.stopPropagation();">
            <input type="checkbox" data-symbol="${symbol}" ${checked} ${disabled}
                   onchange="window._pmToggleWL(event)" onclick="event.stopPropagation();">
            <span>WL</span>
          </label>
        </div>
      </div>`;
  }

  function getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    const intervals = { year: 31536000, month: 2592000, week: 604800, day: 86400, hour: 3600, minute: 60 };
    for (const [name, secs] of Object.entries(intervals)) {
      const n = Math.floor(seconds / secs);
      if (n >= 1) return n === 1 ? `1 ${name} ago` : `${n} ${name}s ago`;
    }
    return 'Just now';
  }

  window._pmToggleWL = function(event) {
    event.stopPropagation();
    const cb = event.target;
    const sym = (cb.dataset.symbol || '').toUpperCase();
    if (!sym || !window.WATCHLIST) return;
    if (cb.checked) { WATCHLIST.add(sym, 'news'); } else { WATCHLIST.remove(sym); }
  };

  // --- TradingView Widgets ---

  function initSPYChart(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'tradingview-widget-container';
    wrapper.style.cssText = 'height:100%;width:100%;';
    wrapper.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.textContent = JSON.stringify({
      autosize: false, width: '100%', height: '450', symbol: 'AMEX:SPY',
      interval: '15', timezone: 'America/New_York', theme: 'dark', style: '1',
      locale: 'en', backgroundColor: 'rgba(26, 31, 46, 0)',
      gridColor: 'rgba(42, 46, 57, 0.06)',
      hide_top_toolbar: false, hide_legend: false, save_image: false
    });
    wrapper.appendChild(script);
    el.appendChild(wrapper);
  }

  function initHeatmap(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'tradingview-widget-container';
    wrapper.style.cssText = 'height:100%;width:100%;';
    wrapper.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js';
    script.async = true;
    script.textContent = JSON.stringify({
      exchanges: [], dataSource: 'SPX500', grouping: 'sector',
      blockSize: 'market_cap_basic', blockColor: 'change', locale: 'en',
      colorTheme: 'dark', hasTopBar: false, isDataSetEnabled: false,
      isZoomEnabled: true, hasSymbolTooltip: true, width: '100%', height: '100%'
    });
    wrapper.appendChild(script);
    el.appendChild(wrapper);
  }

  // --- Ticker Autocomplete with company names ---

  function initTickerAutocomplete() {
    const input = document.getElementById('premarketTickerInput');
    if (!input) return;

    const dropdown = document.createElement('div');
    dropdown.className = 'ticker-autocomplete-dropdown';
    dropdown.style.cssText = `
      position: absolute; top: calc(100% + 4px); left: 0; width: 100%;
      background: var(--bg-card); border: 1px solid var(--border-color);
      border-radius: 8px; max-height: 300px; overflow-y: auto;
      display: none; z-index: 1000; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    `;
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(dropdown);

    let debounceTimer = null;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const raw = input.value;
      const parts = raw.split(',');
      const current = parts[parts.length - 1].trim();

      if (current.length < 2) {
        dropdown.style.display = 'none';
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(`${CONFIG.API_BASE}/api/yahoo/search?q=${encodeURIComponent(current)}`);
          const results = await res.json();
          if (!results.length) { dropdown.style.display = 'none'; return; }

          dropdown.innerHTML = results.map(r => `
            <div class="autocomplete-item" data-symbol="${escapeHtml(r.symbol)}"
                 style="padding: 10px 14px; cursor: pointer; border-bottom: 1px solid var(--border-color);
                        display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="color: var(--accent-blue);">${escapeHtml(r.symbol)}</strong>
                <span style="color: var(--text-secondary); margin-left: 8px; font-size: 0.85em;">${escapeHtml(r.name)}</span>
              </div>
              <span style="color: var(--text-muted); font-size: 0.75em;">${escapeHtml(r.exchange)}</span>
            </div>
          `).join('');
          dropdown.style.display = 'block';

          dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-secondary)');
            item.addEventListener('mouseleave', () => item.style.background = '');
            item.addEventListener('click', () => {
              parts[parts.length - 1] = ' ' + item.dataset.symbol;
              input.value = parts.join(',').replace(/^[\s,]+/, '');
              dropdown.style.display = 'none';
              input.focus();
            });
          });
        } catch (e) {
          console.warn('Autocomplete fetch failed', e);
        }
      }, 250);
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') dropdown.style.display = 'none';
    });
  }

  // --- Event Delegation for filters ---

  document.addEventListener('click', (e) => {
    const catBtn = e.target.closest('.catalyst-filter[data-catalyst]');
    if (catBtn) {
      togglePremarketCatalyst(catBtn.dataset.catalyst);
      return;
    }
    const freshBtn = e.target.closest('.freshness-pill[data-freshness]');
    if (freshBtn) {
      selectPremarketFreshness(freshBtn.dataset.freshness || null);
      return;
    }
    const expandBtn = e.target.closest('.pm-news-expand-btn');
    if (expandBtn) {
      toggleNewsExpand(expandBtn.dataset.expandTicker);
      return;
    }
  });

  // Checkbox event delegation for watchlist selection
  document.addEventListener('change', (e) => {
    if (e.target.id === 'pmSelectAll') {
      const checked = e.target.checked;
      document.querySelectorAll('.pm-wl-checkbox').forEach(cb => {
        cb.checked = checked;
        if (checked) selectedForWL.add(cb.dataset.symbol);
        else selectedForWL.delete(cb.dataset.symbol);
      });
      updateFloatingActionBar();
      return;
    }
    if (e.target.classList.contains('pm-wl-checkbox')) {
      const sym = e.target.dataset.symbol;
      if (e.target.checked) selectedForWL.add(sym);
      else selectedForWL.delete(sym);
      updateFloatingActionBar();
      return;
    }
  });

  // Expose to global for inline handlers
  window.loadPremarketReport = loadPremarketReport;
  window.handleReportUpload = handleReportUpload;
  window.downloadReport = downloadReport;
  window.exportWatchlistCsv = exportWatchlistCsv;
  window.fetchLiveNewsFromInput = fetchLiveNewsFromInput;
  window.exportLiveNews = exportLiveNews;
  window.sortScanner = sortScanner;
  window.resetScannerFilters = resetScannerFilters;
  window.togglePremarketCatalyst = togglePremarketCatalyst;
  window.selectPremarketFreshness = selectPremarketFreshness;
  window.loadNews = loadNews;
  window.updateStatCards = updateStatCards;

  window.addSelectedToWatchlist = function() {
    document.querySelectorAll('.pm-wl-checkbox:checked').forEach(cb => {
      const sym = cb.dataset.symbol;
      if (sym && window.WATCHLIST) WATCHLIST.add(sym, 'premarket');
    });
    selectedForWL.clear();
    const selectAll = document.getElementById('pmSelectAll');
    if (selectAll) selectAll.checked = false;
    applySort();
  };

  window.clearSelection = function() {
    document.querySelectorAll('.pm-wl-checkbox').forEach(cb => { cb.checked = false; });
    selectedForWL.clear();
    const selectAll = document.getElementById('pmSelectAll');
    if (selectAll) selectAll.checked = false;
    updateFloatingActionBar();
  };

  document.addEventListener('DOMContentLoaded', () => {
    // Real stat cards
    updateStatCards();
    setInterval(updateStatCards, 5 * 60 * 1000);

    // Time to open
    updateTimeToOpenDisplay();
    setInterval(updateTimeToOpenDisplay, 60000);

    // Breaking news
    loadNews();

    // Auto-run scanner (updates top gainer on completion)
    fetchLiveNews().then(() => updateTopGainerFromScreener());

    // TradingView widgets
    initSPYChart('spyChartWidget');
    initHeatmap('heatmapWidget');

    // Ticker autocomplete with company names
    initTickerAutocomplete();

    // Checklist persistence
    document.querySelectorAll('.pm-checklist input[type="checkbox"]').forEach(cb => {
      const saved = localStorage.getItem(cb.id);
      if (saved === 'true') cb.checked = true;
      cb.addEventListener('change', () => localStorage.setItem(cb.id, cb.checked));
    });

    // Filter inputs — live filtering
    ['scannerFilterText'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => applyFilters());
    });
    // Dropdown selects — use change event
    ['scannerFilterPrice', 'scannerFilterPriceMax', 'scannerFilterRelVol', 'scannerFilterGap', 'scannerFilterVolume'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => applyFilters());
    });

    // MarketStatus init
    if (window.marketStatus) {
      marketStatus.init('marketStatus');
    }

    // Lucide icons
    if (window.lucide) lucide.createIcons();
  });
})();
