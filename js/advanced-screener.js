// Advanced Stock Screener Module
// Comprehensive screening with multiple views and extensive filters

class AdvancedScreener {
    constructor() {
        this.data = null;
        this.filteredData = null;
        this.isLoading = false;
        this.currentView = 'overview';
        this.sortColumn = null;
        this.sortDirection = 'desc';
        this.newsSnippetCache = {};
        this.newsPopover = null;

        // Define all available views and their columns (using actual Finviz column names)
        // Each view maps to a Finviz view parameter
        this.views = {
            overview: {
                name: 'Overview',
                viewParam: '111',
                columns: ['Ticker', 'Company', 'Sector', 'Industry', 'Country', 'Market Cap', 'Price', 'Change', 'Volume']
            },
            valuation: {
                name: 'Valuation',
                viewParam: '121',
                columns: ['Ticker', 'Market Cap', 'P/E', 'Forward P/E', 'PEG', 'P/S', 'P/B', 'P/C', 'P/FCF']
            },
            financial: {
                name: 'Financial',
                viewParam: '161',
                columns: ['Ticker', 'Market Cap', 'Dividend %', 'ROA', 'ROE', 'ROI', 'Current Ratio', 'Quick Ratio', 'LT Debt/Eq', 'Debt/Eq']
            },
            ownership: {
                name: 'Ownership',
                viewParam: '131',
                columns: ['Ticker', 'Market Cap', 'Outstanding', 'Float', 'Insider Own', 'Insider Trans', 'Inst Own', 'Inst Trans', 'Short Float', 'Short Ratio']
            },
            performance: {
                name: 'Performance',
                viewParam: '141',
                columns: ['Ticker', 'Perf Week', 'Perf Month', 'Perf Quart', 'Perf Half', 'Perf Year', 'Perf YTD', 'Volatility W', 'Volatility M', 'Avg Volume']
            },
            technical: {
                name: 'Technical',
                viewParam: '171',
                columns: ['Ticker', 'Beta', 'ATR', 'SMA20', 'SMA50', 'SMA200', '52W High', '52W Low', 'RSI', 'Price', 'Change', 'Volume']
            }
        };

        // Comprehensive filter definitions matching Finviz Elite
        this.filterDefinitions = {
            // Descriptive
            'Exchange': { type: 'multiselect', options: ['NYSE', 'NASDAQ', 'AMEX'], section: 'Descriptive' },
            'Market Cap': { type: 'multiselect', options: ['Mega ($200bln+)', 'Large ($10-200bln)', 'Mid ($2-10bln)', 'Small ($300mln-2bln)', 'Micro (<$300mln)'], section: 'Descriptive' },
            'Sector': { type: 'multiselect', options: ['Basic Materials', 'Communication Services', 'Consumer Cyclical', 'Consumer Defensive', 'Energy', 'Financial', 'Healthcare', 'Industrials', 'Real Estate', 'Technology', 'Utilities'], section: 'Descriptive' },
            'Industry': { type: 'multiselect', options: [], section: 'Descriptive' },
            'Country': { type: 'multiselect', options: ['USA', 'Foreign'], section: 'Descriptive' },

            // Fundamental
            'P/E': { type: 'select', options: ['Any', 'Low (<15)', 'Profitable (>0)', 'High (>50)', 'Under 5', 'Under 10', 'Under 15', 'Under 20', 'Under 25', 'Under 30', 'Under 35', 'Under 40', 'Under 45', 'Under 50', 'Over 5', 'Over 10', 'Over 15', 'Over 20', 'Over 25', 'Over 30', 'Over 35', 'Over 40', 'Over 45', 'Over 50'], section: 'Fundamental' },
            'Forward P/E': { type: 'select', options: ['Any', 'Low (<15)', 'Profitable (>0)', 'High (>50)', 'Under 5', 'Under 10', 'Under 15', 'Under 20', 'Under 25', 'Over 5', 'Over 10', 'Over 15', 'Over 20', 'Over 25'], section: 'Fundamental' },
            'PEG': { type: 'select', options: ['Any', 'Low (<1)', 'High (>2)', 'Under 1', 'Under 2', 'Under 3', 'Over 1', 'Over 2', 'Over 3'], section: 'Fundamental' },
            'P/S': { type: 'select', options: ['Any', 'Low (<1)', 'High (>10)', 'Under 1', 'Under 2', 'Under 3', 'Under 4', 'Under 5', 'Under 10', 'Over 1', 'Over 2', 'Over 3', 'Over 4', 'Over 5', 'Over 10'], section: 'Fundamental' },
            'P/B': { type: 'select', options: ['Any', 'Low (<1)', 'High (>5)', 'Under 1', 'Under 2', 'Under 3', 'Under 4', 'Under 5', 'Over 1', 'Over 2', 'Over 3', 'Over 4', 'Over 5'], section: 'Fundamental' },
            'Price/Cash': { type: 'select', options: ['Any', 'Low (<3)', 'High (>50)', 'Under 1', 'Under 2', 'Under 3', 'Under 5', 'Under 10', 'Over 1', 'Over 2', 'Over 3', 'Over 5', 'Over 10', 'Over 50'], section: 'Fundamental' },
            'Price/Free Cash Flow': { type: 'select', options: ['Any', 'Low (<15)', 'High (>50)', 'Under 5', 'Under 10', 'Under 15', 'Under 20', 'Under 25', 'Under 30', 'Under 35', 'Under 40', 'Under 45', 'Under 50', 'Over 5', 'Over 10', 'Over 15', 'Over 20', 'Over 25', 'Over 30', 'Over 35', 'Over 40', 'Over 45', 'Over 50'], section: 'Fundamental' },
            'Dividend Yield': { type: 'select', options: ['Any', 'None (0%)', 'Positive (>0%)', 'High (>5%)', 'Very High (>10%)', 'Over 1%', 'Over 2%', 'Over 3%', 'Over 4%', 'Over 5%', 'Over 6%', 'Over 7%', 'Over 8%', 'Over 9%', 'Over 10%'], section: 'Fundamental' },

            // Technical
            'Price Min': { type: 'number', section: 'Technical', placeholder: 'Min' },
            'Price Max': { type: 'number', section: 'Technical', placeholder: 'Max' },
            'Change % Min': { type: 'number', section: 'Technical', placeholder: 'Min %' },
            'Change % Max': { type: 'number', section: 'Technical', placeholder: 'Max %' },
            'Volume Min': { type: 'number', section: 'Technical', placeholder: 'Min' },
            'Rel Volume': { type: 'select', options: ['Any', 'Over 0.1', 'Over 0.2', 'Over 0.3', 'Over 0.4', 'Over 0.5', 'Over 0.75', 'Over 1', 'Over 1.5', 'Over 2', 'Over 3', 'Over 4', 'Over 5', 'Over 10'], section: 'Technical' },
            'Avg Volume': { type: 'select', options: ['Any', 'Under 50K', 'Under 100K', 'Under 500K', 'Under 750K', 'Under 1M', 'Over 50K', 'Over 100K', 'Over 200K', 'Over 300K', 'Over 400K', 'Over 500K', 'Over 750K', 'Over 1M', 'Over 2M'], section: 'Technical' },
            'Float': { type: 'select', options: ['Any', 'Low (<50M)', 'High (>500M)', 'Under 10M', 'Under 20M', 'Under 50M', 'Under 100M', 'Under 500M', 'Over 10M', 'Over 20M', 'Over 50M', 'Over 100M', 'Over 200M', 'Over 500M'], section: 'Technical' },
            'Performance': { type: 'select', options: ['Any', 'Up', 'Down', 'Up 1%', 'Up 5%', 'Up 10%', 'Up 15%', 'Up 20%', 'Up 25%', 'Up 30%', 'Down 1%', 'Down 5%', 'Down 10%', 'Down 15%', 'Down 20%', 'Down 25%', 'Down 30%'], section: 'Technical' },
            'Performance 2': { type: 'select', options: ['Any', 'Today Up', 'Today Down', 'Today +1%', 'Today -1%', 'Today +5%', 'Today -5%', 'Week Up', 'Week Down', 'Month Up', 'Month Down'], section: 'Technical' },
            'Volatility': { type: 'select', options: ['Any', 'Week - Over 3%', 'Week - Over 4%', 'Week - Over 5%', 'Week - Over 10%', 'Month - Over 3%', 'Month - Over 4%', 'Month - Over 5%', 'Month - Over 10%'], section: 'Technical' },
            'RSI (14)': { type: 'select', options: ['Any', 'Overbought (90)', 'Overbought (80)', 'Overbought (70)', 'Overbought (60)', 'Oversold (40)', 'Oversold (30)', 'Oversold (20)', 'Oversold (10)', 'Not Overbought (<60)', 'Not Overbought (<50)'], section: 'Technical' },
            'Gap': { type: 'select', options: ['Any', 'Up', 'Up 1%', 'Up 2%', 'Up 3%', 'Up 4%', 'Up 5%', 'Down', 'Down 1%', 'Down 2%', 'Down 3%', 'Down 4%', 'Down 5%'], section: 'Technical' },
            '20-Day SMA': { type: 'select', options: ['Any', 'Price above SMA20', 'Price below SMA20', 'Price crossed SMA20', 'Price crossed SMA20 above', 'Price crossed SMA20 below', 'SMA20 above SMA50', 'SMA20 below SMA50', 'SMA20 crossed SMA50', 'SMA20 crossed SMA50 above', 'SMA20 crossed SMA50 below'], section: 'Technical' },
            '50-Day SMA': { type: 'select', options: ['Any', 'Price above SMA50', 'Price below SMA50', 'Price crossed SMA50', 'Price crossed SMA50 above', 'Price crossed SMA50 below', 'SMA50 above SMA200', 'SMA50 below SMA200', 'SMA50 crossed SMA200', 'SMA50 crossed SMA200 above', 'SMA50 crossed SMA200 below'], section: 'Technical' },
            '200-Day SMA': { type: 'select', options: ['Any', 'Price above SMA200', 'Price below SMA200', 'Price crossed SMA200', 'Price crossed SMA200 above', 'Price crossed SMA200 below'], section: 'Technical' },
            'Change from Open': { type: 'select', options: ['Any', 'Up', 'Up 1%', 'Up 2%', 'Up 3%', 'Up 4%', 'Up 5%', 'Down', 'Down 1%', 'Down 2%', 'Down 3%', 'Down 4%', 'Down 5%'], section: 'Technical' },
            '20-Day High/Low': { type: 'select', options: ['Any', 'New High', 'New Low', '0-3% below High', '0-5% below High', '0-10% below High', '0-3% above Low', '0-5% above Low', '0-10% above Low'], section: 'Technical' },
            '50-Day High/Low': { type: 'select', options: ['Any', 'New High', 'New Low', '0-3% below High', '0-5% below High', '0-10% below High', '0-3% above Low', '0-5% above Low', '0-10% above Low'], section: 'Technical' },
            '52-Week High/Low': { type: 'select', options: ['Any', 'New High', 'New Low', '0-3% below High', '0-5% below High', '0-10% below High', '0-15% below High', '0-20% below High', '0-3% above Low', '0-5% above Low', '0-10% above Low', '0-15% above Low', '0-20% above Low'], section: 'Technical' },
            'Pattern': { type: 'select', options: ['Any', 'Horizontal S/R', 'Horizontal S/R (Strong)', 'TL Resistance', 'TL Resistance (Strong)', 'TL Support', 'TL Support (Strong)', 'Wedge Up', 'Wedge Down', 'Triangle Ascending', 'Triangle Descending', 'Channel Up', 'Channel Down', 'Channel Up (Strong)', 'Channel Down (Strong)'], section: 'Technical' },
            'Candlestick': { type: 'select', options: ['Any', 'Long Lower Shadow', 'Long Upper Shadow', 'Hammer', 'Inverted Hammer', 'Spinning Top White', 'Spinning Top Black', 'Doji', 'Dragonfly Doji', 'Gravestone Doji', 'Marubozu White', 'Marubozu Black'], section: 'Technical' },
            'Beta': { type: 'select', options: ['Any', 'Under 0', 'Under 0.5', 'Under 1', 'Under 1.5', 'Under 2', 'Over 0', 'Over 0.5', 'Over 1', 'Over 1.5', 'Over 2', 'Over 2.5', 'Over 3', 'Over 4'], section: 'Technical' },
            'ATR': { type: 'select', options: ['Any', 'Over 0.25', 'Over 0.5', 'Over 0.75', 'Over 1', 'Over 1.5', 'Over 2', 'Over 2.5', 'Over 3', 'Over 3.5', 'Over 4', 'Over 4.5', 'Over 5', 'Under 0.25', 'Under 0.5', 'Under 0.75', 'Under 1', 'Under 1.5', 'Under 2'], section: 'Technical' },

            // News Filter
            'News Freshness': { type: 'select', options: ['Any', 'Breaking (<30m)', 'Very Fresh (<1h)', 'Fresh (<6h)', 'Recent (<24h)', 'This Week (<5d)', 'This Month (<30d)'], section: 'News' }
        };

        this.filters = {};
        this.presets = this.loadPresets();
        this.newsData = {}; // Store news data by ticker
        this.newsFreshnessFilter = null; // Track active news freshness filter
        this.filterSchema = null;
        this.filterState = null;
    }

