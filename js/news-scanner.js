// News Scanner Module
// Handles catalyst news with stock filtering

class NewsScanner {
    constructor() {
        this.newsData = null;
        this.stockData = {};
        this.filteredNews = null;
        this.isLoading = false;
        this.filters = {
            tickers: [],
            catalysts: [], // array of catalyst types
            priceMin: null,
            priceMax: null,
            changeMin: null,
            volumeMin: null,
            floatMin: null,
            floatMax: null,
            marketCapMin: null,
            marketCapMax: null,
            relVolMin: null
        };

        // Catalyst keywords for detection
        this.catalystKeywords = {
            earnings: ['earnings', 'q1', 'q2', 'q3', 'q4', 'quarterly', 'revenue', 'eps'],
            fda: ['fda', 'approval', 'clinical trial', 'phase', 'drug'],
            product: ['launches', 'unveils', 'introduces', 'new product', 'release'],
            merger: ['merger', 'acquisition', 'acquires', 'buys', 'takes over', 'm&a'],
            contract: ['wins contract', 'awarded', 'deal', 'partnership', 'agreement'],
            upgrade: ['upgrade', 'rating', 'initiated', 'target', 'buy', 'sell', 'downgrade'],
            offering: ['offering', 'ipo', 'secondary', 'raises', 'funding'],
            guidance: ['guidance', 'outlook', 'forecast', 'expects']
        };
    }

    exportResults(format = 'csv') {
        const data = this.filteredNews || this.newsData || [];
        if (!data.length) {
            alert('No news to export. Apply filters or refresh the feed first.');
            return;
        }

        const rows = [];
        data.forEach(item => {
            const tickers = this.parseTickers(item.Ticker || '');
            const catalysts = this.detectCatalysts(item.Title).join('|');
            const headline = item.Title || '';
            const url = item.Url || item.URL || '';
            const source = item.Source || '';
            const timestamp = item.Date || '';

            if (tickers.length === 0) {
                rows.push({ ticker: 'N/A', headline, url, catalysts, source, timestamp });
            } else {
                tickers.forEach(ticker => {
                    rows.push({ ticker, headline, url, catalysts, source, timestamp });
                });
            }
        });

        if (!rows.length) {
            alert('No news rows available to export.');
            return;
        }

        if (format === 'text') {
            const text = rows.map(r => `${r.ticker} | ${r.headline} | ${r.url} | ${r.catalysts}`).join('\n');
            this.downloadBlob(text, 'text/plain', 'news-export.txt');
            return;
        }

        // Default to CSV
        const header = ['Ticker', 'Headline', 'Link', 'Type', 'Source', 'Published'];
        const csvLines = [header.join(',')].concat(rows.map(r => {
            return [r.ticker, r.headline, r.url, r.catalysts, r.source, r.timestamp]
                .map(this.toCsvValue)
                .join(',');
        }));

        this.downloadBlob(csvLines.join('\n'), 'text/csv', 'news-export.csv');
    }

