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
            newsFreshness: null,
            newsType: [],
            scoreType: null,
            scoreMin: null,
            scoreMax: null,
            priceMin: null,
            priceMax: null,
            changeMin: null,
            volumeMin: null,
            floatMin: null,
            floatMax: null,
            marketCapMin: null,
            marketCapMax: null,
            relVolMin: null,
            sentimentScore: null,
            shortFloatPct: null,
            daysToCover: null,
            floatTradedPct: null,
            unusualOptions: null,
            minScore: null,
            tickersInput: ''
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

            const endpoint = `/api/finviz/news-scanner?${params}`;

            // First try with auth helper; if a 401/403 occurs, retry without auth headers in case
            // the route is public and the token/API key is missing or stale.
            let response = await AUTH.fetchSaxo(endpoint, { method: 'GET' });
            if (response.status === 401 || response.status === 403) {
                response = await fetch(endpoint, { method: 'GET' });
            }

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

    computeNewsFreshnessPass(dateStr) {
        if (!this.filters.newsFreshness) return true;
        const date = this.parseFinvizDate(dateStr);
        if (!date || isNaN(date.getTime())) return true;
        const diffMs = Date.now() - date.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);
        switch (this.filters.newsFreshness) {
            case 'breaking': return diffHours <= 1;
            case 'fresh1h': return diffHours <= 2;
            case 'today': return diffHours <= 24 && new Date().getDate() === date.getDate();
            case '24h': return diffHours <= 24;
            case '48h': return diffHours <= 48;
            case 'week': return diffHours <= 24 * 7;
            default: return true;
        }
    }

    computeStockScore(stock) {
        if (!stock) return 0;
        const price = parseFloat(stock.Price) || 0;
        const change = parseFloat((stock.Change || '').replace('%', '')) || 0;
        const volume = parseInt(stock.Volume) || 0;
        const relVol = parseFloat(stock['Rel Volume'] || stock['Relative Volume']) || 0;
        const atr = parseFloat(stock.ATR || stock['ATR (14)']) || 0;
        let score = 0;
        score += Math.min(relVol * 10, 25);
        score += Math.min(change + 10, 20);
        score += Math.min(volume / 1_000_000 * 2, 20);
        score += Math.min(atr * 5, 15);
        if (price >= 5 && price <= 150) score += 10;
        return Math.max(0, Math.min(100, score));
    }

    buildBadges(catalysts, score, stock) {
        const badges = [];
        if (score >= 75) badges.push({ label: 'High Expansion Potential', cls: 'badge-expansion' });
        if (score >= 60 && (stock?.['Rel Volume'] || stock?.['Relative Volume']) >= 2) badges.push({ label: 'Momentum Continuation', cls: 'badge-momentum' });
        const shortFloat = parseFloat(stock?.['Short Float'] || stock?.['Short Float %'] || stock?.['Short Interest']) || 0;
        const daysToCover = parseFloat(stock?.['Short Ratio'] || stock?.['Days to Cover']) || 0;
        if (shortFloat >= 10 || daysToCover >= 3) badges.push({ label: 'Squeeze Candidate', cls: 'badge-squeeze' });
        if (catalysts.includes('earnings')) badges.push({ label: 'Earnings Play', cls: 'badge-earnings' });
        if (catalysts.includes('guidance') || catalysts.includes('upgrade')) badges.push({ label: 'Reversal Candidate', cls: 'badge-reversal' });
        if (catalysts.includes('merger')) badges.push({ label: 'M&A', cls: 'badge-ma' });
        return badges;
    }

    applyUnifiedFilters(values) {
        this.filters = {
            ...this.filters,
            ...values,
            tickers: this.parseTickers(values.tickersInput || ''),
            catalysts: Array.isArray(values.newsType) ? values.newsType : [],
            scoreType: values.scoreType || null,
            scoreMin: values.scoreMin ?? values.minScore ?? null,
            scoreMax: values.scoreMax ?? null,
        };
        if (!this.newsData) return;
        // If tickers changed, refresh feed to get ticker-specific news
        if (values.tickersInput && values.tickersInput.length) {
            this.fetchNews();
        } else {
            this.applyFilters();
            this.render();
            this.updateFilterSummary();
        }
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

            // News freshness gate
            if (!this.computeNewsFreshnessPass(newsItem.Date)) return false;

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

            // News type filter (multi-select)
            if (Array.isArray(this.filters.newsType) && this.filters.newsType.length > 0) {
                if (!catalysts.some(c => this.filters.newsType.includes(c))) return false;
            }

            // If no stock data available, include if no stock filters are active
            if (!stock) {
                const hasStockFilters = this.filters.priceMin || this.filters.priceMax ||
                    this.filters.volumeMin || this.filters.floatMin || this.filters.floatMax ||
                    this.filters.marketCapMin || this.filters.marketCapMax || this.filters.relVolMin ||
                    this.filters.shortFloatPct || this.filters.daysToCover || this.filters.floatTradedPct ||
                    this.filters.minScore;
                return !hasStockFilters;
            }

            // Parse stock values
            const price = parseFloat(stock.Price);
            const change = parseFloat((stock.Change || '').replace('%', ''));
            const volume = parseInt(stock.Volume);
            const floatVal = parseFloat(stock['Float'] || stock['Shs Float']);
            const marketCap = parseFloat(stock['Market Cap']);
            const relVol = parseFloat(stock['Rel Volume'] || stock['Relative Volume']);
            const shortFloat = parseFloat(stock['Short Float'] || stock['Short Float %'] || stock['Short Interest']) || null;
            const daysToCover = parseFloat(stock['Short Ratio'] || stock['Days to Cover']) || null;
            const floatRotation = floatVal && volume ? (volume / (floatVal * 1_000_000)) * 100 : null;
            const stockScore = this.computeStockScore(stock);
            newsItem._score = stockScore;

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
            if (this.filters.shortFloatPct !== null && shortFloat !== null && shortFloat < this.filters.shortFloatPct) return false;
            if (this.filters.daysToCover !== null && daysToCover !== null && daysToCover < this.filters.daysToCover) return false;
            if (this.filters.floatTradedPct !== null && floatRotation !== null && floatRotation < this.filters.floatTradedPct) return false;
            if (this.filters.unusualOptions && stock['Unusual Options'] !== true) return false;
            const minScore = this.filters.scoreMin ?? this.filters.minScore;
            const maxScore = this.filters.scoreMax;
            if (minScore !== null && stockScore < minScore) return false;
            if (maxScore !== null && stockScore > maxScore) return false;

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
        // Keep legacy class for any existing hooks, add new structured class
        item.className = 'news-card news-scanner-item';

        // Time ago - parse Finviz date (US Eastern Time)
        const date = this.parseFinvizDate(newsItem.Date);
        const timeAgo = this.getTimeAgo(date);
        const timeStamp = date.toLocaleString();
        const freshnessBadge = `<span class="freshness-badge" title="${timeStamp}">${timeAgo}</span>`;

        // Handle multiple tickers (comma or space separated)
        const tickerString = newsItem.Ticker || '';
        const tickers = this.parseTickers(tickerString);

        // Primary stock/score for badges and chips
        const primaryStock = tickers.length ? this.stockData[tickers[0]] : null;
        const score = newsItem._score ?? this.computeStockScore(primaryStock);

        // Stock info section - display all tickers
        const stockBoxes = tickers.length ? tickers.map((ticker) => {
            const stock = this.stockData[ticker];
            const price = stock ? parseFloat(stock.Price) : null;
            const change = stock ? parseFloat((stock.Change || '').replace('%', '')) : null;
            const changeClass = change !== null && !isNaN(change) ? (change >= 0 ? 'positive' : 'negative') : '';
            const changeSign = change !== null && !isNaN(change) && change >= 0 ? '+' : '';
            const priceLabel = price !== null && !isNaN(price) ? `$${price.toFixed(2)}` : '--';
            const changeLabel = change !== null && !isNaN(change) ? `${changeSign}${change.toFixed(2)}%` : '--';
            const companyName = stock?.Name || stock?.Company || stock?.['Company Name'] || ticker;
            const scoreBadge = `<span class="score-badge" title="">${Math.round(score)}%</span>`;
            return `
                <div class="ticker-box" data-watchlist-slot="${ticker}" title="${companyName}">
                    <div class="ticker-top">
                        <span class="ticker-symbol">${ticker}</span>
                        <button class="news-star" type="button" data-ticker="${ticker}" aria-label="Toggle watchlist">
                            <i data-lucide="star"></i>
                        </button>
                    </div>
                    <div class="ticker-bottom">
                        <div class="price-line">
                            <span class="price">${priceLabel}</span>
                            <span class="change ${changeClass}">${changeLabel}</span>
                        </div>
                        ${scoreBadge}
                    </div>
                </div>
            `;
        }).join('') : `
            <div class="ticker-box" data-watchlist-slot="N/A" title="No ticker provided">
                <div class="ticker-top">
                    <span class="ticker-symbol">N/A</span>
                </div>
                <div class="ticker-bottom">
                    <div class="price-line">
                        <span class="price">--</span>
                        <span class="change">--</span>
                    </div>
                    <span class="score-badge">--</span>
                </div>
            </div>
        `;

        const stockInfoHTML = `
            <div class="news-left">
                <div class="ticker-grid">
                    ${stockBoxes}
                </div>
            </div>
        `;

        // Catalyst badges
        const catalystBadges = catalysts.map(c =>
            `<span class="catalyst-badge catalyst-${c}">${c}</span>`
        ).join('');
        const stock = primaryStock;
        const tagBadges = this.buildBadges(catalysts, score, stock).map(b =>
            `<span class="tag-badge ${b.cls}">${b.label}</span>`
        ).join('');
        const relVol = primaryStock ? (primaryStock['Rel Volume'] || primaryStock['Relative Volume']) : null;
        const changeVal = primaryStock ? parseFloat((primaryStock.Change || '').replace('%', '')) : null;
        const vol = primaryStock ? primaryStock.Volume : null;
        const atr = primaryStock ? primaryStock.ATR || primaryStock['ATR (14)'] : null;
        const scoreTooltip = `RelVol: ${relVol ?? 'n/a'}, Change: ${changeVal ?? 'n/a'}%, Volume: ${vol ?? 'n/a'}, ATR: ${atr ?? 'n/a'}`;
        const scoreDetailTooltip = `Catalyst: ${catalysts.join(', ') || 'n/a'} | Sentiment: ${newsItem.Sentiment ?? 'n/a'} | Freshness: ${timeAgo} | Factors: ${scoreTooltip}`;

        item.innerHTML = `
            ${stockInfoHTML}
            <div class="news-right">
                <div class="news-topline">
                    ${catalystBadges}
                    ${tagBadges}
                    <span class="news-source">${newsItem.Source}</span>
                    <span class="news-time" title="${timeStamp}">${timeAgo}</span>
                    ${freshnessBadge}
                </div>
                <div class="news-headline" title="${this.escapeHtml(newsItem.Title)}">
                    <a href="#" onclick="openNewsModal('${newsItem.Url}', '${this.escapeHtml(newsItem.Title).replace(/'/g, "\\'")}'); return false;">
                        ${this.escapeHtml(newsItem.Title)}
                    </a>
                </div>
            </div>
        `;

        // Add star watchlist controls
        tickers.forEach((ticker) => {
            const btn = item.querySelector(`.news-star[data-ticker="${ticker}"]`);
            if (!btn || !window.WATCHLIST) return;
            const sync = () => {
                const active = window.WATCHLIST.has(ticker);
                btn.classList.toggle('active', active);
                btn.title = active ? 'Remove from watchlist' : 'Add to watchlist';
            };
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const active = window.WATCHLIST.has(ticker);
                if (active) {
                    window.WATCHLIST.remove(ticker);
                } else {
                    window.WATCHLIST.add(ticker, 'news');
                }
                sync();
            });
            sync();
        });

        // Add tooltip to score badges (absolute, non-shifting)
        item.querySelectorAll('.score-badge').forEach((badge) => {
            badge.removeAttribute('title');
            badge.setAttribute('data-tooltip', scoreDetailTooltip);
            badge.setAttribute('aria-label', scoreDetailTooltip);
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
function initUnifiedNewsFilters() {
    if (!window.FilterFramework || !window.FilterConfigs || !window.FilterLayoutConfig) return;
    const container = document.getElementById('unified-filter-panel');
    if (!container) return;

    const sectionIds = ['liquidity', 'volatility', 'structure', 'catalyst', 'squeeze'];
    const schema = FilterConfigs.buildSchema(sectionIds);
    schema.sections.quick = {
        id: 'quick',
        title: 'Ticker & Score',
        fields: [
            { id: 'tickersInput', label: 'Tickers', type: 'text', placeholder: 'e.g. NVDA, TSLA' },
            { id: 'scoreType', label: 'Score Type', type: 'select', options: [
                { value: '', label: 'Any' },
                { value: 'expansion', label: 'Expansion' },
                { value: 'momentum', label: 'Momentum' },
                { value: 'squeeze', label: 'Squeeze' },
                { value: 'liquidity', label: 'Liquidity' },
            ] },
            { id: 'scoreMin', label: 'Score Min', type: 'slider', min: 0, max: 100, step: 5, format: (v) => `${v}%` },
            { id: 'scoreMax', label: 'Score Max', type: 'slider', min: 0, max: 100, step: 5, format: (v) => `${v}%` },
        ],
    };

    const defaults = {
        ...FilterConfigs.defaultValues(sectionIds),
        tickersInput: '',
        scoreType: '',
        scoreMin: null,
        scoreMax: null,
    };

    const pageConfig = window.FilterLayoutConfig.pages['news-scanner'] || {};
    const tabOrder = pageConfig.tabOrder || Object.keys(schema.sections || {});
    const tabSections = pageConfig.sectionMap || tabOrder.reduce((acc, tabId) => {
        acc[tabId] = [tabId];
        return acc;
    }, {});
    const tabLabels = tabOrder.reduce((acc, tabId) => {
        const label = window.FilterLayoutConfig.tabs?.[tabId]?.label || tabId;
        acc[tabId] = { label };
        return acc;
    }, {});

    window.newsFilterState = FilterFramework.createTabbedFilterPanel(container, {
        pageKey: pageConfig.pageKey || 'news-scanner',
        title: 'News Filters',
        schema,
        defaults,
        weights: { catalyst: 1.2, liquidity: 1, volatility: 1 },
        layoutConfig: window.FilterLayoutConfig.layout,
        tabOrder,
        tabSections,
        tabLabels,
        scoringPlacement: 'none',
        onApply: (vals) => window.newsScanner.applyUnifiedFilters(vals),
    });
}