    init() {
        this.ensureNewsPopover();
        this.renderTabs();
        this.initFilterLayout();
        this.renderNewsLegend();
    }

    buildFilterSchema() {
        const sections = {};
        Object.entries(this.filterDefinitions).forEach(([filterName, def]) => {
            const sectionId = def.section || 'Other';
            if (!sections[sectionId]) {
                sections[sectionId] = { id: sectionId, title: sectionId, fields: [] };
            }

            const field = { id: filterName, label: filterName };
            if (def.type === 'multiselect') {
                field.type = 'multi';
                field.options = (def.options || []).map((opt) => ({ value: opt, label: opt }));
            } else if (def.type === 'select') {
                field.type = 'select';
                field.options = (def.options || []).map((opt) => ({ value: opt === 'Any' ? '' : opt, label: opt }));
            } else if (def.type === 'number') {
                field.type = 'number';
                field.placeholder = def.placeholder || '';
                field.step = 'any';
            }

            sections[sectionId].fields.push(field);
        });

        return { sections };
    }

    buildFilterDefaults(schema) {
        const defaults = {};
        Object.values(schema.sections || {}).forEach((section) => {
            (section.fields || []).forEach((field) => {
                defaults[field.id] = field.type === 'multi' ? [] : null;
            });
        });
        return defaults;
    }

