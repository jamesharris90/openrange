// Alert Manager: price alerts and screener appearance alerts
(function() {
    const STORAGE_KEY = 'alertsV2';
    const STATUS_EL_ID = 'alertStatus';
    const LIST_EL_ID = 'alertList';
    const PRICE_FORM = { symbol: 'alertSymbol', operator: 'alertOperator', price: 'alertPrice' };
    const SCREENER_FORM = { filter: 'screenerFilter', symbol: 'screenerSymbol' };
    const CHECK_INTERVAL_MS = 120000; // 2 minutes

    const state = {
        alerts: [],
        timer: null
    };

    function loadAlerts() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            console.warn('Failed to parse alerts storage', e);
        }
        return [];
    }

    function migrateLegacy() {
        const legacyRaw = localStorage.getItem('alerts');
        if (!legacyRaw) return [];
        try {
            const legacy = JSON.parse(legacyRaw);
            if (Array.isArray(legacy)) {
                const migrated = legacy.map((a, idx) => ({
                    id: Date.now() + idx,
                    type: 'price',
                    symbol: a.symbol || '',
                    operator: 'gte',
                    price: a.price || a.target || 0,
                    triggered: false,
                    createdAt: new Date().toISOString()
                }));
                localStorage.removeItem('alerts');
                return migrated;
            }
        } catch (e) {
            console.warn('Legacy alerts migration failed', e);
        }
        return [];
    }

    function saveAlerts() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.alerts));
    }

    function renderStatus(text) {
        const el = document.getElementById(STATUS_EL_ID);
        if (el) el.textContent = text;
    }

    function renderAlerts() {
        const list = document.getElementById(LIST_EL_ID);
        if (!list) return;
        if (!state.alerts.length) {
            list.innerHTML = '<div class="helper-text">No alerts yet. Add a price alert or screener watch.</div>';
            return;
        }
        list.innerHTML = state.alerts.map(a => {
            const status = a.triggered ? '<span class="alert-pill triggered">TRIGGERED</span>' : '<span class="alert-pill pending">PENDING</span>';
            if (a.type === 'price') {
                const op = a.operator === 'lte' ? '≤' : '≥';
                return `<div class="alert-row"><div><strong>${a.symbol}</strong> ${op} ${a.price}</div>${status}<button data-id="${a.id}" class="alert-remove">✕</button></div>`;
            }
            const symText = a.symbol ? `<strong>${a.symbol}</strong> in ` : '';
            return `<div class="alert-row"><div>${symText}filter <code>${a.filter}</code></div>${status}<button data-id="${a.id}" class="alert-remove">✕</button></div>`;
        }).join('');

        list.querySelectorAll('.alert-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                state.alerts = state.alerts.filter(a => String(a.id) !== String(id));
                saveAlerts();
                renderAlerts();
            });
        });
    }

    function addPriceAlert() {
        const symbol = document.getElementById(PRICE_FORM.symbol)?.value.trim().toUpperCase();
        const operator = document.getElementById(PRICE_FORM.operator)?.value || 'gte';
        const priceVal = parseFloat(document.getElementById(PRICE_FORM.price)?.value);
        if (!symbol || Number.isNaN(priceVal)) return;
        state.alerts.push({
            id: Date.now(),
            type: 'price',
            symbol,
            operator,
            price: priceVal,
            triggered: false,
            createdAt: new Date().toISOString()
        });
        saveAlerts();
        renderAlerts();
        renderStatus('Alert saved. We will check every 2 minutes.');
    }

    function addScreenerAlert() {
        const filter = document.getElementById(SCREENER_FORM.filter)?.value.trim();
        const symbol = document.getElementById(SCREENER_FORM.symbol)?.value.trim().toUpperCase();
        if (!filter) return;
        state.alerts.push({
            id: Date.now(),
            type: 'screener',
            filter,
            symbol: symbol || null,
            triggered: false,
            createdAt: new Date().toISOString()
        });
        saveAlerts();
        renderAlerts();
        renderStatus('Screener watch saved.');
    }

    function bindUI() {
        document.getElementById('addPriceAlert')?.addEventListener('click', addPriceAlert);
        document.getElementById('addScreenerAlert')?.addEventListener('click', addScreenerAlert);
    }

    async function fetchPrices(symbols) {
        if (!symbols.length) return {};
        try {
            const url = `/api/finviz/screener?t=${encodeURIComponent(symbols.join(','))}&v=111`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Finviz price fetch failed');
            const data = await res.json();
            const map = {};
            (data || []).forEach(row => {
                const sym = row.Ticker || row.ticker || row.Symbol || row.symbol;
                const price = parseFloat(row.Price || row.Last || row.price || row.last);
                if (sym) map[sym.toUpperCase()] = price;
            });
            return map;
        } catch (err) {
            console.warn('Price fetch error', err);
            renderStatus('Price check failed (Finviz not available).');
            return {};
        }
    }

    async function fetchScreener(filter) {
        try {
            const url = `/api/finviz/screener?f=${encodeURIComponent(filter)}&v=111`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Screener fetch failed');
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.warn('Screener fetch error', err);
            renderStatus('Screener check failed (Finviz not available).');
            return [];
        }
    }

    function evaluatePriceAlerts(priceMap) {
        let triggeredCount = 0;
        state.alerts.forEach(alert => {
            if (alert.type !== 'price' || alert.triggered) return;
            const price = priceMap[alert.symbol];
            if (price === undefined || price === null || Number.isNaN(price)) return;
            const hit = alert.operator === 'lte' ? price <= alert.price : price >= alert.price;
            if (hit) {
                alert.triggered = true;
                alert.triggeredAt = new Date().toISOString();
                triggeredCount += 1;
            }
        });
        return triggeredCount;
    }

    async function evaluateScreenerAlerts() {
        // Group by filter to minimize calls
        const pending = state.alerts.filter(a => a.type === 'screener' && !a.triggered);
        const byFilter = {};
        pending.forEach(a => {
            if (!byFilter[a.filter]) byFilter[a.filter] = [];
            byFilter[a.filter].push(a);
        });
        let triggeredCount = 0;
        for (const [filter, alerts] of Object.entries(byFilter)) {
            const data = await fetchScreener(filter);
            alerts.forEach(alert => {
                if (alert.triggered) return;
                const hit = alert.symbol
                    ? data.some(row => {
                        const sym = row.Ticker || row.ticker || row.Symbol || row.symbol;
                        return sym && sym.toUpperCase() === alert.symbol;
                    })
                    : data.length > 0;
                if (hit) {
                    alert.triggered = true;
                    alert.triggeredAt = new Date().toISOString();
                    triggeredCount += 1;
                }
            });
        }
        return triggeredCount;
    }

    async function checkAlerts() {
        if (!state.alerts.length) {
            renderStatus('No alerts configured.');
            return;
        }
        renderStatus('Checking alerts...');
        try {
            const priceSymbols = [...new Set(state.alerts.filter(a => a.type === 'price' && !a.triggered).map(a => a.symbol))];
            const priceMap = await fetchPrices(priceSymbols);
            const priceHits = evaluatePriceAlerts(priceMap);
            const screenerHits = await evaluateScreenerAlerts();
            if (priceHits + screenerHits > 0) {
                saveAlerts();
                renderAlerts();
                renderStatus(`${priceHits + screenerHits} alert(s) triggered.`);
            } else {
                renderStatus('Alerts checked; none triggered yet.');
            }
        } catch (err) {
            console.error('Alert check error', err);
            renderStatus('Alert check failed.');
        }
    }

    function startTimer() {
        if (state.timer) clearInterval(state.timer);
        state.timer = setInterval(checkAlerts, CHECK_INTERVAL_MS);
    }

    function init() {
        state.alerts = loadAlerts();
        const migrated = migrateLegacy();
        if (migrated.length) {
            state.alerts = state.alerts.concat(migrated);
            saveAlerts();
        }
        renderAlerts();
        bindUI();
        checkAlerts();
        startTimer();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
