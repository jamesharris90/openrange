// Global Filter Layout configuration for OpenRange filter experiences
// Defines tab groupings per page and shared layout tokens
(function attachFilterLayoutConfig(global) {
  if (global.FilterLayoutConfig) return;

  const baseConfig = {
    layout: {
      maxWidth: 1320,
      columnsDesktop: 3,
      columnsTablet: 2,
      columnsMobile: 1,
      gap: 12,
    },
    tabs: {
      descriptive: { id: 'descriptive', label: 'Descriptive' },
      fundamental: { id: 'fundamental', label: 'Fundamental' },
      technical: { id: 'technical', label: 'Technical' },
      structure: { id: 'structure', label: 'Structure' },
      catalyst: { id: 'catalyst', label: 'Catalyst' },
      all: { id: 'all', label: 'All' },
    },
    pages: {
      'advanced-screener': {
        pageKey: 'advanced-screener',
        tabOrder: ['descriptive', 'technical', 'structure', 'catalyst', 'all'],
        sectionMap: {
          descriptive: ['Descriptive'],
          technical: ['Technical'],
          structure: ['Fundamental'],
          catalyst: ['News'],
          all: ['Descriptive', 'Fundamental', 'Technical', 'News'],
        },
      },
      'news-scanner': {
        pageKey: 'news-scanner',
        tabOrder: ['descriptive', 'technical', 'structure', 'catalyst', 'all'],
        sectionMap: {
          descriptive: ['liquidity'],
          technical: ['volatility'],
          structure: ['structure'],
          catalyst: ['catalyst'],
          all: ['liquidity', 'volatility', 'structure', 'catalyst', 'quick', 'squeeze'],
        },
      },
    },
  };

  function deepFreeze(obj) {
    Object.getOwnPropertyNames(obj).forEach((prop) => {
      const value = obj[prop];
      if (value && typeof value === 'object') {
        deepFreeze(value);
      }
    });
    return Object.freeze(obj);
  }

  function validateConfig(config) {
    const { tabs, pages } = config;

    Object.entries(pages).forEach(([key, page]) => {
      if (!page || page.pageKey !== key) {
        console.warn('[FilterLayoutConfig] Page key mismatch:', key);
      }

      const tabOrder = Array.isArray(page.tabOrder) ? page.tabOrder : [];
      const unknownTabs = tabOrder.filter((tabId) => !tabs[tabId]);
      if (unknownTabs.length) {
        console.warn('[FilterLayoutConfig] Unknown tabs in tabOrder for', key, unknownTabs);
      }
    });
  }

  function createAccessor(config) {
    return function getPageConfig(pageKey) {
      if (!pageKey) {
        console.warn('[FilterLayoutConfig] Missing pageKey');
        return null;
      }
      const page = config.pages[pageKey];
      if (!page) {
        console.warn('[FilterLayoutConfig] Unknown pageKey requested:', pageKey);
        return null;
      }
      return page;
    };
  }

  validateConfig(baseConfig);

  const frozenConfig = deepFreeze({
    ...baseConfig,
    getPageConfig: null,
  });

  // Attach accessor after freeze by defining a non-writable property
  Object.defineProperty(frozenConfig, 'getPageConfig', {
    value: createAccessor(baseConfig),
    writable: false,
    configurable: false,
    enumerable: true,
  });

  global.FilterLayoutConfig = frozenConfig;
})(window);