    initFilterLayout() {
        if (!window.FilterFramework || !window.FilterLayoutConfig) return;
        this.filterSchema = this.buildFilterSchema();
        const defaults = this.buildFilterDefaults(this.filterSchema);

        const pageConfig = window.FilterLayoutConfig.pages['advanced-screener'] || {};
        const tabOrder = pageConfig.tabOrder || Object.keys(this.filterSchema.sections || {});
        const tabSections = pageConfig.sectionMap || tabOrder.reduce((acc, tabId) => {
            acc[tabId] = [tabId];
            return acc;
        }, {});

        const tabLabels = tabOrder.reduce((acc, tabId) => {
            const label = window.FilterLayoutConfig.tabs?.[tabId]?.label || tabId;
            acc[tabId] = { label };
            return acc;
        }, {});

        const panelContainer = document.getElementById('filtersPanel');
        if (!panelContainer) return;

        this.filterState = FilterFramework.createTabbedFilterPanel(panelContainer, {
            pageKey: pageConfig.pageKey || 'advanced-screener',
            title: 'Filter Engine',
            schema: this.filterSchema,
            defaults,
            layoutConfig: window.FilterLayoutConfig.layout,
            tabOrder,
            tabSections,
            tabLabels,
            scoringPlacement: 'none',
            onApply: (values) => this.applyAllFilters(values),
            onChange: (snapshot) => {
                this.filters = { ...snapshot.values };
            },
        });
    }

    ensureNewsPopover() {
        if (this.newsPopover) return;
        const pop = document.createElement('div');
        pop.className = 'news-popover';
        pop.id = 'newsPopover';
        document.body.appendChild(pop);
        this.newsPopover = pop;
    }

    // News freshness indicators
    async fetchNewsForTickers(tickers) {
        if (!tickers || tickers.length === 0) return;

        try {
            // Fetch news for all visible tickers in batches
            const batchSize = 100;
            this.newsData = {};

            for (let i = 0; i < tickers.length; i += batchSize) {
                const batch = tickers.slice(i, i + batchSize);
                const tickerString = batch.join(',');

                const response = await AUTH.fetchSaxo(`/api/finviz/news-scanner?v=3&c=1&t=${tickerString}`, {
                    method: 'GET'
                });

                if (response.ok) {
                    const newsItems = await response.json();

                    // Group news by ticker and get the most recent for each
                    newsItems.forEach(item => {
                        const ticker = item.Ticker;
                        if (!ticker) return;

                        const newsDate = this.parseFinvizDate(item.Date);

                        if (!this.newsData[ticker] || newsDate > this.newsData[ticker].date) {
                            this.newsData[ticker] = {
                                date: newsDate,
                                title: item.Title,
                                url: item.Url
                            };
                        }
                    });
                } else {
                    console.warn(`Failed to fetch news for batch ${i}-${i + batchSize}: ${response.status}`);
                }
            }

            console.log(`Fetched news for ${Object.keys(this.newsData).length} stocks out of ${tickers.length} requested`);
        } catch (error) {
            console.warn('Failed to fetch news data:', error);
        }
    }

    parseFinvizDate(dateString) {
        // Finviz dates are in US Eastern Time format: "2026-02-03 18:52:07"
        const dateWithTz = dateString + ' EST';
        const date = new Date(dateWithTz);

        if (isNaN(date.getTime())) {
            const parts = dateString.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
            if (parts) {
                const utcDate = new Date(Date.UTC(
                    parseInt(parts[1]), parseInt(parts[2]) - 1, parseInt(parts[3]),
                    parseInt(parts[4]), parseInt(parts[5]), parseInt(parts[6])
                ));
                return new Date(utcDate.getTime() + (5 * 60 * 60 * 1000));
            }
        }
        return date;
    }

    getNewsIndicator(ticker) {
        const newsItem = this.newsData[ticker];
        if (!newsItem) return null;

        const now = new Date();
        const ageMinutes = Math.floor((now - newsItem.date) / (1000 * 60));
        const ageHours = Math.floor(ageMinutes / 60);
        const ageDays = Math.floor(ageHours / 24);

        let icon, color, label;

        if (ageMinutes < 30) {
            icon = '🔥';
            color = '#ff4444'; // Bright red
            label = 'Breaking (<30m)';
        } else if (ageMinutes < 60) {
            icon = '🔴';
            color = '#ff6b6b';
            label = 'Very Fresh (<1h)';
        } else if (ageHours < 6) {
            icon = '🟠';
            color = '#ff8c42';
            label = 'Fresh (<6h)';
        } else if (ageHours < 24) {
            icon = '🟡';
            color = '#ffd93d';
            label = 'Recent (<24h)';
        } else if (ageDays < 2) {
            icon = '🟢';
            color = '#6bcf7f';
            label = 'Today/Yesterday';
        } else if (ageDays < 5) {
            icon = '🔵';
            color = '#4d96ff';
            label = 'This Week';
        } else if (ageDays < 7) {
            icon = '🟣';
            color = '#9b59b6';
            label = 'Last Week';
        } else if (ageDays < 14) {
            icon = '🟤';
            color = '#95a5a6';
            label = 'Last 2 Weeks';
        } else if (ageDays < 30) {
            icon = '⚪';
            color = '#bdc3c7';
            label = 'Last Month';
        } else {
            return null; // Don't show indicator for news older than 1 month
        }

        return { icon, color, label, title: newsItem.title, url: newsItem.url };
    }

