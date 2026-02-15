// Broker monitoring adapter (keeps legacy Saxo API surface for compatibility)

class SaxoAPI {
    constructor() {
        this.baseUrl = '/api/broker';
        this.cache = {};
        this.cacheDuration = 15000; // 15 seconds cache
        this.currencySymbol = '$';
    }

    authHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const token = AUTH.getToken && AUTH.getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (window.API_KEY) headers['x-api-key'] = window.API_KEY;
        return headers;
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
        const headers = { ...this.authHeaders(), ...options.headers };
        
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
            
            // Use AUTH helper to make authenticated call through proxy
            const response = await fetch(url, {
                method: options.method || 'GET',
                headers,
                signal: controller.signal,
                body: options.body ? JSON.stringify(options.body) : undefined
            });
            
            clearTimeout(timeout);
            
            if (!response || !response.ok) {
                const status = response ? response.status : 'unknown';
                throw new Error(`Broker API Error: ${status}`);
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
                console.error('Broker API request timeout:', endpoint);
                throw new Error('Request timeout - please try again');
            }
            console.error('Broker API call failed:', error);
            throw error;
        }
    }

    /**
     * Get account balance information
     */
    async getBalance() {
        return this.call(`/account`);
    }
    
    /**
     * Get open positions
     */
    async getPositions() {
        return this.call(`/positions`);
    }
    
    /**
     * Get closed positions (historical)
     */
    async getClosedPositions(fromDate, toDate) {
        return [];
    }
    
    /**
     * Get account summary
     */
    async getAccountSummary() {
        return this.call(`/account`);
    }
    
    /**
     * Get account performance metrics
     */
    async getPerformance(fromDate, toDate) {
        return this.call(`/performance/weekly`);
    }
    
    /**
     * Get account values (historical)
     */
    async getAccountValues() {
        return [];
    }
    
    /**
     * Get today's transactions
     */
    async getTodayTransactions() {
        return [];
    }
    
    /**
     * Calculate today's P&L from open and closed positions
     */
    async getTodayPnL() {
        try {
            const pnl = await this.call('/pnl/daily');
            return pnl?.net || pnl?.gross || 0;
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
        return eurAmount;
    }
    
    /**
     * Format currency with symbol
     */
    formatCurrency(amount, showSign = false) {
        const absAmount = Math.abs(amount);
        const formatted = `${CONFIG.CURRENCY_SYMBOL}${absAmount.toLocaleString('en-GB', {
            // Use locale formatting; currency symbol from config if present
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
            const [snapshot, positions, pnl] = await Promise.all([
                this.getBalance(),
                this.getPositions(),
                this.getTodayPnL()
            ]);

            const totalValue = snapshot?.netLiquidation ?? snapshot?.cash ?? 0;
            const cashBalance = snapshot?.cash ?? 0;
            const openPositions = Array.isArray(positions) ? positions : (positions?.Data || []);
            const positionCount = openPositions.length;

            return {
                balance: {
                    value: cashBalance,
                    formatted: this.formatCurrency(cashBalance)
                },
                totalValue: {
                    value: totalValue,
                    formatted: this.formatCurrency(totalValue)
                },
                todayPnL: {
                    value: pnl,
                    formatted: this.formatCurrency(pnl, true),
                    percentage: totalValue > 0 ? (pnl / totalValue) * 100 : 0
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
