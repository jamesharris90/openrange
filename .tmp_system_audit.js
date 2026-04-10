const fs = require('fs');
const path = require('path');

const ROOT = '/Users/jamesharris/Server';
const NEXT_API_ROOT = path.join(ROOT, 'trading-os', 'src', 'app', 'api');
const FRONTEND_ROOT = path.join(ROOT, 'trading-os', 'src');
const BACKEND_V2_INDEX = path.join(ROOT, 'server', 'v2', 'index.js');
const REPORTS = {
	apiMap: path.join(ROOT, 'SYSTEM_API_MAP.json'),
	dataHealth: path.join(ROOT, 'DATA_HEALTH_REPORT.json'),
	rootCause: path.join(ROOT, 'DATA_ROOT_CAUSE_REPORT.json'),
};

function walkDir(dirPath) {
	const entries = fs.readdirSync(dirPath, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);
		if (entry.isDirectory()) files.push(...walkDir(fullPath));
		else files.push(fullPath);
	}
	return files;
}

function toPosix(value) {
	return value.split(path.sep).join('/');
}

function read(filePath) {
	return fs.readFileSync(filePath, 'utf8');
}

function lineNumberOf(content, needle) {
	const index = content.indexOf(needle);
	if (index === -1) return null;
	return content.slice(0, index).split('\n').length;
}

function routePathFromFile(filePath) {
	const relative = toPosix(path.relative(NEXT_API_ROOT, filePath));
	const withoutRoute = relative.replace(/\/route\.(t|j)sx?$/, '');
	return `/api/${withoutRoute === '' ? '' : withoutRoute}`.replace(/\/+/g, '/');
}