    async fetchNewsSnippet(url) {
        if (!url) return null;
        if (this.newsSnippetCache[url]) return this.newsSnippetCache[url];

        try {
            const response = await fetch(`/api/news/snippet?url=${encodeURIComponent(url)}`);
            if (!response.ok) return null;
            const data = await response.json();
            const snippet = (data && data.snippet) ? data.snippet : null;
            this.newsSnippetCache[url] = snippet || '';
            return snippet;
        } catch (error) {
            console.warn('Failed to fetch news snippet:', error);
            this.newsSnippetCache[url] = '';
            return null;
        }
    }

    showNewsPopover(content, position) {
        if (!this.newsPopover) this.ensureNewsPopover();
        if (!this.newsPopover) return;

        const { title, meta, snippet } = content;
        this.newsPopover.innerHTML = `
            <div class="news-popover__meta">${this.escapeHtml(meta || '')}</div>
            <div class="news-popover__title">${this.escapeHtml(title || '')}</div>
            <div class="news-popover__snippet">${this.escapeHtml(snippet || 'No preview available yet.')}</div>
        `;

        this.newsPopover.style.display = 'block';
        this.positionNewsPopover(position);
    }

    hideNewsPopover() {
        if (this.newsPopover) {
            this.newsPopover.style.display = 'none';
        }
    }

    positionNewsPopover(position) {
        if (!this.newsPopover || !position) return;
        const { x, y } = position;
        const popover = this.newsPopover;
        const offset = 14;

        let left = x + offset;
        let top = y + offset;

        // Prevent overflow on the right/bottom
        const rect = popover.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (left + rect.width > viewportWidth - 8) {
            left = viewportWidth - rect.width - 8;
        }
        if (top + rect.height > viewportHeight - 8) {
            top = viewportHeight - rect.height - 8;
        }

        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    }

    async handleTickerHover(event, stock, newsIndicator) {
        if (!newsIndicator) {
            this.hideNewsPopover();
            return;
        }

        const baseContent = {
            meta: newsIndicator.label,
            title: `${stock.Ticker} · ${newsIndicator.title}`,
            snippet: 'Loading story preview...'
        };

        this.showNewsPopover(baseContent, { x: event.clientX, y: event.clientY });

        const snippet = await this.fetchNewsSnippet(newsIndicator.url);
        this.showNewsPopover({
            meta: newsIndicator.label,
            title: `${stock.Ticker} · ${newsIndicator.title}`,
            snippet: snippet || 'No preview available yet.'
        }, { x: event.clientX, y: event.clientY });
    }

    escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    renderNewsLegend() {
        const container = document.getElementById('newsLegendContainer');
        if (!container) return;

        const freshnessCriteria = [
            { icon: '🔥', label: 'Breaking', maxMinutes: 30, title: 'Breaking news (under 30 minutes)' },
            { icon: '🔴', label: '<1h', maxMinutes: 60, title: 'Very fresh (under 1 hour)' },
            { icon: '🟠', label: '<6h', maxHours: 6, title: 'Fresh (under 6 hours)' },
            { icon: '🟡', label: '<24h', maxHours: 24, title: 'Recent (under 24 hours)' },
            { icon: '🟢', label: '<2d', maxDays: 2, title: 'Today/Yesterday' },
            { icon: '🔵', label: '<5d', maxDays: 5, title: 'This week' },
            { icon: '🟣', label: '<7d', maxDays: 7, title: 'Last week' },
            { icon: '🟤', label: '<14d', maxDays: 14, title: 'Last 2 weeks' },
            { icon: '⚪', label: '<30d', maxDays: 30, title: 'Last month' }
        ];

        const activeFilter = this.newsFreshnessFilter;

        container.innerHTML = `
            <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap; font-size: 0.75em; color: var(--text-secondary);">
                <strong style="color: var(--text-primary);">News Freshness (click to filter):</strong>
                ${freshnessCriteria.map((criteria, index) => `
                    <span
                        onclick="advancedScreener.filterByNewsFreshness(${index})"
                        style="cursor: pointer; padding: 4px 8px; border-radius: 4px; transition: all 0.2s; ${activeFilter === index ? 'background: var(--accent-blue); color: white; font-weight: bold;' : ''}"
                        title="${criteria.title} - Click to filter"
                        onmouseover="this.style.background = '${activeFilter === index ? 'var(--accent-blue)' : 'var(--bg-card-hover)'}'"
                        onmouseout="this.style.background = '${activeFilter === index ? 'var(--accent-blue)' : 'transparent'}'"
                    >${criteria.icon} ${criteria.label}</span>
                `).join('')}
                <span
                    onclick="advancedScreener.clearNewsFreshnessFilter()"
                    style="cursor: pointer; padding: 4px 8px; border-radius: 4px; color: var(--accent-red); font-weight: ${activeFilter === null ? 'normal' : 'bold'};"
                    title="Clear news filter"
                >✕ Clear</span>
            </div>
        `;
    }

    filterByNewsFreshness(criteriaIndex) {
        const freshnessCriteria = [
            { maxMinutes: 30 },
            { maxMinutes: 60 },
            { maxHours: 6 },
            { maxHours: 24 },
            { maxDays: 2 },
            { maxDays: 5 },
            { maxDays: 7 },
            { maxDays: 14 },
            { maxDays: 30 }
        ];

        // Toggle filter if clicking the same one
        if (this.newsFreshnessFilter === criteriaIndex) {
            this.clearNewsFreshnessFilter();
            return;
        }

        this.newsFreshnessFilter = criteriaIndex;
        const criteria = freshnessCriteria[criteriaIndex];

        if (!this.data) return;

        // Filter stocks by news freshness
        this.filteredData = this.data.filter(stock => {
            const newsItem = this.newsData[stock.Ticker];
            if (!newsItem) return false;

            const now = new Date();
            const ageMinutes = Math.floor((now - newsItem.date) / (1000 * 60));
            const ageHours = Math.floor(ageMinutes / 60);
            const ageDays = Math.floor(ageHours / 24);

            if (criteria.maxMinutes) {
                return ageMinutes < criteria.maxMinutes;
            } else if (criteria.maxHours) {
                return ageHours < criteria.maxHours;
            } else if (criteria.maxDays) {
                return ageDays < criteria.maxDays;
            }

            return false;
        });

        // Sort by news freshness (most recent first)
        this.filteredData.sort((a, b) => {
            const newsA = this.newsData[a.Ticker];
            const newsB = this.newsData[b.Ticker];
            if (!newsA) return 1;
            if (!newsB) return -1;
            return newsB.date - newsA.date;
        });

        this.render();
        this.renderNewsLegend();
    }

