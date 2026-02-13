// Finviz Elite Screeners Module
// Handles fetching and displaying Finviz screener data with filtering

class FinvizScreener {
    constructor(containerId, config) {
        this.containerId = containerId;
        this.config = config;
        this.data = null;
        this.filteredData = null;
        this.isLoading = false;
        this.sortColumn = null;
        this.sortDirection = 'desc'; // 'asc' or 'desc'
        this.filters = {
            changeMin: null,
            changeMax: null,
            priceMin: null,
            priceMax: null,
            volumeMin: null,
            floatMin: null,
            floatMax: null,
            relVolMin: null,
            gapMin: null,
            gapMax: null,
            sector: 'all'
        };
    }

    async fetchData() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            const params = new URLSearchParams({
                f: this.config.filters,
                v: this.config.view || '111',
                o: this.config.order || ''
            });

            const response = await AUTH.fetchSaxo(`/api/finviz/screener?${params}`, {
                method: 'GET'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            this.data = await response.json();
            this.applyFilters();
            this.render();
        } catch (error) {
            console.error('Failed to fetch screener data:', error);
            this.renderError(error.message);
        } finally {
            this.isLoading = false;
        }
    }

    applyFilters() {
        if (!this.data) {
            this.filteredData = [];
            return;
        }

        this.filteredData = this.data.filter(stock => {
            // Parse values
            const change = parseFloat((stock.Change || '').replace('%', ''));
            const price = parseFloat(stock.Price);
            const volume = parseInt(stock.Volume);
            const floatVal = parseFloat(stock['Float'] || stock['Shs Float']);
            const relVol = parseFloat(stock['Rel Volume'] || stock['Relative Volume']);
            const gap = parseFloat((stock['Gap'] || stock['Change from Open'] || '').replace('%', ''));
            const sector = stock.Sector || '';

            // Apply filters
            if (this.filters.changeMin !== null && change < this.filters.changeMin) return false;
            if (this.filters.changeMax !== null && change > this.filters.changeMax) return false;
            if (this.filters.priceMin !== null && price < this.filters.priceMin) return false;
            if (this.filters.priceMax !== null && price > this.filters.priceMax) return false;
            if (this.filters.volumeMin !== null && volume < this.filters.volumeMin) return false;
            if (this.filters.floatMin !== null && floatVal < this.filters.floatMin) return false;
            if (this.filters.floatMax !== null && floatVal > this.filters.floatMax) return false;
            if (this.filters.relVolMin !== null && relVol < this.filters.relVolMin) return false;
            if (this.filters.gapMin !== null && gap < this.filters.gapMin) return false;
            if (this.filters.gapMax !== null && gap > this.filters.gapMax) return false;
            if (this.filters.sector !== 'all' && sector !== this.filters.sector) return false;

            return true;
        });
    }

    updateFilter(filterName, value) {
        this.filters[filterName] = value === '' || value === null ? null : value;
        this.applyFilters();
        this.render();
        this.updateFilterSummary();
    }

    clearFilters() {
        this.filters = {
            changeMin: null,
            changeMax: null,
            priceMin: null,
            priceMax: null,
            volumeMin: null,
            floatMin: null,
            floatMax: null,
            relVolMin: null,
            gapMin: null,
            gapMax: null,
            sector: 'all'
        };

        // Clear all filter inputs
        const filterPanel = document.getElementById(`${this.containerId}-filters`);
        if (filterPanel) {
            filterPanel.querySelectorAll('input').forEach(input => input.value = '');
            filterPanel.querySelectorAll('select').forEach(select => select.value = 'all');
        }

        this.applyFilters();
        this.render();
        this.updateFilterSummary();
    }

    updateFilterSummary() {
        const summary = document.getElementById(`${this.containerId}-filter-summary`);
        if (!summary) return;

        const activeFilters = Object.entries(this.filters).filter(([key, value]) =>
            value !== null && value !== 'all'
        );

        if (activeFilters.length === 0) {
            summary.textContent = '';
            summary.style.display = 'none';
        } else {
            summary.style.display = 'block';
            summary.textContent = `${activeFilters.length} filter${activeFilters.length > 1 ? 's' : ''} active`;
        }
    }