function extractNextRouteTargets(filePath) {
	const content = read(filePath);
	const targets = [];
	const regexes = [
		/backendGet\(request,\s*['"`]([^'"`]+)['"`]\)/g,
		/backendPost\(request,\s*['"`]([^'"`]+)['"`]\)/g,
		/fetch\(\s*`\$\{API_BASE\}([^`]+)`/g,
		/fetch\(\s*`\$\{SITE_URL\}([^`]+)`/g,
		/return backendGet\([^\n]+['"`]([^'"`]+)['"`]/g,
	];
	for (const regex of regexes) {
		for (const match of content.matchAll(regex)) {
			targets.push(match[1]);
		}
	}
	return Array.from(new Set(targets));
}

function collectNextRoutes() {
	return walkDir(NEXT_API_ROOT)
		.filter((filePath) => /\/route\.(t|j)sx?$/.test(filePath))
		.map((filePath) => ({
			route: routePathFromFile(filePath),
			file: toPosix(path.relative(ROOT, filePath)),
			targets: extractNextRouteTargets(filePath),
		}))
		.sort((a, b) => a.route.localeCompare(b.route));
}

function collectBackendMounts() {
	const content = read(BACKEND_V2_INDEX);
	const requireMap = new Map();
	for (const match of content.matchAll(/const\s+(\w+)\s*=\s*require\(['"`]([^'"`]+)['"`]\);/g)) {
		requireMap.set(match[1], match[2]);
	}
	const mounts = [];
	for (const match of content.matchAll(/app\.use\(['"`]([^'"`]+)['"`],\s*(\w+)\);/g)) {
		mounts.push({
			path: match[1],
			variable: match[2],
			module: requireMap.get(match[2]) || null,
		});
	}
	return mounts;
}

function collectFrontendCalls() {
	const apiPattern = /(apiFetch|apiGet|fetch)\(([^\n;]+)/g;
	const files = walkDir(FRONTEND_ROOT).filter((filePath) => /\.(t|j)sx?$/.test(filePath));
	const calls = [];
	for (const filePath of files) {
		const content = read(filePath);
		const lines = content.split('\n');
		lines.forEach((line, index) => {
			if (line.includes('/api/') || line.includes('localhost:3007') || line.includes('NEXT_PUBLIC_API_BASE') || line.includes('BACKEND_URL')) {
				if (/(apiFetch|apiGet|fetch|API_BASE|SITE_URL)/.test(line)) {
					calls.push({
						file: toPosix(path.relative(ROOT, filePath)),
						line: index + 1,
						code: line.trim(),
					});
				}
			}
		});
	}
	return calls;
}

function findDirectBackendRisks(frontendCalls) {
	return frontendCalls.filter((item) => item.code.includes('localhost:3007') || item.code.includes('NEXT_PUBLIC_API_BASE') || item.code.includes('BACKEND_URL'));
}

function findDuplicates(mounts) {
	const grouped = new Map();
	for (const mount of mounts) {
		const key = mount.module || mount.variable;
		if (!grouped.has(key)) grouped.set(key, []);
		grouped.get(key).push(mount.path);
	}
	return Array.from(grouped.entries())
		.filter(([, paths]) => paths.length > 1)
		.map(([module, paths]) => ({ module, paths: paths.sort() }));
}

function findMissingProxyCandidates(nextRoutes, frontendCalls) {
	const nextRouteSet = new Set(nextRoutes.map((item) => item.route));
	const candidates = [];
	for (const call of frontendCalls) {
		const match = call.code.match(/['"`]([^'"`]*\/api\/[^'"`]+)['"`]/);
		if (!match) continue;
		const full = match[1];
		if (full.includes('localhost:3007')) continue;
		const normalized = full.replace(/^.*?(\/api\/)/, '/api/').split('?')[0];
		if (!nextRouteSet.has(normalized) && !normalized.startsWith('/api/stream/')) {
			candidates.push({
				path: normalized,
				source: `${call.file}:${call.line}`,
			});
		}
	}
	const unique = new Map();
	for (const candidate of candidates) {
		const key = `${candidate.path}@@${candidate.source}`;
		unique.set(key, candidate);
	}
	return Array.from(unique.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function walkData(value, prefix = '') {
	const nullFields = [];
	const emptyArrays = [];
	if (Array.isArray(value)) {
		if (value.length === 0) emptyArrays.push(prefix || '<root>');
		value.forEach((item, index) => {
			const nested = walkData(item, `${prefix}[${index}]`);
			nullFields.push(...nested.nullFields);
			emptyArrays.push(...nested.emptyArrays);
		});
		return { nullFields, emptyArrays };
	}
	if (value && typeof value === 'object') {
		for (const [key, item] of Object.entries(value)) {
			const next = prefix ? `${prefix}.${key}` : key;
			if (item === null || typeof item === 'undefined') {
				nullFields.push(next);
			} else if (Array.isArray(item) && item.length === 0) {
				emptyArrays.push(next);
			}
			if (typeof item === 'object') {
				const nested = walkData(item, next);
				nullFields.push(...nested.nullFields);
				emptyArrays.push(...nested.emptyArrays);
			}
		}
	}
	return { nullFields, emptyArrays };
}

async function fetchJsonWithTiming(url) {
	const start = Date.now();
	let response;
	try {
		response = await fetch(url, { headers: { Accept: 'application/json' } });
	} catch (error) {
		return {
			url,
			status: 0,
			ok: false,
			responseTimeMs: Date.now() - start,
			parse: 'error',
			error: error instanceof Error ? error.message : String(error),
			topKeys: [],
			nullFields: [],
			emptyArrays: [],
			checks: {},
		};
	}

	const responseTimeMs = Date.now() - start;
	const raw = await response.text();
	let json = null;
	let parse = 'text';
	try {
		json = JSON.parse(raw);
		parse = 'json';
	} catch {
		json = null;
	}
	const walked = walkData(json);
	const entry = {
		url,
		status: response.status,
		ok: response.ok,
		responseTimeMs,
		parse,
		topKeys: json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json).sort() : [],
		nullFields: walked.nullFields.slice(0, 120),
		emptyArrays: walked.emptyArrays.slice(0, 120),
		checks: {},
		sample: parse === 'json' ? JSON.stringify(json).slice(0, 1500) : raw.slice(0, 1500),
	};

	if (url.includes('/api/research/')) {
		const history = Array.isArray(json?.earnings?.history) ? json.earnings.history : [];
		entry.checks = {
			historyLength: history.length,
			hasExpectedMovePercent: history.some((row) => row?.expected_move_percent != null) || json?.earnings?.next?.expected_move_percent != null,
			hasActualMovePercent: history.some((row) => row?.actual_move_percent != null),
			hasBeatBoolean: history.some((row) => typeof row?.beat === 'boolean'),
			hasEpsActual: history.some((row) => row?.eps_actual != null),
			hasEpsEstimate: history.some((row) => row?.eps_estimate != null),
			hasSurprisePercent: history.some((row) => row?.surprise_percent != null),
			hasPostMovePercent: history.some((row) => row?.post_move_percent != null),
		};
	}

	if (url.includes('/api/screener') || url.includes('/api/opportunities')) {
		const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json?.rows) ? json.rows : [];
		entry.checks = { rowCount: rows.length };
	}

	if (url.includes('/api/v5/chart')) {
		const rows = Array.isArray(json?.candles) ? json.candles : Array.isArray(json?.data) ? json.data : Array.isArray(json?.dailyCandles) ? json.dailyCandles : [];
		entry.checks = {
			candleCount: rows.length,
			hasOhlcData: rows.some((row) => row && ((row.open != null && row.high != null && row.low != null && row.close != null) || (row.o != null && row.h != null && row.l != null && row.c != null))),
		};
	}

	if (url.endsWith('/api/earnings')) {
		const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
		entry.checks = {
			rowCount: rows.length,
			hasExpectedMovePercent: rows.some((row) => row?.expected_move_percent != null || row?.expectedMovePercent != null),
			hasActualMovePercent: rows.some((row) => row?.actual_move_percent != null || row?.actualMovePercent != null),
			hasEpsActual: rows.some((row) => row?.eps_actual != null),
			hasEpsEstimate: rows.some((row) => row?.eps_estimate != null),
			hasSurprisePercent: rows.some((row) => row?.surprise_percent != null),
			beatDerivable: rows.some((row) => row?.eps_actual != null && row?.eps_estimate != null),
		};
	}

	return entry;
}

function buildRootCauseReport(dataHealth, apiMap) {
	const report = [];
	const byUrl = Object.fromEntries(dataHealth.endpoints.map((item) => [item.url, item]));

	const chart = byUrl['http://localhost:3000/api/v5/chart?symbol=AAPL'];
	if (chart) {
		report.push({
			endpoint: chart.url,
			issue: chart.status === 404 ? 'chart endpoint unavailable on Next public contract' : chart.checks.candleCount === 0 ? 'chart returned empty dataset' : 'healthy',
			type: chart.status === 404 ? 'A_missing_backend_or_proxy_route' : chart.checks.candleCount === 0 ? 'B_bad_query_or_empty_result' : 'healthy',
			evidence: {
				status: chart.status,
				checks: chart.checks,
			},
			codePath: {
				frontend: 'trading-os/src/components/research/ResearchChartPanel.jsx -> /api/v5/chart',
				nextProxy: 'missing universal /api/[...path] proxy and no dedicated /api/v5/chart route',
				backend: 'server/v2/index.js mounts /api/v5 -> server/routes/chartV2.ts',
			},
		});
	}

	const earnings = byUrl['http://localhost:3000/api/earnings'];
	if (earnings) {
		const missingHistorical = !earnings.checks.hasActualMovePercent && !earnings.checks.hasSurprisePercent && !earnings.checks.beatDerivable;
		report.push({
			endpoint: earnings.url,
			issue: missingHistorical ? 'public earnings endpoint only returns upcoming calendar rows, not beat/miss history' : 'healthy',
			type: missingHistorical ? 'D_wrong_field_mapping_or_contract' : 'healthy',
			evidence: {
				status: earnings.status,
				checks: earnings.checks,
			},
			codePath: {
				frontend: 'trading-os/src/app/api/earnings/route.ts -> /api/earnings/calendar envelope',
				backend: 'server/v2/routes/earnings.js -> server/v2/services/earningsService.js',
				database: 'earnings_events selected columns exclude expected_move_percent, actual_move_percent, surprise_percent, beat',
			},
		});
	}

	const opportunities = byUrl['http://localhost:3000/api/opportunities'];
	if (opportunities) {
		report.push({
			endpoint: opportunities.url,
			issue: opportunities.checks.rowCount === 0 ? 'opportunities route is healthy but snapshot currently has zero rows' : 'healthy',
			type: opportunities.checks.rowCount === 0 ? 'C_empty_database_or_snapshot' : 'healthy',
			evidence: {
				status: opportunities.status,
				checks: opportunities.checks,
			},
			codePath: {
				nextProxy: 'trading-os/src/app/api/opportunities/route.ts',
				backend: 'server/v2/routes/opportunities.js -> snapshotService.getLatestOpportunitiesPayload',
			},
		});
	}

	const research = byUrl['http://localhost:3000/api/research/AAPL/full'];
	if (research) {
		const missingNextFields = research.nullFields.filter((field) => field.startsWith('earnings.next.'));
		report.push({
			endpoint: research.url,
			issue: missingNextFields.length > 0 ? 'research payload is mostly healthy but earnings.next contains null operational fields' : 'healthy',
			type: missingNextFields.length > 0 ? 'D_wrong_field_mapping_or_incomplete_source' : 'healthy',
			evidence: {
				status: research.status,
				checks: research.checks,
				nullFields: missingNextFields,
			},
			codePath: {
				nextProxy: 'trading-os/src/app/api/research/[symbol]/full/route.ts',
				backend: 'server/routes/research.js -> server/services/researchCacheService.js',
			},
		});
	}

	const screener = byUrl['http://localhost:3000/api/screener'];
	if (screener) {
		report.push({
			endpoint: screener.url,
			issue: screener.checks.rowCount > 0 ? 'healthy' : 'screener route responds but returns zero rows',
			type: screener.checks.rowCount > 0 ? 'healthy' : 'C_empty_database_or_snapshot',
			evidence: {
				status: screener.status,
				checks: screener.checks,
			},
			codePath: {
				nextProxy: 'trading-os/src/app/api/screener/route.ts',
				backend: 'server/v2/routes/screener.js -> snapshotService.getLatestScreenerPayload',
			},
		});
	}

	report.push({
		systemRisk: 'dual API surface remains active',
		type: 'A_architecture_duplication',
		evidence: apiMap.duplicates,
	});

	report.push({
		systemRisk: 'frontend still contains /api/v2 consumers and env-level backend base override',
		type: 'A_architecture_duplication',
		evidence: {
			missingProxyCandidates: apiMap.missingProxyCandidates.slice(0, 20),
			directBackendRisks: apiMap.directBackendRisks.slice(0, 20),
		},
	});

	return report;
}

async function main() {
	const nextRoutes = collectNextRoutes();
	const backendMounts = collectBackendMounts();
	const frontendCalls = collectFrontendCalls();

	const apiMap = {
		generatedAt: new Date().toISOString(),
		backendEntrypoint: 'server/index.js -> server/v2/index.js',
		nextRoutes,
		backendMounts,
		frontendCalls,
		duplicates: findDuplicates(backendMounts),
		directBackendRisks: findDirectBackendRisks(frontendCalls),
		missingProxyCandidates: findMissingProxyCandidates(nextRoutes, frontendCalls),
	};

	const endpoints = [
		'http://localhost:3000/api/research/AAPL/full',
		'http://localhost:3000/api/screener',
		'http://localhost:3000/api/opportunities',
		'http://localhost:3000/api/v5/chart?symbol=AAPL',
		'http://localhost:3000/api/earnings',
	];

	const dataHealth = {
		generatedAt: new Date().toISOString(),
		endpoints: [],
	};

	for (const endpoint of endpoints) {
		dataHealth.endpoints.push(await fetchJsonWithTiming(endpoint));
	}

	const rootCause = {
		generatedAt: new Date().toISOString(),
		findings: buildRootCauseReport(dataHealth, apiMap),
	};

	fs.writeFileSync(REPORTS.apiMap, JSON.stringify(apiMap, null, 2));
	fs.writeFileSync(REPORTS.dataHealth, JSON.stringify(dataHealth, null, 2));
	fs.writeFileSync(REPORTS.rootCause, JSON.stringify(rootCause, null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
