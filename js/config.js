// API Configuration
const CONFIG = {
    // Dynamic API base URL (handles localhost vs production)
    API_BASE: location.hostname === 'localhost'
        ? 'http://localhost:3000'
        : window.location.origin,
    // Saxo API Configuration (use server-side proxy; do NOT expose tokens in client)
    // NOTE: These values will be loaded from the server's /api/config endpoint
    SAXO: {
        environment: 'live',
        // Frontend should point to the server proxy which forwards requests to the Saxo OpenAPI
        apiUrl: '/api/saxo',
        // These will be populated from server config
        accountNumber: null,
        clientKey: null
    },

    // API key for demo/public mode (set by server or inline script)
    API_KEY: window.API_KEY || undefined,

    // Currency conversion (EUR to GBP - update regularly)
    EUR_TO_GBP: 0.85,

    // Display preferences
    DISPLAY_CURRENCY: 'GBP',
    CURRENCY_SYMBOL: '£',

    // Cache settings
    NEWS_CACHE_DURATION: 5 * 60 * 1000, // 5 minutes

    // API Timeouts
    REQUEST_TIMEOUT: 10000, // 10 seconds

    // Market configuration
    MARKET: {
        timezone: 'America/New_York', // US Eastern for NYSE
        hours: {
            preMarketStart: 4,      // 4:00 AM
            marketOpenHour: 9,       // 9:30 AM
            marketOpenMinute: 30,
            marketCloseHour: 16,     // 4:00 PM
            postMarketCloseHour: 20  // 8:00 PM
        }
    }
};

// Configuration ready promise
let configReady = null;

// Load configuration from server
configReady = (async function loadServerConfig() {
    try {
        const response = await fetch(`${CONFIG.API_BASE}/api/config`);
        if (response.ok) {
            const serverConfig = await response.json();
            if (serverConfig.clientKey) CONFIG.SAXO.clientKey = serverConfig.clientKey;
            if (serverConfig.accountNumber) CONFIG.SAXO.accountNumber = serverConfig.accountNumber;
            console.log('Server config loaded:', { clientKey: CONFIG.SAXO.clientKey, accountNumber: CONFIG.SAXO.accountNumber });
        }
    } catch (error) {
        console.warn('Failed to load server config:', error.message);
    }
})();

// Export promise for other modules to wait on
window.configReady = configReady;
