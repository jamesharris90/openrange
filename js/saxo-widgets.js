/**
 * saxo-widgets.js - Conditional Saxo widget rendering
 * Shows Saxo widgets only if user has connected their Saxo account
 */

const SaxoWidgets = {
    isConnected: false,
    isChecked: false,
    connectionPromise: null,

    /**
     * Check if current user has Saxo connected
     * Returns a promise that resolves to true/false
     */
    async checkConnection() {
        // Return cached result if already checked
        if (this.isChecked) {
            return this.isConnected;
        }

        // If check is in progress, wait for it
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        this.connectionPromise = this._doCheck();
        return this.connectionPromise;
    },

    async _doCheck() {
        try {
            const token = localStorage.getItem('authToken');

            // If not logged in, not connected
            if (!token) {
                this.isConnected = false;
                this.isChecked = true;
                return false;
            }

            // Check user-level Saxo status
            const response = await fetch('/api/users/saxo/status', {
                headers: { 'Authorization': 'Bearer ' + token }
            });

            if (response.ok) {
                const data = await response.json();
                this.isConnected = data.connected === true;
            } else {
                // Fall back to server-level Saxo status for backwards compatibility
                const serverResponse = await fetch('/api/saxo/auth/status');
                if (serverResponse.ok) {
                    const serverData = await serverResponse.json();
                    this.isConnected = serverData.authenticated === true;
                } else {
                    this.isConnected = false;
                }
            }

            this.isChecked = true;
            return this.isConnected;
        } catch (error) {
            console.error('Failed to check Saxo connection:', error);
            this.isConnected = false;
            this.isChecked = true;
            return false;
        }
    },

    /**
     * Initialize widgets on page - shows/hides based on connection status
     * Call this after DOM is loaded
     */
    async init() {
        const connected = await this.checkConnection();

        // Find all Saxo widget containers
        const saxoWidgets = document.querySelectorAll('[data-saxo-widget]');
        const saxoPlaceholders = document.querySelectorAll('[data-saxo-placeholder]');
        const saxoConnectPrompts = document.querySelectorAll('[data-saxo-connect-prompt]');

        if (connected) {
            // Show widgets, hide placeholders and prompts
            saxoWidgets.forEach(el => el.style.display = '');
            saxoPlaceholders.forEach(el => el.style.display = 'none');
            saxoConnectPrompts.forEach(el => el.style.display = 'none');
        } else {
            // Hide widgets, show placeholders and prompts
            saxoWidgets.forEach(el => el.style.display = 'none');
            saxoPlaceholders.forEach(el => el.style.display = '');
            saxoConnectPrompts.forEach(el => el.style.display = '');
        }

        // Dispatch event for custom handling
        window.dispatchEvent(new CustomEvent('saxo-status-checked', {
            detail: { connected }
        }));

        return connected;
    },

    /**
     * Create a connection prompt element
     */
    createConnectPrompt(options = {}) {
        const {
            title = 'Connect Saxo Bank',
            message = 'Connect your Saxo Bank account to view live trading data and access advanced features.',
            buttonText = 'Connect Saxo Account',
            showInProfile = true
        } = options;

        const prompt = document.createElement('div');
        prompt.className = 'saxo-connect-prompt';
        prompt.setAttribute('data-saxo-connect-prompt', '');
        prompt.innerHTML = `
            <div style="
                background: var(--bg-card, #1a1f2e);
                border: 1px solid var(--border-color, #2d3748);
                border-radius: 12px;
                padding: 32px;
                text-align: center;
                max-width: 400px;
                margin: 24px auto;
            ">
                <div style="
                    width: 64px;
                    height: 64px;
                    background: linear-gradient(135deg, #4a9eff 0%, #2563eb 100%);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 16px;
                ">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                </div>
                <h3 style="
                    color: var(--text-primary, #f8fafc);
                    font-size: 1.2em;
                    margin: 0 0 8px;
                ">${title}</h3>
                <p style="
                    color: var(--text-muted, #64748b);
                    font-size: 0.95em;
                    margin: 0 0 20px;
                    line-height: 1.6;
                ">${message}</p>
                <button onclick="${showInProfile ? "window.location.href='user.html'" : "window.location.href='/auth/saxo/login'"}" style="
                    background: linear-gradient(135deg, #4a9eff 0%, #2563eb 100%);
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 8px;
                    font-weight: 600;
                    font-size: 0.95em;
                    cursor: pointer;
                    transition: opacity 0.2s;
                " onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                    ${buttonText}
                </button>
                ${showInProfile ? `
                <p style="
                    color: var(--text-muted, #64748b);
                    font-size: 0.8em;
                    margin: 12px 0 0;
                ">Go to your Profile page to connect</p>
                ` : ''}
            </div>
        `;

        return prompt;
    },

    /**
     * Wrap existing widget in conditional container
     * @param {HTMLElement} widget - The widget element to wrap
     * @param {Object} options - Options for the placeholder
     */
    wrapWidget(widget, options = {}) {
        if (!widget) return null;

        // Mark as Saxo widget
        widget.setAttribute('data-saxo-widget', '');

        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'saxo-widget-wrapper';

        // Insert wrapper
        widget.parentNode.insertBefore(wrapper, widget);
        wrapper.appendChild(widget);

        // Add placeholder
        const placeholder = this.createConnectPrompt(options);
        wrapper.appendChild(placeholder);

        return wrapper;
    },

    /**
     * Conditionally render content based on Saxo connection
     * @param {Function} connectedCallback - Called if Saxo is connected
     * @param {Function} disconnectedCallback - Called if Saxo is not connected
     */
    async conditional(connectedCallback, disconnectedCallback) {
        const connected = await this.checkConnection();

        if (connected && typeof connectedCallback === 'function') {
            connectedCallback();
        } else if (!connected && typeof disconnectedCallback === 'function') {
            disconnectedCallback();
        }

        return connected;
    },

    /**
     * Reset connection status (call after connect/disconnect)
     */
    reset() {
        this.isConnected = false;
        this.isChecked = false;
        this.connectionPromise = null;
    }
};

// Auto-initialize on DOM ready if requested
document.addEventListener('DOMContentLoaded', function() {
    // Check for auto-init flag
    if (document.querySelector('[data-saxo-auto-init]')) {
        SaxoWidgets.init();
    }
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SaxoWidgets;
}
