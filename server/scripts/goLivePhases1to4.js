const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

function sh(command) {
	try {
		return String(execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || '').trim();
	} catch (error) {
		return String(error.stdout || '').trim();
	}
}

function pgrepLines(pattern) {
	const out = sh(`pgrep -af "${pattern}" || true`);
	if (!out) return [];
	return out
		.split('\n')
		.map((x) => x.trim())
		.filter(Boolean)
		.filter((line) => !line.includes('pgrep -af'));
}

async function fetchJson(url, opts = {}) {
	const started = Date.now();
	try {
		const res = await fetch(url, opts);
		const text = await res.text();
		let json = null;
		try {
			json = JSON.parse(text);
		} catch {
			json = null;
		}
		return {
			status: res.status,
			ok: res.ok,
			ms: Date.now() - started,
			content_type: res.headers.get('content-type'),
			is_json: json !== null,
			json,
			text,
		};
	} catch (error) {
		return {
			status: 0,
			ok: false,
			ms: Date.now() - started,
			is_json: false,
			error: error.message,
			text: '',
			json: null,
		};
	}
}

function write(file, payload) {
	const target = path.join(ROOT, 'logs', file);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, JSON.stringify(payload, null, 2));
}

function watchDist(rows) {
	const dist = {};
	for (const row of rows) {
		const key = String(row?.watch_reason || 'UNKNOWN').toUpperCase();
		dist[key] = (dist[key] || 0) + 1;
	}
	return dist;
}

function percent(part, total) {
	if (!total) return 0;
	return Number(((part / total) * 100).toFixed(2));
}

async function main() {
	const timestamp = new Date().toISOString();

	const lsof = sh("lsof -nP -iTCP -sTCP:LISTEN | grep -E '(3000|3001|3011|3012|3016|3023)' || true");
	const rogueLines = [
		...pgrepLines('prepDataRepair.js'),
		...pgrepLines('openrange_autoloop.js'),
		...pgrepLines('pipeline_unification_lock.js'),
		...pgrepLines('score_calibration_phases_0_8.js'),
		...pgrepLines('sip_priority_phases_0_6.js'),
		...pgrepLines('earningsForceInjection.js'),
		...pgrepLines('earningsOutcomeBackfill.js'),
		...pgrepLines('openrange_density_expansion_cycle.js'),
	];
	const rogue = Array.from(new Set(rogueLines));
	const active = lsof.split('\n').filter(Boolean);
	const backendLines = active.filter((x) => /(3001|3011|3012|3016|3023)/.test(x));

	const phase1 = {
		timestamp,
		active_processes: {
			lsof_lines: active,
			rogue_query_output: rogue,
		},
		active_ports: backendLines,
		rogue_loops_running: rogue.length > 0,
		topology_summary: {
			backend_listener_count: backendLines.length,
			topology_unambiguous: backendLines.length === 1,
		},
		pass: rogue.length === 0 && backendLines.length === 1,
	};
	write('go_live_phase1_runtime.json', phase1);

	const quoteCalls = [];
	for (let i = 0; i < 5; i += 1) {
		const q = await fetchJson('http://127.0.0.1:3001/api/market/quotes?symbols=SPY,QQQ,AAPL');
		quoteCalls.push({
			call: i + 1,
			status: q.status,
			ms: q.ms,
			is_json: q.is_json,
			root_valid_json: q.json !== null && typeof q.json === 'object',
			data_array_shape: Array.isArray(q.json?.data),
			sample: Array.isArray(q.json?.data) ? q.json.data.slice(0, 2) : null,
		});
	}

	const phase2 = {
		timestamp: new Date().toISOString(),
		endpoint: '/api/market/quotes?symbols=SPY,QQQ,AAPL',
		calls: quoteCalls,
		pass: quoteCalls.every((c) => c.status === 200 && c.is_json && c.data_array_shape),
	};
	write('go_live_phase2_quotes.json', phase2);

	const root = await fetchJson('http://127.0.0.1:3001/');
	const login = await fetchJson('http://127.0.0.1:3001/login', { redirect: 'manual' });
	const phase3 = {
		timestamp: new Date().toISOString(),
		root_status: root.status,
		root_content_type: root.content_type || null,
		root_contains_login_hint: /open login|login|frontend/i.test(String(root.text || '')),
		login_status: login.status,
		login_location: login.json?.location || null,
		pass: root.status === 200 && /text\/html/i.test(String(root.content_type || '')),
	};
	write('go_live_phase3_entry.json', phase3);

	let phase4;
	try {
		const watch = await fetchJson('http://127.0.0.1:3001/api/intelligence/watchlist?limit=80');
		const rows = Array.isArray(watch.json?.data) ? watch.json.data : [];
		const dist = watchDist(rows);
		const total = rows.length;
		const highVol = percent(Number(dist.HIGH_VOLATILITY || 0), total);

		phase4 = {
			timestamp: new Date().toISOString(),
			status: watch.status,
			count: total,
			distribution: dist,
			high_volatility_percent: highVol,
			has_earnings: Number(dist.EARNINGS_UPCOMING || 0) > 0,
			has_news: Number(dist.NEWS_PENDING || 0) > 0,
			has_large_move: Number(dist.LARGE_MOVE || 0) > 0,
			pass: watch.status === 200
				&& highVol < 80
				&& ((Number(dist.EARNINGS_UPCOMING || 0) + Number(dist.NEWS_PENDING || 0) + Number(dist.LARGE_MOVE || 0)) > 0),
		};
	} catch (error) {
		phase4 = {
			timestamp: new Date().toISOString(),
			status: 0,
			error: error.message,
			pass: false,
		};
	}
	write('go_live_phase4_watchlist.json', phase4);

	console.log(JSON.stringify({
		phase1: phase1.pass,
		phase2: phase2.pass,
		phase3: phase3.pass,
		phase4: phase4.pass,
	}, null, 2));
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
