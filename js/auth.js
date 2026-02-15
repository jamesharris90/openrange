/**
 * auth.js - Simple JWT token management for OpenRange
 */

const AUTH = {
  TOKEN_KEY: 'authToken',

  /**
   * Get the stored JWT token
   */
  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.getToken();
  },

  /**
   * Store JWT token after login
   */
  setToken(token) {
    localStorage.setItem(this.TOKEN_KEY, token);
  },

  /**
   * Clear token (logout)
   */
  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    window.location.href = '/login.html';
  },

  /**
   * Make authenticated API call (JWT + optional API key). Keeps legacy fetchSaxo compatible.
   */
  async fetchAPI(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (window.API_KEY) headers['x-api-key'] = window.API_KEY;

    try {
      const response = await fetch(endpoint, { ...options, headers });
      return response;
    } catch (error) {
      console.error('Auth fetch error:', error);
      throw error;
    }
  },

  // Backwards compatibility for existing calls
  async fetchSaxo(endpoint, options = {}) {
    return this.fetchAPI(endpoint, options);
  },

  /**
   * Verify token with server
   */
  async verify() {
    const token = this.getToken();
    console.log('[AUTH] Verifying token:', token ? 'Token exists' : 'No token');
    if (!token) return false;

    try {
      const response = await fetch('/api/auth/verify', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      console.log('[AUTH] Verify response status:', response.status, 'OK:', response.ok);

      if (!response.ok) {
        const data = await response.json();
        console.error('[AUTH] Verification failed:', data);
      }

      return response.ok;
    } catch (error) {
      console.error('[AUTH] Token verify error:', error);
      return false;
    }
  },

  /**
   * Protect a page (redirect to login if not authenticated)
   */
  async protect() {
    console.log('[AUTH] Protecting page:', window.location.pathname);

    if (!this.isAuthenticated()) {
      console.log('[AUTH] Not authenticated, redirecting to login');
      window.location.href = '/login.html';
      return;
    }

    console.log('[AUTH] Token found, verifying...');

    // Verify token is still valid
    const isValid = await this.verify();
    console.log('[AUTH] Verification result:', isValid);

    if (!isValid) {
      // Token is invalid or expired, clear it and redirect
      console.log('[AUTH] Token invalid, clearing and redirecting');
      localStorage.removeItem(this.TOKEN_KEY);
      window.location.href = '/login.html';
      return;
    }

    console.log('[AUTH] Protection check passed');
  }
};

// Note: Auto-protection disabled to prevent login loops
// Pages that need protection should manually call AUTH.protect() in their own scripts
// Example: document.addEventListener('DOMContentLoaded', () => AUTH.protect());
