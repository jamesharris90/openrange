// Open Market board: 4 charts + fundamentals + news for selected tickers
(function() {
    const defaultTickers = ['SMCI', 'PAVM', 'RKT', 'SPY'];
    let tickers = [...defaultTickers];
    let interval = '5';
    const chartRefs = {};
    let newsCache = [];
    let seenNewsKeys = new Set();
    let newsSortDescending = true;
    let fundData = [];
    let fundSort = { col: 'Ticker', dir: 'asc' };
    let tickerStats = {};
    let watchlistEl;

    function parseTickers(raw) {
        return (raw || '')
            .split(/[\s,]+/)
            .map(t => t.trim().toUpperCase())
            .filter(Boolean)
            .slice(0, 4);
    }

    function saveTickers() {
        localStorage.setItem('openMarketTickers', JSON.stringify(tickers));
    }

    function loadTickers() {
        try {
            const saved = JSON.parse(localStorage.getItem('openMarketTickers') || '[]');
            if (Array.isArray(saved) && saved.length) {
                tickers = saved.slice(0, 4);
            }
        } catch (_) {
            tickers = [...defaultTickers];
        }
    }

    function renderBadges() {
        const wrap = document.getElementById('om-ticker-badges');
        const inputs = ['om-t1', 'om-t2', 'om-t3', 'om-t4'];
        inputs.forEach((id, idx) => {
            const el = document.getElementById(id);
            if (el) el.value = tickers[idx] || '';
        });
        if (!wrap) return;
        if (!tickers.length) {
            wrap.innerHTML = '<span class="helper-text">No tickers selected</span>';
            return;
        }
        wrap.innerHTML = tickers.map(t => `<span class="ticker-badge">${t}</span>`).join('');
    }

    function renderWatchlistTray() {
        watchlistEl = document.getElementById('om-watchlist');
        if (!watchlistEl) return;
        const list = (window.WATCHLIST && typeof WATCHLIST.getList === 'function') ? WATCHLIST.getList() : [];
        if (!list || !list.length) {
            watchlistEl.innerHTML = '<div class="helper-text">No symbols yet. Add from Screeners, Advanced Screener, or News Scanner.</div>';
            return;
        }
        watchlistEl.innerHTML = list.map(item => {
            const src = item.source ? `<span class="watchlist-pill__source">${item.source}</span>` : '';
            return `<div class="watchlist-pill" draggable="true" data-symbol="${item.symbol}" title="Drag to a chart slot">${item.symbol}${src}</div>`;
        }).join('');

        watchlistEl.querySelectorAll('[draggable="true"]').forEach(el => {
            el.addEventListener('dragstart', (e) => {
                const sym = el.getAttribute('data-symbol') || '';
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/plain', sym);
            });
            el.addEventListener('click', () => fillNextInput(el.getAttribute('data-symbol')));
        });
    }

    function fillNextInput(symbol) {
        if (!symbol) return;
        const ids = ['om-t1', 'om-t2', 'om-t3', 'om-t4'];
        const empty = ids.map(id => document.getElementById(id)).find(el => el && !el.value.trim());
        const target = empty || document.getElementById('om-t1');
        if (!target) return;
        target.value = symbol;
        applyTickers();
    }

    function bindDropTargets() {
        const ids = ['om-t1', 'om-t2', 'om-t3', 'om-t4'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.add('drop-target');
            el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-active'); });
            el.addEventListener('dragleave', () => el.classList.remove('drop-active'));
            el.addEventListener('drop', (e) => {
                e.preventDefault();
                el.classList.remove('drop-active');
                const sym = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || '';
                if (!sym) return;
                el.value = sym;
                applyTickers();
            });
        });
    }

    function buildChart(containerId, symbol) {
        const target = document.getElementById(containerId);
        if (!target || typeof TradingView === 'undefined') return;
        target.innerHTML = '';
        chartRefs[containerId] = new TradingView.widget({
            width: '100%',
            height: '360',
            symbol,
            interval,
            timezone: 'America/New_York',
            theme: 'dark',
            style: '1',
            locale: 'en',
            toolbar_bg: '#0a0e1a',
            enable_publishing: false,
            hide_side_toolbar: false,
            allow_symbol_change: false,
            container_id: containerId,
            studies: ['STD;VWAP', 'STD;Volume'],
            backgroundColor: 'rgba(26, 31, 46, 0)'
        });
    }

    function renderCharts() {
        const grid = document.getElementById('om-charts');
        if (!grid) return;
        grid.innerHTML = '';
        if (!tickers.length) {
            grid.innerHTML = '<div class="helper-text">Add up to four tickers to render charts.</div>';
            return;
        }
        tickers.forEach((sym, idx) => {
            const containerId = `om-chart-${idx}`;
            const card = document.createElement('div');
            card.className = 'card chart-card';
            card.innerHTML = `
                <div class="card-header">
                    <div class="card-title">${sym} Chart</div>
                    <div class="card-actions" style="gap: 6px;">
                        <button class="btn-secondary" onclick="openMarket.setInterval('${containerId}', '${sym}', '5')">5M</button>
                        <button class="btn-secondary" onclick="openMarket.setInterval('${containerId}', '${sym}', '15')">15M</button>
                        <button class="btn-secondary" onclick="openMarket.setInterval('${containerId}', '${sym}', '60')">1H</button>
                    </div>
                </div>
                <div class="card-body">
                    <div id="${containerId}" class="chart-frame"></div>
                </div>
            `;
            grid.appendChild(card);
            setTimeout(() => buildChart(containerId, sym), 80 * idx);
        });
    }

    async function refreshFundamentals() {
        const wrap = document.getElementById('om-fundamentals');
        if (!wrap) return;
        if (!tickers.length) {
            wrap.innerHTML = '<div class="helper-text">Add tickers to see fundamentals.</div>';
            return;
        }
        wrap.innerHTML = '<div class="helper-text">Loading fundamentals...</div>';

        const fetcher = (window.AUTH && AUTH.fetchSaxo) ? AUTH.fetchSaxo : fetch;

        try {
            // Use richer view for fundamentals to reduce missing fields
            const url = `/api/finviz/screener?t=${encodeURIComponent(tickers.join(','))}&v=152`;
            const res = await fetcher(url, { method: 'GET' });
            if (!res.ok) {
                let detail = '';
                try {
                    const body = await res.json();
                    detail = body?.error || body?.detail || res.statusText;
                } catch (_) {
                    detail = res.statusText;
                }
                throw new Error(detail || 'Fundamentals fetch failed');
            }

            fundData = await res.json();
            if (!fundData || !fundData.length) {
                wrap.innerHTML = '<div class="helper-text">No fundamentals found.</div>';
                return;
            }

            tickerStats = {};
            fundData.forEach(row => {
                const sym = (row.Ticker || row.Symbol || '').toUpperCase();
                if (!sym) return;
                const changeVal = parseFloat(String(row.Change || row['Change'] || '0').replace('%', ''));
                tickerStats[sym] = { change: isNaN(changeVal) ? null : changeVal };
            });

            renderFundTable();
        } catch (err) {
            console.warn('Fundamentals primary fetch failed, attempting fallback', err);
            try {
                await loadFallbackFundamentals(wrap, fetcher);
            } catch (fallbackErr) {
                wrap.innerHTML = `<div class="helper-text">Fundamentals fetch failed: ${err.message || 'unknown error'}</div>`;
            }
        }
    }

    async function loadFallbackFundamentals(wrap, fetcher) {
        const rows = [];
        for (const sym of tickers) {
            try {
                const res = await fetcher(`/api/finviz/quote?t=${encodeURIComponent(sym)}`, { method: 'GET' });
                if (!res.ok) continue;
                const data = await res.json();
                const snap = data.snapshot || {};
                const changeStr = data.change || snap.Change || '';
                const changeVal = parseFloat(String(changeStr).replace('%', ''));
                tickerStats[data.ticker || sym] = { change: isNaN(changeVal) ? null : changeVal };
                rows.push({
                    Ticker: data.ticker || sym,
                    Price: data.price || snap.Price || '--',
                    Change: changeStr || '--',
                    'Change from Open': snap['Change from Open'] || snap.Gap || '--',
                    'Rel Volume': snap['Rel Volume'] || '--',
                    Volume: snap.Volume || snap['Avg Volume'] || '--',
                    Float: snap['Shs Float'] || snap.Float || '--',
                    'Market Cap': snap['Market Cap'] || '--'
                });
            } catch (_) {
                // Ignore individual ticker errors in fallback
            }
        }

        if (!rows.length) {
            throw new Error('Fallback fundamentals unavailable');
        }

        fundData = rows;
        wrap.innerHTML = '<div class="helper-text">Using quote fallback (Finviz export unavailable).</div>';
        renderFundTable();
    }

    function renderFundTable() {
        const wrap = document.getElementById('om-fundamentals');
        if (!wrap) return;
        if (!fundData || !fundData.length) {
            wrap.innerHTML = '<div class="helper-text">No fundamentals found.</div>';
            return;
        }

        const columns = [
            { key: 'Ticker', label: 'Ticker' },
            { key: 'Price', label: 'Price', numeric: true },
            { key: 'Change', label: 'Change %', numeric: true },
            { key: 'Change from Open', label: 'Gap %', numeric: true },
            { key: 'Rel Volume', label: 'Rel Vol', numeric: true },
            { key: 'Volume', label: 'Volume', numeric: true },
            { key: 'Float', label: 'Float', numeric: true },
            { key: 'Market Cap', label: 'Market Cap', numeric: true }
        ];

        const sorted = [...fundData].sort((a, b) => {
            const col = fundSort.col;
            const dir = fundSort.dir === 'asc' ? 1 : -1;
            const colDef = columns.find(c => c.key === col) || columns[0];
            const aval = parseValue(a[colDef.key]);
            const bval = parseValue(b[colDef.key]);
            if (aval < bval) return -1 * dir;
            if (aval > bval) return 1 * dir;
            return 0;
        });

        wrap.innerHTML = `
            <div style="overflow-x:auto;">
                <table class="table-card">
                    <thead>
                        <tr>
                            ${columns.map(col => `<th onclick="openMarket.sortFund('${col.key}')">${col.label}${fundSort.col === col.key ? (fundSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${sorted.map(row => {
                            const sym = row.Ticker || row.Symbol || 'N/A';
                            return `
                                <tr>
                                    <td>${sym}</td>
                                    <td>${row.Price || '--'}</td>
                                    <td>${row.Change || row['Change'] || '--'}</td>
                                    <td>${row['Change from Open'] || row['Gap'] || '--'}</td>
                                    <td>${row['Rel Volume'] || row['Relative Volume'] || '--'}</td>
                                    <td>${row.Volume || '--'}</td>
                                    <td>${row['Float'] || row['Shs Float'] || '--'}</td>
                                    <td>${row['Market Cap'] || '--'}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function parseValue(val) {
        if (val === undefined || val === null) return 0;
        if (typeof val === 'number') return val;
        const cleaned = String(val).replace(/[%,$]/g, '').replace(/M/g, '000000').replace(/B/g, '000000000');
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
    }

    function formatTimeAgo(date) {
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        const intervals = {
            year: 31536000,
            month: 2592000,
            week: 604800,
            day: 86400,
            hour: 3600,
            minute: 60
        };
        for (const [unit, sec] of Object.entries(intervals)) {
            const count = Math.floor(seconds / sec);
            if (count >= 1) return `${count} ${unit}${count > 1 ? 's' : ''} ago`;
        }
        return 'Just now';
    }

    function parseFinvizDate(dateString) {
        const dateWithTz = `${dateString} EST`;
        const parsed = new Date(dateWithTz);
        if (!isNaN(parsed.getTime())) return parsed;
        const parts = dateString.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
        if (parts) {
            const utcDate = new Date(Date.UTC(
                parseInt(parts[1]),
                parseInt(parts[2]) - 1,
                parseInt(parts[3]),
                parseInt(parts[4]),
                parseInt(parts[5]),
                parseInt(parts[6])
            ));
            return new Date(utcDate.getTime() + 5 * 60 * 60 * 1000);
        }
        return new Date();
    }

    async function refreshNews() {
        const wrap = document.getElementById('om-news');
        if (!wrap) return;
        if (!tickers.length) {
            wrap.innerHTML = '<div class="helper-text">Add tickers to see news.</div>';
            return;
        }
        wrap.innerHTML = '<div class="helper-text">Loading news...</div>';
        try {
            const url = `/api/finviz/news-scanner?v=3&c=1&t=${encodeURIComponent(tickers.join(','))}`;
            const res = await AUTH.fetchSaxo ? await AUTH.fetchSaxo(url, { method: 'GET' }) : await fetch(url);
            if (!res.ok) throw new Error('News fetch failed');
            newsCache = await res.json();
            if (!newsCache || !newsCache.length) {
                wrap.innerHTML = '<div class="helper-text">No news found for these tickers.</div>';
                return;
            }
            renderNewsList();
        } catch (err) {
            wrap.innerHTML = `<div class="helper-text">${err.message}</div>`;
        }
    }

    function freshnessIndicator(dateObj) {
        const now = new Date();
        const ageMinutes = Math.floor((now - dateObj) / 60000);
        const ageHours = Math.floor(ageMinutes / 60);
        const ageDays = Math.floor(ageHours / 24);

        if (ageMinutes < 30) return { icon: '🔥', label: 'Breaking' };
        if (ageMinutes < 60) return { icon: '🔴', label: '<1h' };
        if (ageHours < 6) return { icon: '🟠', label: '<6h' };
        if (ageHours < 24) return { icon: '🟡', label: '<24h' };
        if (ageDays < 2) return { icon: '🟢', label: '<2d' };
        if (ageDays < 5) return { icon: '🔵', label: '<5d' };
        if (ageDays < 7) return { icon: '🟣', label: '<7d' };
        if (ageDays < 14) return { icon: '🟤', label: '<14d' };
        if (ageDays < 30) return { icon: '⚪', label: '<30d' };
        return { icon: '⬜', label: 'Older' };
    }

    function renderNewsList() {
        const wrap = document.getElementById('om-news');
        if (!wrap) return;
        if (!newsCache || !newsCache.length) {
            wrap.innerHTML = '<div class="helper-text">No news found for these tickers.</div>';
            return;
        }

        const sorted = [...newsCache].sort((a, b) => {
            const da = a.Date ? parseFinvizDate(a.Date) : new Date(0);
            const db = b.Date ? parseFinvizDate(b.Date) : new Date(0);
            return newsSortDescending ? db - da : da - db;
        }).slice(0, 80);

        const firstPass = seenNewsKeys.size === 0;
        wrap.innerHTML = sorted.map(item => {
            const title = item.Title || item.Headline || 'News';
            const url = item.Url || item.Link || '#';
            const dateObj = item.Date ? parseFinvizDate(item.Date) : new Date();
            const timeAgo = formatTimeAgo(dateObj);
            const tick = item.Ticker || '';
            const source = item.Source || 'Finviz';
            const fresh = freshnessIndicator(dateObj);
            const change = (tickerStats[tick] && tickerStats[tick].change !== null) ? tickerStats[tick].change : null;
            const changeClass = change === null ? '' : (change >= 0 ? 'news-change-up' : 'news-change-down');
            const changeDisplay = change === null ? '--' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
            const avatarText = tick ? tick.slice(0, 4).toUpperCase() : '---';
            const key = url || `${title}-${tick}-${item.Date || ''}`;
            const isNew = !firstPass && key && !seenNewsKeys.has(key);
            if (key) seenNewsKeys.add(key);
            return `
                <div class="news-row${isNew ? ' news-new' : ''}" onclick="window.open('${url}', '_blank')">
                    <div class="news-row-content">
                        <div class="news-avatar">${avatarText}</div>
                        <div>
                            <div class="news-headline">${fresh.icon} ${title}</div>
                            <div class="news-meta">${source} | ${timeAgo} | ${tick} | ${fresh.label}</div>
                        </div>
                    </div>
                    <div class="news-right-meta">
                        <div class="news-meta">${dateObj.toLocaleString()}</div>
                        <div class="${changeClass}">${changeDisplay}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function toggleNewsSort() {
        newsSortDescending = !newsSortDescending;
        renderNewsList();
    }

    function guessSymbol(raw) {
        const cleaned = (raw || '').trim().toUpperCase();
        if (!cleaned) return '';

        // Alias match (e.g., TES -> TSLA)
        if (window.SymbolSearch && Array.isArray(SymbolSearch.keywordAliases)) {
            for (const entry of SymbolSearch.keywordAliases) {
                if (!entry || !entry.ticker || !Array.isArray(entry.keywords)) continue;
                if (entry.keywords.some(k => cleaned.startsWith(k) || k.startsWith(cleaned))) {
                    return entry.ticker.toUpperCase();
                }
            }
        }

        const universe = new Set([
            ...(window.SymbolSearch && Array.isArray(SymbolSearch.commonSymbols) ? SymbolSearch.commonSymbols : []),
            ...(window.SymbolSearch && Array.isArray(SymbolSearch.symbolCache) ? SymbolSearch.symbolCache : [])
        ]);

        if (universe.has(cleaned)) return cleaned;

        // Very light correction only for near-misses; otherwise trust user input
        if (universe.size) {
            let best = cleaned;
            let bestScore = Infinity;
            universe.forEach(sym => {
                const s = levenshtein(cleaned, sym);
                if (s < bestScore) {
                    bestScore = s;
                    best = sym;
                }
            });
            if (bestScore <= 1) return best;
        }

        return cleaned;
    }

    function levenshtein(a, b) {
        const m = a.length;
        const n = b.length;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                );
            }
        }
        return dp[m][n];
    }

    function applyTickers() {
        const inputs = ['om-t1', 'om-t2', 'om-t3', 'om-t4'];
        const collected = inputs
            .map(id => guessSymbol(document.getElementById(id)?.value || ''))
            .filter(Boolean);
        tickers = collected.length ? collected.slice(0, 4) : [...defaultTickers];
        saveTickers();
        renderBadges();
        renderCharts();
        refreshFundamentals();
        refreshNews();

        // auto-refresh news every minute without reloading the page
        setInterval(() => refreshNews(), 60 * 1000);
    }

    function resetTickers() {
        tickers = [...defaultTickers];
        saveTickers();
        renderBadges();
        renderCharts();
        refreshFundamentals();
        refreshNews();
    }

    function setInterval(containerId, symbol, nextInterval) {
        interval = nextInterval;
        buildChart(containerId, symbol);
    }

    function refreshAll() {
        renderCharts();
        refreshFundamentals();
        refreshNews();
    }

    function bindInput() {
        const ids = ['om-t1', 'om-t2', 'om-t3', 'om-t4'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter') applyTickers();
            });
            if (window.SymbolSearch) {
                SymbolSearch.createAutocomplete(id, () => {});
            }
        });
    }

    function sortFund(col) {
        if (fundSort.col === col) {
            fundSort.dir = fundSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
            fundSort = { col, dir: 'asc' };
        }
        renderFundTable();
    }

    function init() {
        loadTickers();
        renderBadges();
        renderWatchlistTray();
        bindInput();
        bindDropTargets();
        renderCharts();
        refreshFundamentals();
        refreshNews();

        if (window.WATCHLIST && typeof WATCHLIST.onChange === 'function') {
            WATCHLIST.onChange(() => renderWatchlistTray());
        }
    }

    window.openMarket = {
        init,
        applyTickers,
        resetTickers,
        refreshAll,
        refreshFundamentals,
        refreshNews,
        setInterval,
        toggleNewsSort,
        sortFund
    };
})();