    getUniqueSectors() {
        if (!this.data) return [];
        const sectors = [...new Set(this.data.map(stock => stock.Sector).filter(s => s))];
        return sectors.sort();
    }

    sortBy(column) {
        // Toggle direction if clicking same column
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = 'desc';
        }

        const data = this.filteredData || this.data;
        if (!data) return;

        data.sort((a, b) => {
            let aVal, bVal;

            switch(column) {
                case 'Ticker':
                    aVal = a.Ticker || '';
                    bVal = b.Ticker || '';
                    break;
                case 'Company':
                    aVal = a.Company || '';
                    bVal = b.Company || '';
                    break;
                case 'Sector':
                    aVal = a.Sector || '';
                    bVal = b.Sector || '';
                    break;
                case 'Market Cap':
                    aVal = parseFloat(a['Market Cap']) || 0;
                    bVal = parseFloat(b['Market Cap']) || 0;
                    break;
                case 'Price':
                    aVal = parseFloat(a.Price) || 0;
                    bVal = parseFloat(b.Price) || 0;
                    break;
                case 'Change':
                    aVal = parseFloat((a.Change || '').replace('%', '')) || 0;
                    bVal = parseFloat((b.Change || '').replace('%', '')) || 0;
                    break;
                case 'Volume':
                    aVal = parseInt(a.Volume) || 0;
                    bVal = parseInt(b.Volume) || 0;
                    break;
                default:
                    return 0;
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
        const container = document.getElementById(this.containerId);
        if (!container) return;

        const dataToShow = this.filteredData || this.data || [];

        if (dataToShow.length === 0) {
            container.innerHTML = '<div class="no-data">No stocks found matching criteria</div>';
            return;
        }

        // Create table
        const table = document.createElement('table');
        table.className = 'screener-table';

        // Create header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        const columns = ['Watchlist', 'Ticker', 'Company', 'Sector', 'Market Cap', 'Price', 'Change', 'Volume'];
        columns.forEach(col => {
            const th = document.createElement('th');
            th.style.cursor = 'pointer';
            th.style.userSelect = 'none';
            th.onclick = () => this.sortBy(col);

            // Add column name and sort indicator
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

            // Watchlist control
            const watchCell = document.createElement('td');
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
                        window.WATCHLIST.add(stock.Ticker, 'screener');
                    }
                    setState();
                };

                setState();
                watchCell.appendChild(btn);
            } else {
                watchCell.textContent = '-';
            }
            row.appendChild(watchCell);

            // Ticker
            const tickerCell = document.createElement('td');
            tickerCell.className = 'ticker-cell';
            tickerCell.textContent = stock.Ticker || '-';
            row.appendChild(tickerCell);

            // Company
            const companyCell = document.createElement('td');
            companyCell.className = 'company-cell';
            companyCell.textContent = stock.Company || '-';
            row.appendChild(companyCell);

            // Sector
            const sectorCell = document.createElement('td');
            sectorCell.textContent = stock.Sector || '-';
            row.appendChild(sectorCell);

            // Market Cap
            const mcapCell = document.createElement('td');
            mcapCell.textContent = this.formatMarketCap(stock['Market Cap']);
            row.appendChild(mcapCell);

            // Price
            const priceCell = document.createElement('td');
            priceCell.textContent = stock.Price ? `$${parseFloat(stock.Price).toFixed(2)}` : '-';
            row.appendChild(priceCell);

            // Change
            const changeCell = document.createElement('td');
            const change = parseFloat(stock.Change);
            changeCell.textContent = stock.Change || '-';
            if (change > 0) {
                changeCell.className = 'positive';
            } else if (change < 0) {
                changeCell.className = 'negative';
            }
            row.appendChild(changeCell);

            // Volume
            const volumeCell = document.createElement('td');
            volumeCell.textContent = this.formatVolume(stock.Volume);
            row.appendChild(volumeCell);

            tbody.appendChild(row);
        });

        table.appendChild(tbody);

        // Add result count
        const resultCount = document.createElement('div');
        resultCount.className = 'result-count';
        resultCount.textContent = `Showing ${Math.min(dataToShow.length, 100)} of ${dataToShow.length} stocks`;