    clearNewsFreshnessFilter() {
        this.newsFreshnessFilter = null;
        this.filteredData = this.data;
        this.render();
        this.renderNewsLegend();
    }

    // Preset management
    loadPresets() {
        const saved = localStorage.getItem('advancedScreenerPresets');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error('Failed to load presets:', e);
            }
        }
        // Default presets
        return {
            'Small Cap Momentum': {
                'Market Cap': ['Small ($300mln-2bln)', 'Micro (<$300mln)'],
                'Change % Min': '5',
                'Volume Min': '500000'
            },
            'Mid-Large Cap Value': {
                'Market Cap': ['Mid ($2-10bln)', 'Large ($10-200bln)'],
                'P/E': 'Low (<15)',
                'Dividend Yield': 'Positive (>0%)'
            },
            'High Volume Breakouts': {
                'Rel Volume': 'Over 2',
                'Change % Min': '3',
                'Volume Min': '1000000'
            }
        };
    }

    savePresets() {
        localStorage.setItem('advancedScreenerPresets', JSON.stringify(this.presets));
    }

    saveCurrentAsPreset(presetName) {
        if (!presetName || presetName.trim() === '') return;
        this.presets[presetName] = { ...this.filters };
        this.savePresets();
        this.renderPresets();
    }

    loadPreset(presetName) {
        const preset = this.presets[presetName];
        if (!preset) return;

        // Clear current filters
        this.clearAllFilters();

        // Apply preset filters
        this.filters = { ...preset };

        // Update UI
        Object.entries(this.filters).forEach(([filterName, value]) => {
            const inputs = document.querySelectorAll(`[data-filter="${filterName}"]`);
            inputs.forEach(input => {
                if (input.type === 'checkbox') {
                    // Multi-select checkbox
                    const values = Array.isArray(value) ? value : [value];
                    input.checked = values.includes(input.value);
                } else if (input.tagName === 'SELECT') {
                    input.value = value;
                } else {
                    input.value = value;
                }
            });
        });

        this.applyAllFilters();
    }

    deletePreset(presetName) {
        delete this.presets[presetName];
        this.savePresets();
        this.renderPresets();
    }

    renderPresets() {
        const container = document.getElementById('presetsContainer');
        if (!container) return;

        container.innerHTML = `
            <div style="margin-bottom: 12px;">
                <label style="display: block; margin-bottom: 4px; font-size: 0.85em; color: var(--text-secondary);">Filter Presets</label>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${Object.keys(this.presets).map(presetName => `
                        <button class="btn-preset" onclick="advancedScreener.loadPreset('${presetName}')" title="Load preset">
                            ${presetName}
                        </button>
                    `).join('')}
                </div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <input type="text" id="newPresetName" class="filter-input" placeholder="Preset name..." style="flex: 1;">
                <button class="btn-primary" onclick="advancedScreener.saveCurrentAsPreset(document.getElementById('newPresetName').value); document.getElementById('newPresetName').value = '';" style="padding: 6px 12px; font-size: 0.85em;">
                    Save Current
                </button>
            </div>
        `;
    }

    renderTabs() {
        const container = document.getElementById('tabsContainer');
        container.innerHTML = '';

        Object.keys(this.views).forEach(viewKey => {
            const view = this.views[viewKey];
            const tab = document.createElement('button');
            tab.className = `tab ${viewKey === this.currentView ? 'active' : ''}`;
            tab.textContent = view.name;
            tab.onclick = () => this.switchView(viewKey);
            container.appendChild(tab);
        });
    }

    renderFilters() {
        const container = document.getElementById('filterSections');
        container.innerHTML = '';

        // Group filters by section
        const sections = {};
        Object.entries(this.filterDefinitions).forEach(([filterName, def]) => {
            const sectionName = def.section || 'Other';
            if (!sections[sectionName]) {
                sections[sectionName] = [];
            }
            sections[sectionName].push(filterName);
        });

        // Render each section
        Object.entries(sections).forEach(([sectionName, filterNames]) => {
            const section = document.createElement('div');
            section.className = 'filter-section';
            section.innerHTML = `<h4>${sectionName}</h4>`;

            // Create a grid container for the filters in this section
            const sectionGrid = document.createElement('div');
            sectionGrid.className = 'filter-section-grid';

            filterNames.forEach(filterName => {
                const def = this.filterDefinitions[filterName];
                const filterRow = document.createElement('div');

                const label = document.createElement('label');
                label.textContent = filterName;
                label.style.display = 'block';
                label.style.marginBottom = '6px';
                label.style.fontSize = '0.85em';
                label.style.color = 'var(--text-secondary)';
                label.style.fontWeight = '600';

                filterRow.appendChild(label);

                if (def.type === 'multiselect') {
                    // Multi-select checkboxes
                    const checkboxContainer = document.createElement('div');
                    checkboxContainer.style.display = 'flex';
                    checkboxContainer.style.flexDirection = 'column';
                    checkboxContainer.style.gap = '4px';
                    checkboxContainer.style.maxHeight = '120px';
                    checkboxContainer.style.overflowY = 'auto';
                    checkboxContainer.style.padding = '8px';
                    checkboxContainer.style.background = 'var(--bg-primary)';
                    checkboxContainer.style.border = '1px solid var(--border-color)';
                    checkboxContainer.style.borderRadius = '4px';

                    def.options.forEach(opt => {
                        const checkboxWrapper = document.createElement('label');
                        checkboxWrapper.style.display = 'flex';
                        checkboxWrapper.style.alignItems = 'center';
                        checkboxWrapper.style.gap = '6px';
                        checkboxWrapper.style.fontSize = '0.85em';
                        checkboxWrapper.style.cursor = 'pointer';

                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.value = opt;
                        checkbox.dataset.filter = filterName;
                        checkbox.style.cursor = 'pointer';

                        const span = document.createElement('span');
                        span.textContent = opt;

                        checkboxWrapper.appendChild(checkbox);
                        checkboxWrapper.appendChild(span);
                        checkboxContainer.appendChild(checkboxWrapper);
                    });

                    filterRow.appendChild(checkboxContainer);
                } else if (def.type === 'select') {
                    // Regular select dropdown
                    const select = document.createElement('select');
                    select.className = 'filter-select';
                    select.dataset.filter = filterName;
                    select.style.width = '100%';
                    def.options.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = opt;
                        option.textContent = opt;
                        select.appendChild(option);
                    });
                    filterRow.appendChild(select);
                } else if (def.type === 'number') {
                    // Number input
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.step = 'any';
                    input.className = 'filter-input';
                    input.placeholder = def.placeholder || filterName;
                    input.dataset.filter = filterName;
                    input.style.width = '100%';

                    filterRow.appendChild(input);
                }

                sectionGrid.appendChild(filterRow);
            });

            section.appendChild(sectionGrid);
            container.appendChild(section);
        });
    }

    async fetchData() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            // Get the view parameter for the current view
            const currentViewConfig = this.views[this.currentView];
            const viewParam = currentViewConfig ? currentViewConfig.viewParam : '111';

            // Fetch stock data from Finviz with the appropriate view
            const params = new URLSearchParams({
                v: viewParam,
                f: '',     // Filters will be applied
                o: '-marketcap'  // Order by market cap descending
            });

            const response = await AUTH.fetchSaxo(`/api/finviz/screener?${params}`, {
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            this.data = await response.json();
            this.filteredData = this.data;

            // Log the first stock to see what columns we have
            if (this.data && this.data.length > 0) {
                console.log('Available columns:', Object.keys(this.data[0]));
                console.log('Sample stock data:', this.data[0]);
            }

            // Fetch news for all tickers
            const tickers = this.data.map(stock => stock.Ticker).filter(t => t);
            await this.fetchNewsForTickers(tickers);
            // Re-apply active filters when switching views so user inputs persist
            if (Object.keys(this.filters).length > 0) {
                this.applyAllFilters();
            } else {
                this.filteredData = this.data;
                this.render();
            }

        } catch (error) {
            console.error('Failed to fetch screener data:', error);
            this.renderError(error.message);
        } finally {
            this.isLoading = false;
        }
    }

    applyAllFilters(valuesFromState) {
        const sourceValues = valuesFromState || (this.filterState ? this.filterState.values : null);
        this.filters = {};

        if (sourceValues) {
            Object.entries(sourceValues).forEach(([key, value]) => {
                const isEmptyArray = Array.isArray(value) && value.length === 0;
                const isEmptyScalar = value === null || value === '';
                if (isEmptyArray || isEmptyScalar) return;
                this.filters[key] = value;
            });
        } else {
            // Fallback to legacy DOM collection if state is unavailable
            const filterGroups = {};
            document.querySelectorAll('[data-filter]').forEach(input => {
                const filterName = input.dataset.filter;
                if (!filterGroups[filterName]) {
                    filterGroups[filterName] = [];
                }
                filterGroups[filterName].push(input);
            });

            Object.entries(filterGroups).forEach(([filterName, inputs]) => {
                if (inputs[0].type === 'checkbox') {
                    const checkedValues = inputs
                        .filter(input => input.checked)
                        .map(input => input.value);
                    if (checkedValues.length > 0) {
                        this.filters[filterName] = checkedValues;
                    }
                } else {
                    const value = inputs[0].value;
                    if (value && value !== 'Any' && value !== '') {
                        this.filters[filterName] = value;
                    }
                }
            });
        }

        // Apply filters to data
        if (!this.data) return;

        this.filteredData = this.data.filter(stock => {
            // Descriptive filters - handle both single values and arrays
            if (this.filters['Exchange']) {
                const exchanges = Array.isArray(this.filters['Exchange']) ? this.filters['Exchange'] : [this.filters['Exchange']];
                if (!exchanges.includes(stock.Exchange)) return false;
            }
            if (this.filters['Sector']) {
                const sectors = Array.isArray(this.filters['Sector']) ? this.filters['Sector'] : [this.filters['Sector']];
                if (!sectors.includes(stock.Sector)) return false;
            }
            if (this.filters['Industry']) {
                const industries = Array.isArray(this.filters['Industry']) ? this.filters['Industry'] : [this.filters['Industry']];
                if (!industries.includes(stock.Industry)) return false;
            }
            if (this.filters['Country']) {
                const countries = Array.isArray(this.filters['Country']) ? this.filters['Country'] : [this.filters['Country']];
                if (!countries.includes(stock.Country)) return false;
            }

            // Market Cap filter - handle multi-select
            if (this.filters['Market Cap']) {
                const mcap = this.parseMarketCap(stock['Market Cap']);
                const filters = Array.isArray(this.filters['Market Cap']) ? this.filters['Market Cap'] : [this.filters['Market Cap']];

                let matchesAny = false;
                for (const filter of filters) {
                    if (filter === 'Mega ($200bln+)' && mcap >= 200) matchesAny = true;
                    if (filter === 'Large ($10-200bln)' && mcap >= 10 && mcap < 200) matchesAny = true;
                    if (filter === 'Mid ($2-10bln)' && mcap >= 2 && mcap < 10) matchesAny = true;
                    if (filter === 'Small ($300mln-2bln)' && mcap >= 0.3 && mcap < 2) matchesAny = true;
                    if (filter === 'Micro (<$300mln)' && mcap < 0.3) matchesAny = true;
                }
                if (!matchesAny) return false;
            }

            // Price filters
            if (this.filters['Price Min'] && parseFloat(stock.Price) < parseFloat(this.filters['Price Min'])) return false;
            if (this.filters['Price Max'] && parseFloat(stock.Price) > parseFloat(this.filters['Price Max'])) return false;

            // Change filter
            const change = parseFloat((stock.Change || '').replace('%', ''));
            if (this.filters['Change % Min'] && change < parseFloat(this.filters['Change % Min'])) return false;
            if (this.filters['Change % Max'] && change > parseFloat(this.filters['Change % Max'])) return false;

            // Volume filter
            if (this.filters['Volume Min'] && parseInt(stock.Volume) < parseInt(this.filters['Volume Min'])) return false;

            // Relative Volume filter
            if (this.filters['Rel Volume']) {
                const relVol = parseFloat(stock['Rel Volume'] || stock['Relative Volume']);
                const filterVal = parseFloat(this.filters['Rel Volume'].replace('Over ', ''));
                if (relVol < filterVal) return false;
            }

            // Average Volume filter
            if (this.filters['Avg Volume']) {
                const avgVol = this.parseVolume(stock['Avg Volume']);
                const filter = this.filters['Avg Volume'];
                const filterVal = this.parseVolumeFilter(filter);
                if (filter.startsWith('Under') && avgVol >= filterVal) return false;
                if (filter.startsWith('Over') && avgVol < filterVal) return false;
            }

            // Float filter
            if (this.filters['Float']) {
                const floatVal = this.parseVolume(stock['Float'] || stock['Shs Float']);
                const filter = this.filters['Float'];
                if (filter === 'Low (<50M)' && floatVal >= 50000000) return false;
                if (filter === 'High (>500M)' && floatVal <= 500000000) return false;
                const filterVal = this.parseVolumeFilter(filter);
                if (filter.startsWith('Under') && floatVal >= filterVal) return false;
                if (filter.startsWith('Over') && floatVal < filterVal) return false;
            }

            // Fundamental filters - P/E
            if (this.filters['P/E']) {
                const pe = parseFloat(stock['P/E']);
                const filter = this.filters['P/E'];
                if (filter === 'Low (<15)' && pe >= 15) return false;
                if (filter === 'Profitable (>0)' && pe <= 0) return false;
                if (filter === 'High (>50)' && pe <= 50) return false;
                if (filter.startsWith('Under') && pe >= parseFloat(filter.replace('Under ', ''))) return false;
                if (filter.startsWith('Over') && pe < parseFloat(filter.replace('Over ', ''))) return false;
            }

            // Forward P/E
            if (this.filters['Forward P/E']) {
                const fpe = parseFloat(stock['Forward P/E']);
                const filter = this.filters['Forward P/E'];
                if (filter === 'Low (<15)' && fpe >= 15) return false;
                if (filter === 'Profitable (>0)' && fpe <= 0) return false;
                if (filter === 'High (>50)' && fpe <= 50) return false;
                if (filter.startsWith('Under') && fpe >= parseFloat(filter.replace('Under ', ''))) return false;
                if (filter.startsWith('Over') && fpe < parseFloat(filter.replace('Over ', ''))) return false;
            }

            // PEG
            if (this.filters['PEG']) {
                const peg = parseFloat(stock['PEG']);
                const filter = this.filters['PEG'];
                if (filter === 'Low (<1)' && peg >= 1) return false;
                if (filter === 'High (>2)' && peg <= 2) return false;
                if (filter.startsWith('Under') && peg >= parseFloat(filter.replace('Under ', ''))) return false;
                if (filter.startsWith('Over') && peg < parseFloat(filter.replace('Over ', ''))) return false;
            }

            // Dividend Yield
            if (this.filters['Dividend Yield']) {
                const div = parseFloat((stock['Dividend %'] || '').replace('%', ''));
                const filter = this.filters['Dividend Yield'];
                if (filter === 'None (0%)' && div > 0) return false;
                if (filter === 'Positive (>0%)' && div <= 0) return false;
                if (filter === 'High (>5%)' && div <= 5) return false;
                if (filter === 'Very High (>10%)' && div <= 10) return false;
                if (filter.startsWith('Over') && div < parseFloat(filter.replace('Over ', '').replace('%', ''))) return false;
            }

            // News Freshness filter
            if (this.filters['News Freshness']) {
                const newsItem = this.newsData[stock.Ticker];
                const filter = this.filters['News Freshness'];

                // If filter is set but no news exists, filter out
                if (!newsItem) return false;

                const now = new Date();
                const ageMinutes = Math.floor((now - newsItem.date) / (1000 * 60));
                const ageHours = Math.floor(ageMinutes / 60);
                const ageDays = Math.floor(ageHours / 24);

                if (filter === 'Breaking (<30m)' && ageMinutes >= 30) return false;
                if (filter === 'Very Fresh (<1h)' && ageMinutes >= 60) return false;
                if (filter === 'Fresh (<6h)' && ageHours >= 6) return false;
                if (filter === 'Recent (<24h)' && ageHours >= 24) return false;
                if (filter === 'This Week (<5d)' && ageDays >= 5) return false;
                if (filter === 'This Month (<30d)' && ageDays >= 30) return false;
            }

            return true;
        });

        this.render();

        const panel = document.getElementById('filtersPanel');
        if (panel) panel.classList.add('active');
    }

    parseMarketCap(mcapStr) {
        // Parse market cap strings like "$123.45B" or "$1.23T"
        if (!mcapStr || mcapStr === '-') return 0;
        const num = parseFloat(mcapStr.replace(/[$,]/g, ''));
        if (mcapStr.includes('T')) return num * 1000; // Convert to billions
        if (mcapStr.includes('B')) return num;
        if (mcapStr.includes('M')) return num / 1000; // Convert to billions
        return num;
    }

    parseVolume(volStr) {
        // Parse volume strings like "1.23M" or "123.45K"
        if (!volStr || volStr === '-') return 0;
        const num = parseFloat(volStr.replace(/[,]/g, ''));
        if (volStr.includes('M')) return num * 1000000;
        if (volStr.includes('K')) return num * 1000;
        if (volStr.includes('B')) return num * 1000000000;
        return num;
    }

    parseVolumeFilter(filter) {
        // Parse filter strings like "Over 1M" or "Under 500K"
        const num = parseFloat(filter.match(/[\d.]+/)[0]);
        if (filter.includes('M')) return num * 1000000;
        if (filter.includes('K')) return num * 1000;
        if (filter.includes('B')) return num * 1000000000;
        return num;
    }

    clearAllFilters() {
        if (this.filterState && this.filterSchema) {
            const defaults = this.buildFilterDefaults(this.filterSchema);
            this.filterState.reset(defaults);
        }
        this.filters = {};
        this.filteredData = this.data;
        this.render();
    }

    switchView(viewKey) {
        this.currentView = viewKey;
        this.renderTabs();
        // Re-fetch data with the appropriate view parameter
        this.fetchData();
    }

    sortBy(column) {
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'desc';
        }

        const data = this.filteredData || this.data;
        if (!data) return;

        data.sort((a, b) => {
            let aVal = a[column] || '';
            let bVal = b[column] || '';

            // Handle percentage values
            if (typeof aVal === 'string' && aVal.includes('%')) {
                aVal = parseFloat(aVal.replace('%', ''));
                bVal = parseFloat(bVal.replace('%', ''));
            }
            // Handle currency values
            else if (typeof aVal === 'string' && aVal.includes('$')) {
                aVal = parseFloat(aVal.replace('$', ''));
                bVal = parseFloat(bVal.replace('$', ''));
            }
            // Try parsing as number
            else if (!isNaN(parseFloat(aVal))) {
                aVal = parseFloat(aVal);
                bVal = parseFloat(bVal);
            }

            // String comparison
            if (typeof aVal === 'string') {
                return this.sortDirection === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            }

            // Number comparison
            return this.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        });

        this.render();
    }

    render() {
        const container = document.getElementById('tableContainer');
        const dataToShow = this.filteredData || this.data || [];

        // Update result count
        document.getElementById('resultCount').textContent =
            `${dataToShow.length} stocks ${Object.keys(this.filters).length > 0 ? '(filtered)' : ''}`;

        if (dataToShow.length === 0) {
            container.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);">No stocks found</div>';
            return;
        }

        // Get current view columns
        const view = this.views[this.currentView];
        let columns = ['Watchlist', ...view.columns];

        // Filter columns to only show those with actual data
        if (dataToShow.length > 0) {
            const columnsWithData = columns.filter(col => {
                // Always include Ticker and Watchlist control
                if (col === 'Ticker' || col === 'Watchlist') return true;
                // Check if this column has data in at least 10% of stocks
                const stocksWithData = dataToShow.filter(stock =>
                    stock[col] && stock[col] !== '-' && stock[col] !== '' && stock[col] !== 'N/A'
                ).length;
                return stocksWithData > dataToShow.length * 0.1;
            });

            // Only use filtered columns if we found some
            if (columnsWithData.length > 1) {
                columns = columnsWithData;
            }
        }

        // Create table
        const table = document.createElement('table');
        table.className = 'screener-table';

        // Create header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        columns.forEach(col => {
            const th = document.createElement('th');
            th.onclick = () => this.sortBy(col);

            const sortIndicator = this.sortColumn === col
                ? (this.sortDirection === 'asc' ? ' ▲' : ' ▼')
                : '';
            th.textContent = col + sortIndicator;

            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Create body
        const tbody = document.createElement('tbody');

        dataToShow.slice(0, 100).forEach(stock => {
            const row = document.createElement('tr');
            row.onclick = () => window.open(`https://finviz.com/quote.ashx?t=${stock.Ticker}`, '_blank');

            columns.forEach(col => {
                const td = document.createElement('td');

                if (col === 'Watchlist') {
                    if (window.WATCHLIST && stock.Ticker) {
                        const btn = document.createElement('button');
                        btn.className = 'watchlist-btn';

                        const setState = () => {
                            const isInList = window.WATCHLIST.has(stock.Ticker);
                            btn.textContent = isInList ? '✓ In Watchlist' : '+ Watchlist';
                            btn.classList.toggle('added', isInList);
                        };

                        btn.onclick = (e) => {
                            e.stopPropagation();
                            const isInList = window.WATCHLIST.has(stock.Ticker);
                            if (isInList) {
                                window.WATCHLIST.remove(stock.Ticker);
                            } else {
                                window.WATCHLIST.add(stock.Ticker, 'advanced-screener');
                            }
                            setState();
                        };

                        setState();
                        td.appendChild(btn);
                    } else {
                        td.textContent = '-';
                    }
                } else {
                    let value = stock[col];

                    // Handle missing or empty values
                    const isMissing = value === undefined || value === null || value === '' || value === '-';
                    if (isMissing) {
                        value = 'N/A';
                    }

                    // Format specific columns
                    if (col === 'Ticker') {
                        td.className = 'ticker-cell';

                        // Add news indicator if available
                        const newsIndicator = this.getNewsIndicator(stock.Ticker);
                        if (newsIndicator) {
                            const newsSpan = document.createElement('span');
                            newsSpan.style.marginRight = '6px';
                            newsSpan.style.cursor = 'pointer';
                            newsSpan.title = `${newsIndicator.label}: ${newsIndicator.title}`;
                            newsSpan.textContent = newsIndicator.icon;
                            newsSpan.onclick = (e) => {
                                e.stopPropagation();
                                window.open(newsIndicator.url, '_blank');
                            };
                            td.appendChild(newsSpan);
                        }

                        const tickerText = document.createTextNode(value);
                        td.appendChild(tickerText);

                        td.addEventListener('mouseenter', (e) => this.handleTickerHover(e, stock, newsIndicator));
                        td.addEventListener('mousemove', (e) => this.positionNewsPopover({ x: e.clientX, y: e.clientY }));
                        td.addEventListener('mouseleave', () => this.hideNewsPopover());
                    } else if (col === 'Change' || col.includes('Perf')) {
                        if (!isMissing) {
                            const numValue = parseFloat((value || '').replace('%', ''));
                            if (numValue > 0) td.className = 'positive';
                            else if (numValue < 0) td.className = 'negative';
                        } else {
                            td.style.color = 'var(--text-muted)';
                            td.style.fontStyle = 'italic';
                        }
                        td.textContent = value;
                    } else {
                        if (isMissing) {
                            td.style.color = 'var(--text-muted)';
                            td.style.fontStyle = 'italic';
                        }
                        td.textContent = value;
                    }
                }

                row.appendChild(td);
            });

            tbody.appendChild(row);
        });

        table.appendChild(tbody);

        container.innerHTML = '';
        container.appendChild(table);
    }

    exportToCSV() {
        const dataToExport = this.filteredData || this.data || [];
        if (dataToExport.length === 0) return;

        const view = this.views[this.currentView];
        const columns = view.columns;

        // Create CSV content
        let csv = columns.join(',') + '\n';

        dataToExport.forEach(stock => {
            const row = columns.map(col => {
                let value = stock[col] || '';
                // Escape commas and quotes
                if (value.includes(',') || value.includes('"')) {
                    value = '"' + value.replace(/"/g, '""') + '"';
                }
                return value;
            });
            csv += row.join(',') + '\n';
        });

        // Download CSV
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `screener-${this.currentView}-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    renderError(message) {
        const container = document.getElementById('tableContainer');
        container.innerHTML = `
            <div style="padding: 60px; text-align: center;">
                <i data-lucide="alert-circle" style="width: 48px; height: 48px; color: var(--accent-red); margin-bottom: 16px;"></i>
                <p style="color: var(--text-primary); font-size: 1.1em; margin-bottom: 8px;">Failed to load screener data</p>
                <small style="color: var(--text-muted);">${message}</small>
                <br><br>
                <button class="btn-primary" onclick="advancedScreener.fetchData()">Retry</button>
            </div>
        `;
        lucide.createIcons();
    }
}

// Create global instance
window.advancedScreener = new AdvancedScreener();
