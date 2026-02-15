// Watchlist page logic: render tickers and live stats
(function() {
    let listEl;
    let tableBody;
    let statusEl;
    let refreshBtn;

    function makeGetter(row) {
        const normalized = {};
        Object.entries(row || {}).forEach(([key, value]) => {
            const clean = (key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (clean) normalized[clean] = value;
        });
        return function(keys) {
            for (const key of keys) {
                const clean = (key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                if (clean in normalized && normalized[clean] !== '' && normalized[clean] !== null && normalized[clean] !== undefined) {
                    return normalized[clean];
                }
            }
            return null;
        };
    }

    function formatChange(val) {
        if (val === null || val === undefined || val === '') return '--';
        const str = String(val).trim();
        return str.endsWith('%') ? str : `${str}%`;
    }

    function formatTimeAgo(iso) {
        const dt = new Date(iso);
        if (isNaN(dt)) return '--';
        const diff = Date.now() - dt.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
        const days = Math.floor(hrs / 24);
        return `${days} day${days === 1 ? '' : 's'} ago`;
    }

    function formatSource(source) {
        if (!source) return 'manual';
        return String(source)
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    function renderChips(list) {
        if (!listEl) return;
        if (!list.length) {
            listEl.innerHTML = '<div class="helper-text">No symbols yet. Add from Screeners, Advanced Screener, or News Scanner.</div>';
            return;
        }
        listEl.innerHTML = list.map(item => `
            <span class="chip">
                ${item.symbol}
                <button class="chip-remove" data-symbol="${item.symbol}">×</button>
            </span>
        `).join('');
        listEl.querySelectorAll('.chip-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                WATCHLIST.remove(btn.getAttribute('data-symbol'));
                render();
                fetchStats();
            });
        });
    }

    async function fetchStats() {
        const list = WATCHLIST.getList();
        const symbols = list.map(i => i.symbol);
        if (!symbols.length) {
            if (tableBody) tableBody.innerHTML = '';
            renderStatus('');
            return;
        }
        renderStatus('Loading stats...');
        try {
            const url = `/api/finviz/screener?t=${encodeURIComponent(symbols.join(','))}&v=111`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Fetch failed');
            const data = await res.json();
            renderTable(data || [], list);
            renderStatus('');
        } catch (err) {
            renderStatus('Could not load stats right now.');
        }
    }

    function renderStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

    function renderTable(rows, metaList = WATCHLIST.getList()) {
        if (!tableBody) return;
        const metaMap = new Map((metaList || []).map(item => [item.symbol, item]));

        if (!rows.length) {
            tableBody.innerHTML = '<tr><td colspan="8" class="helper-text">No data</td></tr>';
            return;
        }

        tableBody.innerHTML = rows.map(row => {
            const get = makeGetter(row);
            const sym = (get(['ticker', 'symbol']) || '--').toString();
            const company = get(['company']) || '--';
            const price = get(['price']) || '--';
            const change = formatChange(get(['change', 'changep']) || get(['changepercent']));
            const marketCap = get(['marketcap', 'marketcapitalization']) || get(['market cap']) || '--';
            const meta = metaMap.get(sym) || {};
            const source = formatSource(meta.source);
            const added = meta.addedAt ? formatTimeAgo(meta.addedAt) : '--';

            return `
                <tr>
                    <td>${sym}</td>
                    <td>${company}</td>
                    <td>${price}</td>
                    <td>${change}</td>
                    <td>${marketCap}</td>
                    <td>${source}</td>
                    <td>${added}</td>
                    <td><button class="chip-remove" data-action="remove" data-symbol="${sym}" aria-label="Remove from watchlist">×</button></td>
                </tr>
            `;
        }).join('');
    }

    function render() {
        const list = WATCHLIST.getList();
        renderChips(list);
    }

    function bind() {
        refreshBtn?.addEventListener('click', () => fetchStats());
        tableBody?.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-action="remove"]');
            if (!btn) return;
            const sym = btn.getAttribute('data-symbol');
            if (!sym) return;
            WATCHLIST.remove(sym);
            render();
            fetchStats();
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        listEl = document.getElementById('watchlistChips');
        tableBody = document.getElementById('watchlistTableBody');
        statusEl = document.getElementById('watchlistStatus');
        refreshBtn = document.getElementById('watchlistRefresh');

        render();
        bind();
        fetchStats();
        WATCHLIST.onChange(() => {
            render();
            fetchStats();
        });
    });
})();
