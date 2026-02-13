/**
 * utils.js - Common utility functions for OpenRange Trader
 */

// Symbol autocomplete and validation
const SymbolSearch = {
  // Cache for symbol data
  symbolCache: null,

  // Initialize with common symbols
  commonSymbols: [
    'SPY', 'QQQ', 'IWM', 'DIA', 'TSLA', 'AAPL', 'NVDA', 'AMD', 'MSFT', 'GOOGL',
    'AMZN', 'META', 'NFLX', 'PLTR', 'SOFI', 'COIN', 'MARA', 'RIOT', 'GME', 'AMC',
    'TAL', 'AXTI', 'BABA', 'NIO', 'XPEV', 'LI', 'PDD', 'JD', 'BIDU', 'TSM'
  ],

  // Keyword aliases to tickers (helps when typing parts of company names)
  keywordAliases: [
    { ticker: 'TSLA', keywords: ['TES', 'TESL', 'TESLA'] },
    { ticker: 'AAPL', keywords: ['APPL', 'APPLE'] },
    { ticker: 'META', keywords: ['FB', 'META'] },
    { ticker: 'GOOGL', keywords: ['GOOG', 'GOOGL', 'ALPH'] },
    { ticker: 'MSFT', keywords: ['MS', 'MSFT', 'MICRO'] }
  ],

  /**
   * Search for symbols matching the query
   */
  async search(query) {
    if (!query || query.length < 1) return [];

    query = query.toUpperCase();

    // Ensure cache is loaded (lazy, lightweight)
    try {
      await this.ensureCache();
    } catch (e) {
      console.warn('Symbol cache load failed, using common symbols only');
    }

    const universe = Array.isArray(this.symbolCache) ? this.symbolCache : [];

    // Search in common symbols first
    const combined = [...new Set([...this.commonSymbols, ...universe])];

    const scored = combined.map(sym => {
      if (sym === query) return { sym, score: 0 };
      if (sym.startsWith(query)) return { sym, score: 1 };
      if (sym.includes(query)) return { sym, score: 2 };
      return { sym, score: 3 };
    }).filter(entry => entry.score < 3);

    scored.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.sym.length - b.sym.length;
    });

    const matches = scored.map(entry => entry.sym);

    // Alias hits (e.g., TES -> TSLA)
    this.keywordAliases.forEach(entry => {
      if (!entry || !entry.ticker || !Array.isArray(entry.keywords)) return;
      if (entry.keywords.some(k => query.includes(k) || k.includes(query))) {
        matches.push(entry.ticker.toUpperCase());
      }
    });

    const unique = [...new Set(matches)];
    return unique.slice(0, 10);
  },

  async ensureCache() {
    if (this.symbolCache) return this.symbolCache;

    // Try to pull a small universe from Finviz (S&P 500 across a few pages)
    const pages = [1, 21, 41];
    const collected = new Set(this.commonSymbols);

    try {
      const fetchPage = async (r) => {
        const res = await fetch(`/api/finviz/screener?f=idx_sp500&v=111&r=${r}`);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      };

      const results = await Promise.all(pages.map(fetchPage));
      results.flat().forEach(row => {
        const sym = row.Ticker || row.Symbol;
        if (sym) collected.add(sym.toUpperCase());
      });
    } catch (e) {
      console.warn('SymbolSearch cache fetch failed', e);
    }

    this.symbolCache = Array.from(collected);
    return this.symbolCache;
  },

  /**
   * Create autocomplete input for symbol search
   */
  createAutocomplete(inputId, onSelectCallback) {
    const input = document.getElementById(inputId);
    if (!input) return;

    // Create autocomplete container
    const container = document.createElement('div');
    container.className = 'symbol-autocomplete';
    container.style.cssText = `
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      width: 100%;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      max-height: 300px;
      overflow-y: auto;
      display: none;
      z-index: 1000;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    `;

    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(container);

    // Handle input
    input.addEventListener('input', async (e) => {
      const query = e.target.value;
      if (!query || query.length < 1) {
        container.style.display = 'none';
        return;
      }

      const results = await this.search(query);

      if (results.length === 0) {
        container.style.display = 'none';
        return;
      }

      container.innerHTML = results.map(symbol => `
        <div class="autocomplete-item" data-symbol="${symbol}"
          style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid var(--border-color);">
          <strong>${symbol}</strong>
        </div>
      `).join('');

      container.style.display = 'block';

      // Handle item clicks
      container.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('mouseenter', () => {
          item.style.background = 'var(--bg-secondary)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = '';
        });
        item.addEventListener('click', () => {
          const symbol = item.dataset.symbol;
          input.value = symbol;
          container.style.display = 'none';
          if (onSelectCallback) onSelectCallback(symbol);
        });
      });
    });

    // Hide autocomplete when clicking outside
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !container.contains(e.target)) {
        container.style.display = 'none';
      }
    });

    // Handle Enter key
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const symbol = input.value.toUpperCase().trim();
        container.style.display = 'none';
        if (symbol && onSelectCallback) onSelectCallback(symbol);
      }
    });
  }
};

