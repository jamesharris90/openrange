// js/scanner.js
// Stock scanner logic with Saxo API integration

// Use SaxoAPI if authenticated, else fallback to demo data
let STOCKS = [];
let usingDemoData = false;

async function fetchStocksFromSaxo() {
    try {
        // Fetch Finviz stock data from your backend
        const response = await fetch('/api/finviz/news');
        if (!response.ok) throw new Error('Finviz API error: ' + response.status);
        const finvizData = await response.json();
        if (!finvizData || !Array.isArray(finvizData) || finvizData.length === 0) {
            showSaxoError('Finviz API returned no data.');
            throw new Error('Finviz API returned no data');
        }
        // Map/normalize Finviz data to scanner format (demo: only symbol, headline, source)
        return finvizData.map(item => ({
            symbol: item.headline || item.Headline || '',
            price: 0,
            volume: 0,
            pctChange: 0,
            marketCap: 0,
            float: 0,
            avgVolume: 0,
            avgVolume10: 0,
            avgVolume30: 0,
            avgVolume90: 0,
            sector: item.source || '',
            relVol: 1,
            premktChange: 0,
            atr: 0,
            distVWAP: 0,
            distHigh: 0,
            rsi: 0,
            maPosition: '',
        }));
    } catch (err) {
        showSaxoError('Finviz API error: ' + (err?.message || err));
        console.warn('Falling back to demo data:', err);
        usingDemoData = true;
        return [
            { symbol: 'AAPL', name: 'Apple Inc.', marketCap: 2800000, volume: 120000000, relVol: 1.2, pctChange: 1.5, premktChange: 0.2, float: 16000 },
            { symbol: 'TSLA', name: 'Tesla Inc.', marketCap: 800000, volume: 90000000, relVol: 2.1, pctChange: 3.2, premktChange: 1.1, float: 8000 },
            { symbol: 'NVDA', name: 'NVIDIA Corp.', marketCap: 2000000, volume: 70000000, relVol: 1.8, pctChange: 2.7, premktChange: 0.5, float: 2500 },
            { symbol: 'AMD', name: 'Advanced Micro Devices', marketCap: 200000, volume: 40000000, relVol: 1.0, pctChange: -0.5, premktChange: -0.2, float: 1200 },
            { symbol: 'PLTR', name: 'Palantir Technologies', marketCap: 50000, volume: 30000000, relVol: 3.0, pctChange: 5.1, premktChange: 2.0, float: 2000 },
        ];
    }
}

// Show Finviz error message on page
function showSaxoError(msg) {
    let errDiv = document.getElementById('saxo-error-msg');
    if (!errDiv) {
        errDiv = document.createElement('div');
        errDiv.id = 'saxo-error-msg';
        errDiv.style.cssText = 'background: #ef4444; color: #fff; padding: 12px; border-radius: 8px; margin: 16px 0; text-align: center; font-weight: bold;';
        document.querySelector('.scanner-container').prepend(errDiv);
    }
    errDiv.textContent = msg.replace('Saxo', 'Finviz');
}

function filterStocks(filters) {
    return STOCKS.filter(stock => {
        if (filters.priceMin && stock.price < filters.priceMin) return false;
        if (filters.priceMax && stock.price > filters.priceMax) return false;
        if (filters.marketCapMin && stock.marketCap < filters.marketCapMin) return false;
        if (filters.marketCapMax && stock.marketCap > filters.marketCapMax) return false;
        if (filters.float && stock.float > filters.float) return false;
        if (filters.volume && stock.volume < filters.volume) return false;
        // Avg Volume with range
        let avgVol = stock.avgVolume;
        if (filters.avgVolumeRange === '10') avgVol = stock.avgVolume10;
        if (filters.avgVolumeRange === '30') avgVol = stock.avgVolume30;
        if (filters.avgVolumeRange === '90') avgVol = stock.avgVolume90;
        if (filters.avgVolume && avgVol < filters.avgVolume) return false;
        if (filters.sector && (!stock.sector || !stock.sector.toLowerCase().includes(filters.sector.toLowerCase()))) return false;
        if (filters.relVol && stock.relVol < filters.relVol) return false;
        if (filters.pctChange && stock.pctChange < filters.pctChange) return false;
        if (filters.premktChange && stock.premktChange < filters.premktChange) return false;
        if (filters.atr && stock.atr < filters.atr) return false;
        if (filters.distVWAP && stock.distVWAP > filters.distVWAP) return false;
        if (filters.distHigh && stock.distHigh > filters.distHigh) return false;
        if (filters.rsi && stock.rsi > filters.rsi) return false;
        if (filters.maPosition && stock.maPosition !== filters.maPosition) return false;
        return true;
    });
}

