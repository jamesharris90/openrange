// API Configuration
const CONFIG = {
    // Dynamic API base URL (handles localhost vs production)
    API_BASE: location.hostname === 'localhost' 
        ? 'http://localhost:8080' 
        : window.location.origin,
    // Saxo API Configuration (use server-side proxy; do NOT expose tokens in client)
    // NOTE: Move all secrets to server environment variables and point `apiUrl` to the proxy endpoint.
    SAXO: {
        environment: 'live',
        // Frontend should point to the server proxy which forwards requests to the Saxo OpenAPI
        apiUrl: '/api/saxo',
        // Replace sensitive values with placeholders. Do not store secrets in the client.
        accountNumber: 'REPLACE_WITH_ACCOUNT_NUMBER',
        clientKey: 'REPLACE_WITH_CLIENT_KEY'
    },
    
    // Currency conversion (EUR to GBP - update regularly)
    EUR_TO_GBP: 0.85,
    
    // Display preferences
    DISPLAY_CURRENCY: 'GBP',
    CURRENCY_SYMBOL: '£',
    
    // Cache settings
    NEWS_CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
    
    // API Timeouts
    REQUEST_TIMEOUT: 10000 // 10 seconds
};