// ORB Trading Rules
const ORBRules = {
  rules: [
    {
      title: "Identify ORB Candidates",
      description: "Look for stocks with 5%+ pre-market gap on above-average volume (2x+ normal)",
      tips: ["Check pre-market gainers screener", "Verify news catalyst", "Confirm volume spike"]
    },
    {
      title: "Mark Opening Range",
      description: "Note the high and low of the first 5-15 minutes after market open (9:30-9:45 AM ET)",
      tips: ["Use 5-min chart", "Draw horizontal lines at high/low", "Wait for consolidation"]
    },
    {
      title: "Wait for Breakout",
      description: "Enter long when price breaks above ORB high with volume, or short when it breaks ORB low",
      tips: ["Confirm with volume increase", "Look for clean break", "Avoid choppy ranges"]
    },
    {
      title: "Set Stop Loss",
      description: "Place stop below ORB low for longs, or above ORB high for shorts",
      tips: ["Risk 1-2% of account", "Use tight stops", "Trail stop as position moves"]
    },
    {
      title: "Take Profit",
      description: "Target 1.5-3x the ORB height, or trail stops at prior resistance/support",
      tips: ["Scale out at targets", "Use trailing stops", "Watch for reversal signals"]
    },
    {
      title: "Best Time Window",
      description: "Most ORB trades work best in first 1-2 hours (9:30-11:30 AM ET)",
      tips: ["Avoid lunch consolidation", "Best breakouts happen early", "Volume decreases after 11 AM"]
    }
  ],

  /**
   * Display ORB rules in a modal or container
   */
  display(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      // Create modal if container doesn't exist
      this.showModal();
      return;
    }

    container.innerHTML = `
      <div style="padding: 24px;">
        <h2 style="margin-bottom: 24px; color: var(--accent-blue);">
          Opening Range Breakout (ORB) Trading Rules
        </h2>
        ${this.rules.map((rule, index) => `
          <div style="margin-bottom: 24px; padding: 20px; background: var(--bg-secondary); border-radius: 8px; border-left: 4px solid var(--accent-blue);">
            <h3 style="margin-bottom: 8px; color: var(--text-primary);">
              ${index + 1}. ${rule.title}
            </h3>
            <p style="margin-bottom: 12px; color: var(--text-secondary);">
              ${rule.description}
            </p>
            <ul style="margin: 0; padding-left: 20px; color: var(--text-muted);">
              ${rule.tips.map(tip => `<li style="margin-bottom: 4px;">${tip}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
        <div style="margin-top: 24px; padding: 16px; background: rgba(74, 158, 255, 0.1); border-radius: 8px;">
          <strong style="color: var(--accent-blue);">Pro Tip:</strong>
          <span style="color: var(--text-secondary);">
            ORB strategy works best on stocks with clear catalysts, strong pre-market movement, and high relative volume.
            Always have a plan before entering, and stick to your risk management rules.
          </span>
        </div>
      </div>
    `;
  },

  /**
   * Show rules in a modal overlay
   */
  showModal() {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.8);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
      background: var(--bg-primary);
      border-radius: 12px;
      max-width: 800px;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
    `;

    content.innerHTML = `
      <button onclick="this.closest('[style*=fixed]').remove()"
        style="position: sticky; top: 16px; right: 16px; float: right; z-index: 1;
        background: var(--accent-red); color: white; border: none; border-radius: 6px;
        padding: 8px 16px; cursor: pointer; font-weight: 600;">
        Close
      </button>
      <div id="orbRulesContent"></div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    this.display('orbRulesContent');

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }
};

// Market data helpers
const MarketData = {
  /**
   * Format time ago from timestamp
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
  },

  /**
   * Format currency
   */
  formatCurrency(amount, decimals = 2) {
    return `$${amount.toFixed(decimals)}`;
  },

  /**
   * Format percentage
   */
  formatPercentage(value, decimals = 2) {
    return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
  },

  /**
   * Get market status
   */
  getMarketStatus() {
    const now = new Date();
    const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = ny.getHours();
    const minute = ny.getMinutes();
    const day = ny.getDay();

    if (day === 0 || day === 6) {
      return { status: 'closed', text: 'Market Closed (Weekend)', color: 'var(--accent-red)' };
    }

    if (hour >= 4 && (hour < 9 || (hour === 9 && minute < 30))) {
      return { status: 'premarket', text: 'Pre-Market', color: 'var(--accent-orange)' };
    }

    if (hour >= 9 && hour < 16) {
      if (hour === 9 && minute < 30) {
        return { status: 'premarket', text: 'Pre-Market', color: 'var(--accent-orange)' };
      }
      return { status: 'open', text: 'Market Open', color: 'var(--accent-green)' };
    }

    if (hour >= 16 && hour < 20) {
      return { status: 'postmarket', text: 'Post-Market', color: 'var(--accent-orange)' };
    }

    return { status: 'closed', text: 'Market Closed', color: 'var(--accent-red)' };
  }
};

// Export for use in other files
window.SymbolSearch = SymbolSearch;
window.ORBRules = ORBRules;
window.MarketData = MarketData;
