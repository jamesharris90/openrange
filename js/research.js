// Research page powered by Finviz quote data
let currentSymbol = 'SPY';

const quickSymbols = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META'];

function setLoading(el, text) {
    if (!el) return;
    el.innerHTML = `<div class="widget-loading">${text}</div>`;
}

async function loadSymbol() {
    const input = document.getElementById('symbolInput');
    const symbol = (input?.value || '').trim().toUpperCase();
    if (!symbol) {
        alert('Please enter a ticker symbol');
        return;
    }
    await loadSymbolQuick(symbol);
}

async function loadSymbolQuick(symbol) {
    currentSymbol = symbol;
    localStorage.setItem('lastResearchSymbol', symbol);

    const nameEl = document.getElementById('currentSymbolName');
    const tickerEl = document.getElementById('currentSymbol');
    if (tickerEl) tickerEl.textContent = symbol;
    if (nameEl) nameEl.textContent = 'Loading...';

    const infoContainer = document.getElementById('symbolInfoContainer');
    const profileContainer = document.getElementById('profileContainer');
    const fundamentalsContainer = document.getElementById('fundamentalsContainer');
    const newsContainer = document.getElementById('newsContainer');
    const chartContainer = document.getElementById('chartContainer');
    const technicalContainer = document.getElementById('technicalContainer');

    setLoading(infoContainer, 'Loading snapshot...');
    setLoading(profileContainer, 'Loading profile...');
    setLoading(fundamentalsContainer, 'Loading fundamentals...');
    setLoading(newsContainer, 'Loading news...');
    if (chartContainer) chartContainer.innerHTML = '<div class="widget-loading">Chart widget not available</div>';
    if (technicalContainer) technicalContainer.innerHTML = '<div class="widget-loading">Technical analysis widget not available</div>';

    await Promise.all([
        fetchQuote(symbol),
        loadNews(symbol)
    ]);
}

async function fetchQuote(symbol) {
    try {
        const response = await fetch(`/api/finviz/quote?t=${encodeURIComponent(symbol)}`);
        if (!response.ok) throw new Error('Quote fetch failed');
        const data = await response.json();
        renderQuote(data);
    } catch (err) {
        const containers = [
            document.getElementById('symbolInfoContainer'),
            document.getElementById('profileContainer'),
            document.getElementById('fundamentalsContainer')
        ];
        containers.forEach(el => el && (el.innerHTML = `<div class="widget-loading">${err.message}</div>`));
    }
}

function renderQuote(data) {
    const { ticker, companyName, price, change, sector, industry, country, snapshot, description } = data;

    const nameEl = document.getElementById('currentSymbolName');
    if (nameEl) nameEl.textContent = companyName || '—';
    const tickerEl = document.getElementById('currentSymbol');
    if (tickerEl) tickerEl.textContent = ticker;

    renderSnapshot({ price, change, sector, industry, country, snapshot });
    renderProfile(description, sector, industry, country);
    renderFundamentals(snapshot);
}

function renderSnapshot({ price, change, sector, industry, country, snapshot }) {
    const container = document.getElementById('symbolInfoContainer');
    if (!container) return;
    const changeClass = (change || '').includes('-') ? 'negative' : 'positive';

    const rows = [
        { label: 'Price', value: price || '—' },
        { label: 'Change', value: change || '—', cls: changeClass },
        { label: 'Sector', value: sector || '—' },
        { label: 'Industry', value: industry || '—' },
        { label: 'Country', value: country || '—' },
        { label: 'Market Cap', value: snapshot['Market Cap'] || '—' },
        { label: 'Volume', value: snapshot['Volume'] || '—' },
        { label: 'Avg Volume', value: snapshot['Avg Volume'] || '—' }
    ];

    container.innerHTML = `
        <div class="info-grid">
            ${rows.map(r => `
                <div class="info-item">
                    <div class="info-label">${r.label}</div>
                    <div class="info-value ${r.cls || ''}">${r.value}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderProfile(description, sector, industry, country) {
    const container = document.getElementById('profileContainer');
    if (!container) return;
    container.innerHTML = `
        <div class="profile-block">
            <div class="profile-meta">${sector || '—'} · ${industry || '—'} · ${country || '—'}</div>
            <div class="profile-description">${description || 'No profile available from Finviz.'}</div>
        </div>
    `;
}

function renderFundamentals(snapshot) {
    const container = document.getElementById('fundamentalsContainer');
    if (!container) return;

    const keys = [
        'P/E', 'Forward P/E', 'PEG', 'P/S', 'P/B', 'P/C', 'P/FCF',
        'EPS (ttm)', 'EPS next Y', 'EPS next 5Y', 'Dividend %', 'ROA', 'ROE', 'ROI',
        'Gross Margin', 'Oper. Margin', 'Profit Margin', 'Debt/Eq', 'LT Debt/Eq',
        'SMA20', 'SMA50', 'SMA200', '52W High', '52W Low', '52W Range'
    ];

    const cards = keys.map(k => ({ label: k, value: snapshot[k] || '—' }));

    container.innerHTML = `
        <div class="fundamentals-grid">
            ${cards.map(item => `
                <div class="fundamental-item">
                    <div class="fundamental-label">${item.label}</div>
                    <div class="fundamental-value">${item.value}</div>
                </div>
            `).join('')}
        </div>
    `;
}

async function loadNews(symbol) {
    const container = document.getElementById('newsContainer');
    if (!container) return;
    setLoading(container, 'Loading news...');
    try {
        const response = await fetch(`/api/finviz/news-scanner?v=3&c=1&t=${encodeURIComponent(symbol)}`);
        if (!response.ok) throw new Error('News fetch failed');
        const items = await response.json();
        const top = (items || []).slice(0, 12);
        if (!top.length) {
            container.innerHTML = '<div class="widget-loading">No news available</div>';
            return;
        }
        container.innerHTML = `
            <div class="news-list">
                ${top.map(item => {
                    const title = item.Title || item.Headline || 'News';
                    const url = item.Url || item.Link || '#';
                    const date = item.Date || '';
                    const source = item.Source || 'Finviz';
                    return `
                        <a class="news-item" href="${url}" target="_blank" rel="noopener">
                            <div class="news-title">${title}</div>
                            <div class="news-meta">${source} · ${date}</div>
                        </a>
                    `;
                }).join('')}
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div class="widget-loading">${err.message}</div>`;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const savedSymbol = localStorage.getItem('lastResearchSymbol') || 'SPY';
    const input = document.getElementById('symbolInput');
    if (input) input.value = savedSymbol;
    loadSymbolQuick(savedSymbol);
    if (window.lucide) lucide.createIcons();
    if (window.marketStatus) marketStatus.init();
});
