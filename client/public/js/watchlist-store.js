// Shared watchlist storage across pages
(function() {
	const STORAGE_KEY = 'userWatchlist';
	const subscribers = [];

	function load() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			const parsed = raw ? JSON.parse(raw) : [];
			return Array.isArray(parsed) ? parsed : [];
		} catch (e) {
			console.warn('[watchlist] failed to parse storage', e);
			return [];
		}
	}

	function save(list) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
		subscribers.forEach(fn => fn(list));
	}

	function normalizeSymbol(sym) {
		return (sym || '').trim().toUpperCase();
	}

	function getList() {
		return load();
	}

	function add(symbol, source = 'manual') {
		const sym = normalizeSymbol(symbol);
		if (!sym) return false;
		const list = load();
		if (list.some(item => item.symbol === sym)) return false;
		list.push({ symbol: sym, source, addedAt: new Date().toISOString() });
		save(list);
		return true;
	}

	function remove(symbol) {
		const sym = normalizeSymbol(symbol);
		const list = load().filter(item => item.symbol !== sym);
		save(list);

		// No longer syncs with emWatchlist; unified under userWatchlist
	}

	function has(symbol) {
		const sym = normalizeSymbol(symbol);
		return load().some(item => item.symbol === sym);
	}

	function onChange(fn) {
		if (typeof fn === 'function') subscribers.push(fn);
	}

	// Auto-prune non-manual items older than 7 days
	const STALE_MS = 7 * 24 * 60 * 60 * 1000;
	(function pruneStale() {
		const list = load();
		const now = Date.now();
		const pruned = list.filter(item => {
			if (item.source === 'manual') return true;
			if (!item.addedAt) return true;
			return (now - new Date(item.addedAt).getTime()) < STALE_MS;
		});
		if (pruned.length !== list.length) save(pruned);
	})();

	window.WATCHLIST = { getList, add, remove, has, onChange };
})();
