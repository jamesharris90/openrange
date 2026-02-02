// Market Status Logic
// Handles market hours, countdown, and status display

class MarketStatus {
    constructor() {
        this.statusElement = null;
        this.dotElement = null;
        this.updateInterval = null;
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
        const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const hour = ny.getHours();
        const minute = ny.getMinutes();
        const day = ny.getDay();
        
        let status = '';
        let color = '';
        let shouldPulse = true;
        
        // Weekend check
        if (day === 0 || day === 6) {
            status = 'Market Closed (Weekend)';
            color = 'var(--accent-red)';
            shouldPulse = false;
        }
        // Pre-market (4:00 AM - 9:30 AM ET)
        else if (hour >= 4 && (hour < 9 || (hour === 9 && minute < 30))) {
            status = 'Pre-Market';
            color = 'var(--accent-orange)';
        }
        // Market Open (9:30 AM - 4:00 PM ET) - FIXED LOGIC
        else if (hour >= 9 && hour < 16) {
            if (hour === 9 && minute < 30) {
                status = 'Pre-Market';
                color = 'var(--accent-orange)';
            } else {
                status = 'Market Open';
                color = 'var(--accent-green)';
            }
        }
        // Post-market (4:00 PM - 8:00 PM ET)
        else if (hour >= 16 && hour < 20) {
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
        const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        
        // Create next market open time (9:30 AM ET)
        const nextOpen = new Date(ny);
        nextOpen.setHours(9, 30, 0, 0);
        
        // If we're past 9:30 AM today, target tomorrow
        if (ny.getHours() > 9 || (ny.getHours() === 9 && ny.getMinutes() >= 30)) {
            nextOpen.setDate(nextOpen.getDate() + 1);
        }
        
        // Skip weekends
        while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
            nextOpen.setDate(nextOpen.getDate() + 1);
        }
        
        const diff = nextOpen - ny;
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

// Create global instance
window.marketStatus = new MarketStatus();