function renderStocks(stocks) {
    const tbody = document.querySelector('#stocks-table tbody');
    tbody.innerHTML = '';
    // Header control
    const headerControl = document.getElementById('headerControl');
    const selectedHeaders = Array.from(headerControl.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    const headerTitles = {
        symbol: 'Symbol', price: 'Price', marketCap: 'Market Cap', float: 'Float', volume: 'Volume', avgVolume: 'Avg Volume', sector: 'Sector', relVol: 'Rel Vol', pctChange: '% Change', premktChange: 'Pre-mkt %', atr: 'ATR/ADR', distVWAP: 'Dist VWAP', distHigh: 'Dist 52wk High', rsi: 'RSI', maPosition: 'MA Pos'
    };
    // Render header
    const headerRow = document.getElementById('table-header-row');
    headerRow.innerHTML = selectedHeaders.map(h => `<th>${headerTitles[h]}</th>`).join('');

    // Pagination
    const pageSize = 20;
    let page = window.currentPage || 1;
    const totalPages = Math.ceil(stocks.length / pageSize);
    if (page > totalPages) page = totalPages;
    window.currentPage = page;
    const pagedStocks = stocks.slice((page - 1) * pageSize, page * pageSize);

    // Render rows
    tbody.innerHTML = '';
    if (!stocks.length) {
        tbody.innerHTML = `<tr><td colspan="${selectedHeaders.length}" style="text-align:center;color:#888;">No results found.</td></tr>`;
        return;
    }
    pagedStocks.forEach(stock => {
        const row = document.createElement('tr');
        row.innerHTML = selectedHeaders.map(h => h === 'symbol' ? `<td style="font-size:0.95em;font-weight:bold;">${stock[h]}</td>` : `<td>${stock[h] ?? ''}</td>`).join('');
        tbody.appendChild(row);
    });

    // Pagination controls
    const pagination = document.getElementById('pagination');
    pagination.innerHTML = '';
    if (totalPages > 1) {
        for (let i = 1; i <= totalPages; i++) {
            const btn = document.createElement('button');
            btn.textContent = i;
            btn.style.margin = '0 4px';
            btn.disabled = i === page;
            btn.onclick = () => {
                window.currentPage = i;
                renderStocks(stocks);
            };
            pagination.appendChild(btn);
        }
    }
}

document.getElementById('filters').addEventListener('submit', function(e) {
    e.preventDefault();
    const form = e.target;
    const filters = {
        priceMin: Number(form.priceMin.value) || 0,
        priceMax: Number(form.priceMax.value) || 1000000,
        marketCapMin: Number(form.marketCapMin.value) || 0,
        marketCapMax: Number(form.marketCapMax.value) || 1000000000,
        float: Number(form.float.value) || 1000000,
        volume: Number(form.volume.value) || 0,
        avgVolume: Number(form.avgVolume.value) || 0,
        avgVolumeRange: form.avgVolumeRange.value,
        sector: form.sector.value,
        relVol: Number(form.relVol.value) || 0,
        pctChange: Number(form.pctChange.value) || -100,
        premktChange: Number(form.premktChange.value) || -100,
        atr: Number(form.atr.value) || 0,
        distVWAP: Number(form.distVWAP.value) || 100,
        distHigh: Number(form.distHigh.value) || 100,
        rsi: Number(form.rsi.value) || 100,
        maPosition: form.maPosition.value,
    };
    const results = filterStocks(filters);
    renderStocks(results);
});


// Initial render: fetch from Saxo or fallback
window.addEventListener('DOMContentLoaded', async () => {
    STOCKS = await fetchStocksFromSaxo();
    renderStocks(STOCKS);
    // Header control event
    document.getElementById('headerControl').addEventListener('change', () => renderStocks(STOCKS));
    if (usingDemoData) {
        const note = document.createElement('div');
        note.style.color = '#f97316';
        note.style.margin = '1rem 0';
        note.textContent = 'Live Saxo data not available. Showing demo data.';
        document.querySelector('.scanner-container').prepend(note);
    }
});
