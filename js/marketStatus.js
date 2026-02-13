// Market Status Logic
// Handles market hours, countdown, and status display

class MarketStatus {
    constructor(options = {}) {
        this.statusElement = null;
        this.dotElement = null;
        this.updateInterval = null;
        // Allow timezone configuration (default to US Eastern for NYSE)
        this.timezone = options.timezone || 'America/New_York';
        // Allow market hours configuration
        this.marketHours = options.marketHours || {
            preMarketStart: 4,      // 4:00 AM
            marketOpenHour: 9,       // 9:30 AM
            marketOpenMinute: 30,
            marketCloseHour: 16,     // 4:00 PM
            postMarketCloseHour: 20  // 8:00 PM
        };
    }
    
    init(statusElementId = 'marketStatus') {
        this.statusElement = document.getElementById(statusElementId);
        this.dotElement = document.querySelector('.status-dot');
        
        if (!this.statusElement) {
            console.warn('Market status element not found');
            return;
        }
        
        this.update();
        this.updateInterval = setInterval(() => this.update(), 60000); // Update every minute
    }
    
    update() {
        const now = new Date();
        const marketTime = new Date(now.toLocaleString('en-US', { timeZone: this.timezone }));
        const hour = marketTime.getHours();
        const minute = marketTime.getMinutes();
        const day = marketTime.getDay();

        const mh = this.marketHours;

        let status = '';
        let color = '';
        let shouldPulse = true;

        // Weekend check
        if (day === 0 || day === 6) {
            status = 'Market Closed (Weekend)';
            color = 'var(--accent-red)';
            shouldPulse = false;
        }
        // Pre-market
        else if (hour >= mh.preMarketStart && (hour < mh.marketOpenHour || (hour === mh.marketOpenHour && minute < mh.marketOpenMinute))) {
            status = 'Pre-Market';
            color = 'var(--accent-orange)';
        }
        // Market Open
        else if (hour >= mh.marketOpenHour && hour < mh.marketCloseHour) {
            if (hour === mh.marketOpenHour && minute < mh.marketOpenMinute) {
                status = 'Pre-Market';
                color = 'var(--accent-orange)';
            } else {
                status = 'Market Open';
                color = 'var(--accent-green)';
            }
        }
        // Post-market
        else if (hour >= mh.marketCloseHour && hour < mh.postMarketCloseHour) {
            status = 'Post-Market';
            color = 'var(--accent-orange)';
        }
        // After hours closed
        else {
            status = 'Market Closed';
            color = 'var(--accent-red)';
            shouldPulse = false;
        }

        if (this.statusElement) {
            this.statusElement.textContent = status;
        }

        if (this.dotElement) {
            this.dotElement.style.background = color;
            this.dotElement.style.animation = shouldPulse ? 'pulse 2s ease-in-out infinite' : 'none';
        }
    }
    
    getTimeToOpen() {
        const now = new Date();
        const marketTime = new Date(now.toLocaleString('en-US', { timeZone: this.timezone }));

        const mh = this.marketHours;

        // Create next market open time
        const nextOpen = new Date(marketTime);
        nextOpen.setHours(mh.marketOpenHour, mh.marketOpenMinute, 0, 0);

        // If we're past market open today, target tomorrow
        if (marketTime.getHours() > mh.marketOpenHour ||
            (marketTime.getHours() === mh.marketOpenHour && marketTime.getMinutes() >= mh.marketOpenMinute)) {
            nextOpen.setDate(nextOpen.getDate() + 1);
        }

        // Skip weekends
        while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
            nextOpen.setDate(nextOpen.getDate() + 1);
        }

        const diff = nextOpen - marketTime;
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        return { hours, minutes, seconds, totalMs: diff };
    }
    
    startCountdown(elementId = 'marketCountdown') {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        const updateCountdown = () => {
            const time = this.getTimeToOpen();
            element.textContent = `${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}:${String(time.seconds).padStart(2, '0')}`;
        };
        
        updateCountdown();
        setInterval(updateCountdown, 1000);
    }
    
    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
    }
}

// Create global instance with default configuration
// Can be overridden by providing CONFIG.MARKET from config.js
window.marketStatus = new MarketStatus(
    typeof CONFIG !== 'undefined' && CONFIG.MARKET ? {
        timezone: CONFIG.MARKET.timezone,
        marketHours: CONFIG.MARKET.hours
    } : {}
);