        // Update container
        container.innerHTML = '';
        container.appendChild(resultCount);
        container.appendChild(table);
    }

    renderError(message) {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        container.innerHTML = `
            <div class="screener-error">
                <i data-lucide="alert-circle" style="width: 24px; height: 24px;"></i>
                <p>Failed to load screener data</p>
                <small>${message}</small>
                <button onclick="screeners['${this.containerId}'].fetchData()">Retry</button>
            </div>
        `;
        lucide.createIcons();
    }

    formatMarketCap(value) {
        if (!value || value === '-') return '-';
        const num = parseFloat(value);
        if (num >= 1000) return `$${(num / 1000).toFixed(2)}T`;
        if (num >= 1) return `$${num.toFixed(2)}B`;
        return `$${(num * 1000).toFixed(0)}M`;
    }

    formatVolume(value) {
        if (!value || value === '-') return '-';
        const num = parseInt(value);
        if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
        if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
        return num.toString();
    }
}

// Global screener instances
window.screeners = {};

function getDefaultAdvancedPresets() {
    return {
        'Small Cap Momentum': {
            'Market Cap': ['Small ($300mln-2bln)', 'Micro (<$300mln)'],
            'Change % Min': '5',
            'Volume Min': '500000'
        },
        'Mid-Large Cap Value': {
            'Market Cap': ['Mid ($2-10bln)', 'Large ($10-200bln)'],
            'P/E': 'Low (<15)',
            'Dividend Yield': 'Positive (>0%)',
            'Volume Min': '500000'
        },
        'High Volume Breakouts': {
            'Rel Volume': 'Over 2',
            'Change % Min': '3',
            'Volume Min': '1000000'
        }
    };
}

function loadAdvancedPresetConfigs() {
    try {
        const saved = localStorage.getItem('advancedScreenerPresets');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && Object.keys(parsed).length > 0) {
                return parsed;
            }
        }
    } catch (err) {
        console.warn('[Screeners] Failed to parse advanced screener presets, using defaults.', err);
    }
    return getDefaultAdvancedPresets();
}

function mapPresetToFinvizFilters(preset) {
    if (!preset || typeof preset !== 'object') return null;
    const filters = new Set();

    const capVal = preset['Market Cap'];
    const caps = Array.isArray(capVal) ? capVal : capVal ? [capVal] : [];
    if (caps.includes('Micro (<$300mln)') && caps.includes('Small ($300mln-2bln)')) {
        filters.add('cap_smallunder');
    } else if (caps.includes('Micro (<$300mln)')) {
        filters.add('cap_micro');
    } else if (caps.includes('Small ($300mln-2bln)')) {
        filters.add('cap_small');
    } else if (caps.includes('Mid ($2-10bln)') && caps.includes('Large ($10-200bln)')) {
        filters.add('cap_midover');
    } else if (caps.includes('Mid ($2-10bln)')) {
        filters.add('cap_mid');
    } else if (caps.includes('Large ($10-200bln)')) {
        filters.add('cap_large');
    }

    const changeMin = parseFloat(preset['Change % Min']);
    if (!isNaN(changeMin)) {
        if (changeMin >= 10) filters.add('ta_change_u10');
        else if (changeMin >= 5) filters.add('ta_change_u5');
        else if (changeMin >= 3) filters.add('ta_change_u3');
        else if (changeMin > 0) filters.add('ta_change_u1');
    }

    const volumeMin = parseFloat(preset['Volume Min']);
    if (!isNaN(volumeMin)) {
        if (volumeMin >= 1000000) filters.add('sh_avgvol_o1000');
        else if (volumeMin >= 500000) filters.add('sh_avgvol_o500');
        else if (volumeMin >= 200000) filters.add('sh_avgvol_o200');
        else if (volumeMin >= 100000) filters.add('sh_avgvol_o100');
    }

    const relVol = preset['Rel Volume'];
    if (relVol) {
        const relVal = parseFloat(String(relVol).replace(/[^0-9.]/g, ''));
        if (!isNaN(relVal)) {
            if (relVal >= 5) filters.add('sh_relvol_o5');
            else if (relVal >= 3) filters.add('sh_relvol_o3');
            else if (relVal >= 2) filters.add('sh_relvol_o2');
            else if (relVal >= 1) filters.add('sh_relvol_o1');
        }
    }

    const pe = preset['P/E'];
    if (pe) {
        const match = pe.match(/(\d+)/);
        if (match) {
            filters.add(`fa_pe_u${match[1]}`);
        }
    }

    const dividend = preset['Dividend Yield'];
    if (dividend && dividend.toLowerCase().includes('positive')) {
        filters.add('fa_div_pos');
    }

    return filters.size ? Array.from(filters).join(',') : null;
}

