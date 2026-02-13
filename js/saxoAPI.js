// Saxo Bank API Integration Module
// Handles all communication with Saxo Bank OpenAPI

class SaxoAPI {
    constructor() {
        this.baseUrl = CONFIG.SAXO.apiUrl;
        this.accountKey = null; // Will be fetched from /accounts/me
        this.cache = {};
        this.cacheDuration = 30000; // 30 seconds cache
    }

    // Use getters to always get current config values
    get token() {
        return CONFIG.SAXO.token;
    }

    get clientKey() {
        return CONFIG.SAXO.clientKey;
    }

    get accountNumber() {
        return CONFIG.SAXO.accountNumber;
    }
    
    /**
     * Generic API call handler with timeout and error handling
     */
    async call(endpoint, options = {}) {
        const cacheKey = endpoint;
        
        // Check cache first
        if (this.cache[cacheKey] && Date.now() - this.cache[cacheKey].timestamp < this.cacheDuration) {
            console.log('Returning cached data for:', endpoint);
            return this.cache[cacheKey].data;
        }
        
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
            
            // Use AUTH helper to make authenticated call through proxy
            const response = await AUTH.fetchSaxo(url, { 
                method: options.method || 'GET',
                headers, 
                signal: controller.signal,
                body: options.body ? JSON.stringify(options.body) : undefined
            });
            
            clearTimeout(timeout);
            
            if (!response || !response.ok) {
                const status = response ? response.status : 'unknown';
                throw new Error(`Saxo API Error: ${status}`);
            }
            
            const data = await response.json();
            
            // Cache the response
            this.cache[cacheKey] = {
                data: data,
                timestamp: Date.now()
            };
            
            return data;
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('Saxo API request timeout:', endpoint);
                throw new Error('Request timeout - please try again');
            }
            console.error('Saxo API call failed:', error);
            throw error;
        }
    }
    
    /**
     * Get AccountKey from server (cached)
     */
    async getAccountKey() {
        if (this.accountKey) return this.accountKey;

        try {
            const accounts = await this.call(`/port/v1/accounts/me`);
            if (accounts && accounts.Data && accounts.Data.length > 0) {
                this.accountKey = accounts.Data[0].AccountKey;
                return this.accountKey;
            }
        } catch (error) {
            console.warn('Failed to get AccountKey, using ClientKey fallback:', error);
        }
        return this.clientKey; // Fallback to clientKey
    }

    /**
     * Get account balance information
     */
    async getBalance() {
        // Use ClientKey for client-level balance (covers all accounts)
        return this.call(`/port/v1/balances?ClientKey=${encodeURIComponent(this.clientKey)}`);
    }
    
    /**
     * Get open positions
     */
    async getPositions() {
        return this.call(`/port/v1/positions?ClientKey=${encodeURIComponent(this.clientKey)}&FieldGroups=DisplayAndFormat,PositionBase,PositionView`);
    }
    
    /**
     * Get closed positions (historical)
     */
    async getClosedPositions(fromDate, toDate) {
        const from = fromDate || this.getTodayStart();
        const to = toDate || new Date().toISOString();
        return this.call(`/hist/v3/positions?ClientKey=${encodeURIComponent(this.clientKey)}&FromDate=${from}&ToDate=${to}`);
    }
    
    /**
     * Get account summary
     */
    async getAccountSummary() {
        return this.call(`/port/v1/accounts/me`);
    }
    
    /**
     * Get account performance metrics
     */
    async getPerformance(fromDate, toDate) {
        const from = fromDate || this.getTodayStart();
        // Format ToDate as YYYY-MM-DD for Saxo API
        const to = toDate || new Date().toISOString().split('T')[0];
        const accountKey = await this.getAccountKey();
        return this.call(`/hist/v4/performance/summary?ClientKey=${encodeURIComponent(this.clientKey)}&AccountKey=${encodeURIComponent(accountKey)}&FromDate=${encodeURIComponent(from)}&ToDate=${encodeURIComponent(to)}`);
    }
    
    /**
     * Get account values (historical)
     */
    async getAccountValues() {
        return this.call(`/hist/v3/accountvalues?ClientKey=${encodeURIComponent(this.clientKey)}`);
    }
    
    /**
     * Get today's transactions
     */
    async getTodayTransactions() {
        const from = this.getTodayStart();
        const to = new Date().toISOString();
        return this.call(`/hist/v1/transactions?ClientKey=${encodeURIComponent(this.clientKey)}&FromDate=${from}&ToDate=${to}`);
    }
    
    /**
     * Calculate today's P&L from open and closed positions
     */
    async getTodayPnL() {
        try {
            const [positions, performance] = await Promise.all([
                this.getPositions(),
                this.getPerformance()
            ]);
            
            let totalPnL = 0;
            
            // Add P&L from open positions
            if (positions.Data && positions.Data.length > 0) {
                positions.Data.forEach(pos => {
                    totalPnL += (pos.ProfitLossOnTrade || 0);
                });
            }
            
            // Add P&L from performance data
            if (performance && performance.TodayProfitLoss !== undefined) {
                totalPnL = performance.TodayProfitLoss;
            }
            
            return totalPnL;
        } catch (error) {
            console.error('Error calculating today P&L:', error);
            return 0;
        }
    }
    
    /**
     * Currency conversion: EUR to GBP
     */
    convertToGBP(eurAmount) {
        if (typeof eurAmount !== 'number') return 0;
        return eurAmount * CONFIG.EUR_TO_GBP;
    }
    
    /**
     * Format currency with symbol
     */
    formatCurrency(amount, showSign = false) {
        const absAmount = Math.abs(amount);
        const formatted = `${CONFIG.CURRENCY_SYMBOL}${absAmount.toLocaleString('en-GB', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
        
        if (showSign && amount !== 0) {
            return amount > 0 ? `+${formatted}` : `-${formatted}`;
        }
        
        return formatted;
    }
    
    /**
     * Format percentage
     */
    formatPercentage(value, decimals = 2) {
        return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
    }
    
    /**
     * Get today's start time in ISO format (Saxo compatible)
     */
    getTodayStart() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // Return simple date format YYYY-MM-DD for Saxo API
        return today.toISOString().split('T')[0];
    }
    
    /**
     * Clear cache
     */
    clearCache() {
        this.cache = {};
    }
    
    /**
     * Get complete dashboard data in one call
     */
    async getDashboardData() {
        try {
            const [balance, positions, performance] = await Promise.all([
                this.getBalance(),
                this.getPositions(),
                this.getPerformance()
            ]);
            
            // Process balance
            const cashBalance = balance.CashBalance || 0;
            const totalValue = balance.TotalValue || cashBalance;
            
            // Process positions
            const openPositions = positions.Data || [];
            const positionCount = openPositions.length;
            
            // Calculate today's P&L
            let todayPnL = 0;
            openPositions.forEach(pos => {
                todayPnL += (pos.ProfitLossOnTrade || 0);
            });
            
            // Convert to GBP
            return {
                balance: {
                    eur: cashBalance,
                    gbp: this.convertToGBP(cashBalance),
                    formatted: this.formatCurrency(this.convertToGBP(cashBalance))
                },
                totalValue: {
                    eur: totalValue,
                    gbp: this.convertToGBP(totalValue),
                    formatted: this.formatCurrency(this.convertToGBP(totalValue))
                },
                todayPnL: {
                    eur: todayPnL,
                    gbp: this.convertToGBP(todayPnL),
                    formatted: this.formatCurrency(this.convertToGBP(todayPnL), true),
                    percentage: totalValue > 0 ? (todayPnL / totalValue) * 100 : 0
                },
                positions: {
                    count: positionCount,
                    data: openPositions
                },
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
            throw error;
        }
    }
}

// Create global instance
window.saxoAPI = new SaxoAPI();

// Helper function to load and display dashboard data
async function loadSaxoDashboard() {
    const loadingStates = {
        balance: document.getElementById('accountBalance'),
        pnl: document.getElementById('todayPnL'),
        positions: document.getElementById('openPositions')
    };

    // Show loading state
    Object.values(loadingStates).forEach(el => {
        if (el) el.textContent = 'Loading...';
    });

    try {
        // Wait for config to load first
        if (window.configReady) {
            await window.configReady;
        }

        const data = await saxoAPI.getDashboardData();
        
        // Update balance
        if (loadingStates.balance) {
            loadingStates.balance.textContent = data.totalValue.formatted;
        }
        
        // Update P&L with color coding
        if (loadingStates.pnl) {
            loadingStates.pnl.textContent = data.todayPnL.formatted;
            const pnlCard = loadingStates.pnl.closest('.stat-card');
            if (pnlCard) {
                pnlCard.classList.remove('positive', 'negative');
                if (data.todayPnL.gbp > 0) {
                    pnlCard.classList.add('positive');
                } else if (data.todayPnL.gbp < 0) {
                    pnlCard.classList.add('negative');
                }
            }
        }
        
        // Update positions count
        if (loadingStates.positions) {
            loadingStates.positions.textContent = data.positions.count;
        }
        
        console.log('Dashboard data loaded successfully:', data);
        return data;
        
    } catch (error) {
        console.error('Failed to load Saxo dashboard data:', error);
        
        // Show error state
        Object.values(loadingStates).forEach(el => {
            if (el) {
                el.textContent = 'Error';
                el.style.color = 'var(--accent-red)';
            }
        });
        
        // Show user-friendly error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.style.cssText = 'background: var(--accent-red); color: white; padding: 12px; border-radius: 8px; margin: 16px; text-align: center;';
        errorDiv.textContent = 'Unable to load account data. Please check your connection and refresh.';
        
        const container = document.querySelector('.stats-grid');
        if (container) {
            container.insertAdjacentElement('beforebegin', errorDiv);
        }
        
        throw error;
    }
}
