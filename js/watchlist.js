// Watchlist page logic: render tickers and live stats
(function() {
    let listEl;
    let tableBody;
    let statusEl;
    let refreshBtn;

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
            renderTable(data || []);
            renderStatus('');
        } catch (err) {
            renderStatus('Could not load stats right now.');
        }
    }

    function renderStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

    function renderTable(rows) {
        if (!tableBody) return;
        if (!rows.length) {
            tableBody.innerHTML = '<tr><td colspan="6" class="helper-text">No data</td></tr>';
            return;
        }
        tableBody.innerHTML = rows.map(row => {
            const sym = row.Ticker || row.Symbol || '';
            const price = row.Price || '--';
            const change = row.Change || row['Change'] || '--';
            const gap = row['Change from Open'] || row['Gap'] || '--';
            const relVol = row['Rel Volume'] || row['Relative Volume'] || '--';
            const vol = row.Volume || '--';
            return `
                <tr>
                    <td>${sym}</td>
                    <td>${price}</td>
                    <td>${change}</td>
                    <td>${gap}</td>
                    <td>${relVol}</td>
                    <td>${vol}</td>
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