    downloadBlob(content, mimeType, filename) {
        const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    toCsvValue(value) {
        const safe = (value ?? '').toString().replace(/"/g, '""');
        return `"${safe}"`;
    }

    async fetchNews() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            const params = new URLSearchParams({
                v: '3', // Stocks feed
                c: '1'  // News only
            });

            // When ticker filters are present, ask backend for ticker-specific news
            if (this.filters.tickers && this.filters.tickers.length > 0) {
                params.set('t', this.filters.tickers.join(','));
            }

            const response = await AUTH.fetchSaxo(`/api/finviz/news-scanner?${params}`, {
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            this.newsData = await response.json();

            // Fetch stock data for unique tickers
            await this.fetchStockData();

            this.applyFilters();
            this.render();
        } catch (error) {
            console.error('Failed to fetch news:', error);
            this.renderError(error.message);
        } finally {
            this.isLoading = false;
        }
    }

    async fetchStockData() {
        if (!this.newsData) return;

        // Get unique tickers - split any comma/space separated tickers
        const allTickers = this.newsData
            .map(item => this.parseTickers(item.Ticker || ''))
            .flat();

        const tickers = [...new Set(allTickers)];

        console.log(`Fetching stock data for ${tickers.length} unique tickers...`, tickers);

        // Fetch stock data in batches
        const batchSize = 50;
        for (let i = 0; i < tickers.length; i += batchSize) {
            const batch = tickers.slice(i, i + batchSize);
            const tickerString = batch.join(',');

            try {
                console.log(`Fetching batch: ${tickerString}`);
                const response = await AUTH.fetchSaxo(`/api/finviz/screener?f=&t=${tickerString}`, {
                    method: 'GET'
                });

                if (response.ok) {
                    const stockInfo = await response.json();
                    console.log(`Received ${stockInfo.length} stocks from batch`);
                    stockInfo.forEach(stock => {
                        if (stock.Ticker) {
                            this.stockData[stock.Ticker] = stock;
                        }
                    });
                } else {
                    console.warn(`API returned status ${response.status} for batch`);
                }
            } catch (error) {
                console.warn(`Failed to fetch stock data for batch:`, error);
            }
        }

        console.log(`Successfully fetched data for ${Object.keys(this.stockData).length} stocks out of ${tickers.length} requested`);
        console.log('Stock data:', this.stockData);
    }

    detectCatalysts(title) {
        const titleLower = title.toLowerCase();
        const detected = [];

        for (const [catalyst, keywords] of Object.entries(this.catalystKeywords)) {
            if (keywords.some(keyword => titleLower.includes(keyword))) {
                detected.push(catalyst);
            }
        }

        return detected.length > 0 ? detected : ['general'];
    }

    applyFilters() {
        if (!this.newsData) {
            this.filteredNews = [];
            return;
        }

        this.filteredNews = this.newsData.filter(newsItem => {
            const tickerString = newsItem.Ticker || '';
            const tickers = this.parseTickers(tickerString);
            const primaryTicker = tickers[0];
            const stock = this.stockData[primaryTicker];

            // Detect catalysts
            const catalysts = this.detectCatalysts(newsItem.Title);

            // Apply ticker filter (matches any provided ticker)
            if (this.filters.tickers.length > 0) {
                const matchesTicker = tickers.some(t => this.filters.tickers.includes(t));
                if (!matchesTicker) return false;
            }

            // Apply catalyst filter
            if (this.filters.catalysts.length > 0) {
                if (!catalysts.some(c => this.filters.catalysts.includes(c))) {
                    return false;
                }
            }

            // If no stock data available, include if no stock filters are active
            if (!stock) {
                const hasStockFilters = this.filters.priceMin || this.filters.priceMax ||
                                       this.filters.volumeMin || this.filters.floatMin;
                return !hasStockFilters;
            }

            // Parse stock values
            const price = parseFloat(stock.Price);
            const change = parseFloat((stock.Change || '').replace('%', ''));
            const volume = parseInt(stock.Volume);
            const floatVal = parseFloat(stock['Float'] || stock['Shs Float']);
            const marketCap = parseFloat(stock['Market Cap']);
            const relVol = parseFloat(stock['Rel Volume'] || stock['Relative Volume']);

            // Apply stock filters
            if (this.filters.priceMin !== null && price < this.filters.priceMin) return false;
            if (this.filters.priceMax !== null && price > this.filters.priceMax) return false;
            if (this.filters.changeMin !== null && change < this.filters.changeMin) return false;
            if (this.filters.volumeMin !== null && volume < this.filters.volumeMin) return false;
            if (this.filters.floatMin !== null && floatVal < this.filters.floatMin) return false;
            if (this.filters.floatMax !== null && floatVal > this.filters.floatMax) return false;
            if (this.filters.marketCapMin !== null && marketCap < this.filters.marketCapMin) return false;
            if (this.filters.marketCapMax !== null && marketCap > this.filters.marketCapMax) return false;
            if (this.filters.relVolMin !== null && relVol < this.filters.relVolMin) return false;

            return true;
        });
    }

    updateFilter(filterName, value) {
        if (filterName === 'tickers') {
            this.filters.tickers = value;
        } else if (filterName === 'catalysts') {
            // Toggle catalyst in array
            const index = this.filters.catalysts.indexOf(value);
            if (index > -1) {
                this.filters.catalysts.splice(index, 1);
            } else {
                this.filters.catalysts.push(value);
            }
        } else {
            this.filters[filterName] = value === '' || value === null ? null : value;
        }

        this.applyFilters();
        this.render();
        this.updateFilterSummary();
    }

    clearFilters() {
        this.filters = {
            tickers: [],
            catalysts: [],
            priceMin: null,
            priceMax: null,
            changeMin: null,
            volumeMin: null,
            floatMin: null,
            floatMax: null,
            marketCapMin: null,
            marketCapMax: null,
            relVolMin: null
        };

        // Clear all filter inputs
        document.querySelectorAll('.news-filter-input').forEach(input => input.value = '');
        document.querySelectorAll('.catalyst-filter').forEach(btn => btn.classList.remove('active'));

        this.applyFilters();
        this.render();
        this.updateFilterSummary();
    }

    updateFilterSummary() {
        const summary = document.getElementById('news-filter-summary');
        if (!summary) return;

        const activeFilters = this.filters.catalysts.length +
            Object.entries(this.filters).filter(([key, value]) =>
                key !== 'catalysts' && key !== 'tickers' && value !== null
            ).length;

        const tickerCount = this.filters.tickers.length;

        if (activeFilters === 0 && tickerCount === 0) {
            summary.textContent = '';
            summary.style.display = 'none';
        } else {
            summary.style.display = 'inline-block';
            const parts = [];
            if (tickerCount > 0) {
                parts.push(`${tickerCount} ticker${tickerCount > 1 ? 's' : ''}`);
            }
            if (activeFilters > 0) {
                parts.push(`${activeFilters} filter${activeFilters > 1 ? 's' : ''}`);
            }
            summary.textContent = parts.join(' | ');
        }
    }

    render() {
        const container = document.getElementById('news-scanner-content');
        if (!container) return;

        const dataToShow = this.filteredNews || this.newsData || [];

        if (dataToShow.length === 0) {
            container.innerHTML = '<div class="no-data">No news found matching criteria</div>';
            return;
        }

        // Create news list
        const newsList = document.createElement('div');
        newsList.className = 'news-list';

        // Result count
        const resultCount = document.createElement('div');
        resultCount.className = 'result-count';
        resultCount.textContent = `Showing ${dataToShow.length} news items`;

        newsList.appendChild(resultCount);

        // News items
        dataToShow.slice(0, 200).forEach(newsItem => {
            const item = this.createNewsItem(newsItem);
            newsList.appendChild(item);
        });

        container.innerHTML = '';
        container.appendChild(newsList);

        // Refresh icons
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    createNewsItem(newsItem) {
        const catalysts = this.detectCatalysts(newsItem.Title);

        const item = document.createElement('div');
        item.className = 'news-scanner-item';

        // Time ago - parse Finviz date (US Eastern Time)
        const date = this.parseFinvizDate(newsItem.Date);
        const timeAgo = this.getTimeAgo(date);
        const timeStamp = date.toLocaleString();

        // Handle multiple tickers (comma or space separated)
            const tickerString = newsItem.Ticker || '';
            const tickers = this.parseTickers(tickerString);

        // Stock info section - display all tickers
        let stockInfoHTML = '';
        if (tickers.length > 0) {
            stockInfoHTML = '<div class="stock-info-container">';

            tickers.forEach(ticker => {
                const stock = this.stockData[ticker];

                if (stock) {
                    const price = parseFloat(stock.Price);
                    const change = parseFloat((stock.Change || '').replace('%', ''));
                    const changeClass = change >= 0 ? 'positive' : 'negative';
                    const changeSign = change >= 0 ? '+' : '';

                    stockInfoHTML += `
                        <div class="stock-info" data-watchlist-slot="${ticker}">
                            <div class="stock-ticker">${ticker}</div>
                            <div class="stock-price">$${price.toFixed(2)}</div>
                            <div class="stock-change ${changeClass}">${changeSign}${change.toFixed(2)}%</div>
                        </div>
                    `;
                } else {
                    stockInfoHTML += `
                        <div class="stock-info" data-watchlist-slot="${ticker}">
                            <div class="stock-ticker">${ticker}</div>
                            <div class="stock-price">--</div>
                            <div class="stock-change">--</div>
                        </div>
                    `;
                }
            });

            stockInfoHTML += '</div>';
        } else {
            stockInfoHTML = `
                <div class="stock-info-container">
                    <div class="stock-info">
                        <div class="stock-ticker">N/A</div>
                        <div class="stock-price">--</div>
                        <div class="stock-change">--</div>
                    </div>
                </div>
            `;
        }

        // Catalyst badges
        const catalystBadges = catalysts.map(c =>
            `<span class="catalyst-badge catalyst-${c}">${c}</span>`
        ).join('');

        item.innerHTML = `
            ${stockInfoHTML}
            <div class="news-content">
                <div class="news-header">
                    ${catalystBadges}
                    <span class="news-source">${newsItem.Source}</span>
                    <span class="news-time">${timeAgo} 30 ${timeStamp}</span>
                </div>
                <div class="news-title">
                    <a href="#" onclick="openNewsModal('${newsItem.Url}', '${this.escapeHtml(newsItem.Title).replace(/'/g, "\\'")}'); return false;">
                        ${this.escapeHtml(newsItem.Title)}
                    </a>
                </div>
            </div>
        `;

        // Add watchlist controls
        tickers.forEach(ticker => {
            const slot = item.querySelector(`[data-watchlist-slot="${ticker}"]`);
            if (!slot || !window.WATCHLIST) return;

            const btn = document.createElement('button');
            btn.className = 'watchlist-btn';

            const setState = () => {
                const isInList = window.WATCHLIST.has(ticker);
                btn.textContent = isInList ? '✓ In Watchlist' : '+ Watchlist';
                btn.classList.toggle('added', isInList);
            };

            btn.onclick = (e) => {
                e.stopPropagation();
                const isInList = window.WATCHLIST.has(ticker);
                if (isInList) {
                    window.WATCHLIST.remove(ticker);
                } else {
                    window.WATCHLIST.add(ticker, 'news');
                }
                setState();
            };

            setState();
            slot.appendChild(btn);
        });

        return item;
    }

    parseFinvizDate(dateString) {
        // Finviz dates are in US Eastern Time format: "2026-02-03 18:52:07"
        // Append EST to ensure correct parsing
        const dateWithTz = dateString + ' EST';
        const date = new Date(dateWithTz);

        // If that doesn't work (some browsers), parse manually
        if (isNaN(date.getTime())) {
            // Parse manually: YYYY-MM-DD HH:MM:SS
            const parts = dateString.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
            if (parts) {
                // Create date in UTC then adjust for EST offset
                // EST is UTC-5, EDT is UTC-4. For simplicity, assume EST (-5 hours)
                const utcDate = new Date(Date.UTC(
                    parseInt(parts[1]), // year
                    parseInt(parts[2]) - 1, // month (0-indexed)
                    parseInt(parts[3]), // day
                    parseInt(parts[4]), // hour
                    parseInt(parts[5]), // minute
                    parseInt(parts[6])  // second
                ));
                // Add 5 hours to convert from EST to UTC
                return new Date(utcDate.getTime() + (5 * 60 * 60 * 1000));
            }
        }

        return date;
    }

    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);

        const intervals = {
            year: 31536000,
            month: 2592000,
            week: 604800,
            day: 86400,
            hour: 3600,
            minute: 60
        };

        for (const [unit, secondsInUnit] of Object.entries(intervals)) {
            const interval = Math.floor(seconds / secondsInUnit);
            if (interval >= 1) {
                return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
            }
        }

        return 'Just now';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    parseTickers(tickerString) {
        return (tickerString || '')
            .split(/[\s,]+/)
            .map(t => t.trim().toUpperCase())
            .filter(t => t.length > 0);
    }

    renderError(message) {
        const container = document.getElementById('news-scanner-content');
        if (!container) return;

        container.innerHTML = `
            <div class="screener-error">
                <i data-lucide="alert-circle" style="width: 24px; height: 24px;"></i>
                <p>Failed to load news</p>
                <small>${message}</small>
                <button onclick="newsScanner.fetchNews()">Retry</button>
            </div>
        `;
        if (window.lucide) {
            lucide.createIcons();
        }
    }
}

// Global instance
window.newsScanner = new NewsScanner();

// Helper functions
function toggleCatalystFilter(catalyst) {
    const btn = event.target.closest('.catalyst-filter');
    btn.classList.toggle('active');
    newsScanner.updateFilter('catalysts', catalyst);
}

function applyNewsFilter(filterName, value) {
    // Convert to appropriate type
    let filterValue = value;
    if (value === '') {
        filterValue = null;
    } else if (!isNaN(value) && value !== '') {
        filterValue = parseFloat(value);
    }

    newsScanner.updateFilter(filterName, filterValue);
}

function applyTickerFilter(value) {
    const tickers = newsScanner.parseTickers(value);
    newsScanner.updateFilter('tickers', tickers);
    const input = document.getElementById('ticker-filter-input');
    if (input) input.value = tickers.join(', ');
    // Fetch ticker-specific news so we are not limited by the general feed
    newsScanner.fetchNews();
}

function clearTickerFilter() {
    newsScanner.updateFilter('tickers', []);
    const input = document.getElementById('ticker-filter-input');
    if (input) input.value = '';
    newsScanner.fetchNews();
}

function clearNewsFilters() {
    newsScanner.clearFilters();
}

function refreshNewsScanner() {
    newsScanner.fetchNews();
}
