// News Loading Module with Caching
// Handles market news from Finnhub API via proxy

class NewsLoader {
    constructor() {
        this.apiUrl = `${CONFIG.API_BASE}/api/news`; // Use Finnhub news endpoint
        this.cache = null;
        this.cacheTimestamp = null;
        this.isLoading = false;
        this.marketCapFilter = 'all'; // all, small, mid, large
    }
    
    /**
     * Check if cache is still valid
     */
    isCacheValid() {
        if (!this.cache || !this.cacheTimestamp) return false;
        return (Date.now() - this.cacheTimestamp) < CONFIG.NEWS_CACHE_DURATION;
    }
    
    /**
     * Fetch news from API with caching
     */
    async fetchNews(category = 'general') {
        // Return cached data if still valid
        if (this.isCacheValid()) {
            console.log('Returning cached news');
            return this.cache;
        }
        
        // Prevent multiple simultaneous requests
        if (this.isLoading) {
            console.log('News request already in progress');
            return this.cache || [];
        }
        
        this.isLoading = true;
        
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
            
            const response = await AUTH.fetchSaxo(`${this.apiUrl}?category=${category}`, {
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            
            if (!response || !response.ok) {
                const status = response ? response.status : 'unknown';
                throw new Error(`News API Error: ${status}`);
            }
            
            const data = await response.json();
            
            // Cache the response
            this.cache = data;
            this.cacheTimestamp = Date.now();
            
            return data;
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('News request timeout');
            } else {
                console.error('Failed to fetch news:', error);
            }
            
            // Return cached data if available, even if expired
            return this.cache || [];
        } finally {
            this.isLoading = false;
        }
    }
    
    /**
     * Display news in a container element
     */
    async displayNews(containerId, limit = 10) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.warn('News container not found:', containerId);
            return;
        }
        
        // Show loading state
        container.innerHTML = '<div class="loading">Loading news...</div>';
        
        try {
            let news = await this.fetchNews();

            if (!news || news.length === 0) {
                container.innerHTML = '<div class="no-news">No news available</div>';
                return;
            }

            // Apply market cap filter
            const filteredNews = this.filterNewsByMarketCap(news);

            if (filteredNews.length === 0) {
                container.innerHTML = `<div class="no-news">No ${this.marketCapFilter} cap news available. <a href="#" onclick="newsLoader.setMarketCapFilter('all'); newsLoader.displayNews('${containerId}', ${limit}); return false;">Show all</a></div>`;
                return;
            }

            // Limit news items
            const limitedNews = filteredNews.slice(0, limit);

            // Generate HTML
            const newsHTML = limitedNews.map(item => this.createNewsItem(item)).join('');
            container.innerHTML = newsHTML;
            
        } catch (error) {
            console.error('Error displaying news:', error);
            container.innerHTML = `
                <div class="error-news">
                    Unable to load news. 
                    <button onclick="newsLoader.clearCache(); newsLoader.displayNews('${containerId}')">
                        Retry
                    </button>
                </div>
            `;
        }
    }
    
    /**
     * Create HTML for a single news item (compact headline format)
     */
    createNewsItem(item) {
        const date = new Date(item.datetime * 1000);
        const timeAgo = this.getTimeAgo(date);
        const source = item.source || 'Unknown';
        const headline = item.headline || 'No headline';
        const url = item.url || '#';

        return `
            <div class="news-item compact">
                <div class="news-meta">
                    <span class="news-source">${this.escapeHtml(source)}</span>
                    <span class="news-time">${timeAgo}</span>
                </div>
                <div class="news-headline">
                    <a href="${this.sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer">
                        ${this.escapeHtml(headline)}
                    </a>
                </div>
            </div>
        `;
    }
    
    /**
     * Calculate time ago from date
     */
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
    
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Sanitize URL to prevent XSS attacks
     */
    sanitizeUrl(url) {
        if (!url || typeof url !== 'string') return '#';

        const trimmed = url.trim().toLowerCase();

        // Only allow http/https protocols
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return url.trim();
        }

        // Block dangerous protocols
        if (trimmed.startsWith('javascript:') ||
            trimmed.startsWith('data:') ||
            trimmed.startsWith('vbscript:') ||
            trimmed.startsWith('file:')) {
            return '#';
        }

        // If no protocol, default to https
        return 'https://' + url.trim();
    }
    
    /**
     * Set market cap filter
     */
    setMarketCapFilter(filter) {
        this.marketCapFilter = filter;
        console.log('Market cap filter set to:', filter);
    }

    /**
     * Filter news based on market cap (basic keyword filtering)
     */
    filterNewsByMarketCap(news) {
        if (this.marketCapFilter === 'all') return news;

        const keywords = {
            small: ['small cap', 'small-cap', 'smallcap', 'micro cap', 'microcap', 'penny stock'],
            mid: ['mid cap', 'mid-cap', 'midcap', 'medium cap'],
            large: ['large cap', 'large-cap', 'largecap', 'blue chip', 'mega cap', 'megacap']
        };

        const filterKeywords = keywords[this.marketCapFilter] || [];

        return news.filter(item => {
            const text = `${item.headline} ${item.summary || ''}`.toLowerCase();
            return filterKeywords.some(keyword => text.includes(keyword));
        });
    }

    /**
     * Clear cache and force refresh
     */
    clearCache() {
        this.cache = null;
        this.cacheTimestamp = null;
    }
    
    /**
     * Auto-refresh news at interval
     */
    startAutoRefresh(containerId, interval = 5 * 60 * 1000) { // Default 5 minutes
        this.displayNews(containerId);
        
        return setInterval(() => {
            this.clearCache();
            this.displayNews(containerId);
        }, interval);
    }
}

// Create global instance
window.newsLoader = new NewsLoader();

// Helper function to initialize news on page load
function initializeNews(containerId = 'newsFeed', limit = 10) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            newsLoader.displayNews(containerId, limit);
        });
    } else {
        newsLoader.displayNews(containerId, limit);
    }
}
