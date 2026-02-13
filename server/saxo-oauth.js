/**
 * Saxo Bank OAuth 2.0 Implementation
 * Handles authorization code flow and token management
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const TOKEN_FILE = path.join(__dirname, 'saxo-tokens.json');

class SaxoOAuth {
  constructor(config) {
    this.appKey = config.appKey;
    this.appSecret = config.appSecret;
    this.authUrl = config.authUrl;
    this.tokenUrl = config.tokenUrl;
    this.redirectUri = config.redirectUri;
    this.tokens = null;
    this.tokenRefreshTimer = null;
  }

  /**
   * Initialize OAuth - load existing tokens if available
   */
  async initialize() {
    try {
      const data = await fs.readFile(TOKEN_FILE, 'utf8');
      this.tokens = JSON.parse(data);

      // Check if token is expired or about to expire
      if (this.isTokenExpired()) {
        logger.info('Saxo token expired, will refresh on next request');
      } else {
        logger.info('Saxo OAuth tokens loaded successfully');
        this.scheduleTokenRefresh();
      }
    } catch (error) {
      logger.info('No existing Saxo tokens found - OAuth login required');
    }
  }

  /**
   * Generate authorization URL
   */
  getAuthorizationUrl(state = null) {
    const stateParam = state || crypto.randomBytes(16).toString('hex');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.appKey,
      redirect_uri: this.redirectUri,
      state: stateParam
    });

    return {
      url: `${this.authUrl}?${params.toString()}`,
      state: stateParam
    };
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokensFromCode(code) {
    try {
      const auth = Buffer.from(`${this.appKey}:${this.appSecret}`).toString('base64');

      const response = await axios.post(
        this.tokenUrl,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: this.redirectUri
        }).toString(),
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      this.tokens = {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_in: response.data.expires_in,
        expires_at: Date.now() + (response.data.expires_in * 1000),
        token_type: response.data.token_type
      };

      await this.saveTokens();
      this.scheduleTokenRefresh();

      logger.info('Saxo OAuth tokens obtained successfully');
      return this.tokens;
    } catch (error) {
      logger.error('Failed to get Saxo tokens:', error.response?.data || error.message);
      throw new Error('Failed to obtain Saxo access token');
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken() {
    if (!this.tokens || !this.tokens.refresh_token) {
      throw new Error('No refresh token available');
    }

    try {
      const auth = Buffer.from(`${this.appKey}:${this.appSecret}`).toString('base64');

      const response = await axios.post(
        this.tokenUrl,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refresh_token
        }).toString(),
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      this.tokens = {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_in: response.data.expires_in,
        expires_at: Date.now() + (response.data.expires_in * 1000),
        token_type: response.data.token_type
      };

      await this.saveTokens();
      this.scheduleTokenRefresh();

      logger.info('Saxo access token refreshed successfully');
      return this.tokens;
    } catch (error) {
      logger.error('Failed to refresh Saxo token:', error.response?.data || error.message);
      this.tokens = null;
      await this.clearTokens();
      throw new Error('Failed to refresh token - re-authentication required');
    }
  }

  /**
   * Get current access token (refresh if needed)
   */
  async getAccessToken() {
    if (!this.tokens) {
      throw new Error('No access token available - OAuth login required');
    }

    // If token expires in less than 5 minutes, refresh it
    if (this.tokens.expires_at - Date.now() < 5 * 60 * 1000) {
      logger.info('Token expiring soon, refreshing...');
      await this.refreshAccessToken();
    }

    return this.tokens.access_token;
  }

  /**
   * Check if token is expired
   */
  isTokenExpired() {
    if (!this.tokens || !this.tokens.expires_at) return true;
    return Date.now() >= this.tokens.expires_at;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return this.tokens !== null && !this.isTokenExpired();
  }

  /**
   * Save tokens to file
   */
  async saveTokens() {
    try {
      await fs.writeFile(TOKEN_FILE, JSON.stringify(this.tokens, null, 2));
      logger.info('Saxo tokens saved to file');
    } catch (error) {
      logger.error('Failed to save Saxo tokens:', error.message);
    }
  }

  /**
   * Clear stored tokens
   */
  async clearTokens() {
    try {
      await fs.unlink(TOKEN_FILE);
      logger.info('Saxo tokens cleared');
    } catch (error) {
      // File might not exist, ignore
    }
    this.tokens = null;
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
  }

  /**
   * Schedule automatic token refresh
   */
  scheduleTokenRefresh() {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
    }

    if (!this.tokens || !this.tokens.expires_at) return;

    // Refresh 5 minutes before expiry
    const refreshIn = this.tokens.expires_at - Date.now() - (5 * 60 * 1000);

    if (refreshIn > 0) {
      this.tokenRefreshTimer = setTimeout(async () => {
        try {
          await this.refreshAccessToken();
        } catch (error) {
          logger.error('Scheduled token refresh failed:', error.message);
        }
      }, refreshIn);

      logger.info(`Token refresh scheduled in ${Math.round(refreshIn / 1000 / 60)} minutes`);
    }
  }
}

module.exports = SaxoOAuth;