// Initialize screeners
function initScreeners() {
    const fallbackConfigs = {
        screener1: {
            name: 'Pre-Market Gainers',
            filters: 'sh_avgvol_o500,sh_curvol_o1000,sh_price_u20,ta_changeopen_u5',
            order: '-change'
        },
        screener2: {
            name: 'Top Gainers',
            filters: 'sh_avgvol_o500,ta_change_u5',
            order: '-change'
        },
        screener3: {
            name: 'Unusual Volume',
            filters: 'sh_relvol_o3,sh_avgvol_o500',
            order: '-volume'
        },
        screener4: {
            name: 'Gap Up',
            filters: 'sh_avgvol_o500,ta_gap_u3',
            order: '-change'
        },
        screener5: {
            name: 'High Volatility',
            filters: 'sh_avgvol_o500,ta_volatility_wo5',
            order: '-volatility'
        },
        screener6: {
            name: 'Small Cap Gainers',
            filters: 'cap_smallover,sh_avgvol_o500,ta_change_u3',
            order: '-change'
        }
    };

    const advancedPresets = loadAdvancedPresetConfigs();
    const presetEntries = Object.entries(advancedPresets).slice(0, Object.keys(fallbackConfigs).length);

    Object.keys(fallbackConfigs).forEach((id, idx) => {
        const fallback = fallbackConfigs[id];
        const presetEntry = presetEntries[idx];

        let config = { ...fallback };
        if (presetEntry) {
            const [presetName, presetFilters] = presetEntry;
            const mappedFilters = mapPresetToFinvizFilters(presetFilters);
            config = {
                ...fallback,
                name: presetName,
                filters: mappedFilters || fallback.filters
            };
        }

        const titleEl = document.getElementById(id)?.closest('.screener-panel')?.querySelector('.screener-title__name');
        if (titleEl && config.name) {
            titleEl.textContent = config.name;
        }

        screeners[id] = new FinvizScreener(id, config);
    });
}

// Refresh a specific screener
function refreshScreener(id) {
    if (screeners[id]) {
        screeners[id].fetchData();
    }
}

// Toggle filter panel
function toggleFilters(id) {
    const panel = document.getElementById(`${id}-filter-panel`);
    const btn = document.querySelector(`[onclick="toggleFilters('${id}')"]`);

    if (panel.style.display === 'none' || !panel.style.display) {
        panel.style.display = 'block';
        if (btn) btn.classList.add('active');

        // Populate sector dropdown if empty
        const sectorSelect = panel.querySelector('select[data-filter="sector"]');
        if (sectorSelect && sectorSelect.options.length === 1) {
            const screener = screeners[id];
            if (screener) {
                const sectors = screener.getUniqueSectors();
                sectors.forEach(sector => {
                    const option = document.createElement('option');
                    option.value = sector;
                    option.textContent = sector;
                    sectorSelect.appendChild(option);
                });
            }
        }
    } else {
        panel.style.display = 'none';
        if (btn) btn.classList.remove('active');
    }
}

// Apply filter from input
function applyFilter(screenerId, filterName, value) {
    const screener = screeners[screenerId];
    if (!screener) return;

    // Convert to appropriate type
    let filterValue = value;
    if (value === '' || value === 'all') {
        filterValue = null;
    } else if (!isNaN(value) && value !== '') {
        filterValue = parseFloat(value);
    }

    screener.updateFilter(filterName, filterValue);
}

// Clear all filters for a screener
function clearScreenerFilters(id) {
    const screener = screeners[id];
    if (screener) {
        screener.clearFilters();
    }
}

// Load all screeners
function loadAllScreeners() {
    Object.keys(screeners).forEach(id => {
        screeners[id].fetchData();
    });
}
