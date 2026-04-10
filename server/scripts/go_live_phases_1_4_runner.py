import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path('/Users/jamesharris/Server')
LOGS = ROOT / 'logs'
LOGS.mkdir(parents=True, exist_ok=True)


def sh(cmd: str) -> str:
    proc = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    return (proc.stdout or '').strip()


def get(url: str, timeout: int = 20) -> dict:
    started = time.time()
    req = urllib.request.Request(url, headers={'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode('utf-8', errors='ignore')
            ms = int((time.time() - started) * 1000)
            content_type = resp.headers.get('content-type', '')
            try:
                parsed = json.loads(body)
                is_json = True
            except Exception:
                parsed = None
                is_json = False
            return {
                'status': resp.status,
                'ok': 200 <= resp.status < 300,
                'ms': ms,
                'content_type': content_type,
                'text': body,
                'json': parsed,
                'is_json': is_json,
            }
    except urllib.error.HTTPError as err:
        body = err.read().decode('utf-8', errors='ignore')
        ms = int((time.time() - started) * 1000)
        try:
            parsed = json.loads(body)
            is_json = True
        except Exception:
            parsed = None
            is_json = False
        return {
            'status': err.code,
            'ok': False,
            'ms': ms,
            'content_type': err.headers.get('content-type', ''),
            'text': body,
            'json': parsed,
            'is_json': is_json,
        }
    except Exception as exc:
        return {
            'status': 0,
            'ok': False,
            'ms': int((time.time() - started) * 1000),
            'error': str(exc),
            'content_type': '',
            'text': '',
            'json': None,
            'is_json': False,
        }


def run_phase_1() -> dict:
    rogue_raw = sh(
        "pgrep -af 'prepDataRepair.js|openrange_autoloop.js|pipeline_unification_lock.js|score_calibration_phases_0_8.js|sip_priority_phases_0_6.js|earningsForceInjection.js|earningsOutcomeBackfill.js|openrange_density_expansion_cycle.js' || true"
    )
    rogue_lines = [
        line for line in rogue_raw.split('\n') if line.strip() and 'pgrep -af' not in line
    ]
    lsof_raw = sh("lsof -nP -iTCP -sTCP:LISTEN | grep -E '(3000|3001|3011|3012|3016|3023)' || true")
    listeners = [line for line in lsof_raw.split('\n') if line.strip()]
    backend_listeners = [
        line
        for line in listeners
        if any(f':{port} ' in line for port in [3001, 3011, 3012, 3016, 3023])
    ]

    phase = {
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'active_processes': {
            'rogue_query_output': rogue_lines,
            'lsof_lines': listeners,
        },
        'active_ports': backend_listeners,
        'rogue_loops_running': len(rogue_lines) > 0,
        'topology_summary': {
            'backend_listener_count': len(backend_listeners),
            'topology_unambiguous': len(backend_listeners) == 1,
        },
    }
    phase['pass'] = (not phase['rogue_loops_running']) and phase['topology_summary']['topology_unambiguous']
    return phase


def run_phase_2() -> dict:
    endpoint = 'http://127.0.0.1:3001/api/market/quotes?symbols=SPY,QQQ,AAPL'
    calls = []
    for idx in range(5):
        result = get(endpoint)
        parsed = result.get('json') if isinstance(result.get('json'), dict) else {}
        calls.append(
            {
                'call': idx + 1,
                'status': result['status'],
                'ms': result['ms'],
                'is_json': result['is_json'],
                'root_valid_json': isinstance(parsed, dict),
                'data_array_shape': isinstance(parsed.get('data'), list),
                'sample': (parsed.get('data') or [])[:2],
            }
        )

    phase = {
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'endpoint': '/api/market/quotes?symbols=SPY,QQQ,AAPL',
        'calls': calls,
    }
    phase['pass'] = all(
        c['status'] == 200 and c['is_json'] and c['data_array_shape'] for c in calls
    )
    return phase


def run_phase_3() -> dict:
    root = get('http://127.0.0.1:3001/')
    login = get('http://127.0.0.1:3001/login')
    root_text = (root.get('text') or '').lower()
    phase = {
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'root_status': root['status'],
        'root_content_type': root.get('content_type', ''),
        'root_has_login_link': ('login' in root_text) or ('open login' in root_text),
        'login_status': login['status'],
        'login_sample': (login.get('text') or '')[:120],
    }
    phase['pass'] = phase['root_status'] == 200 and 'text/html' in phase['root_content_type'].lower()
    return phase


def run_phase_4() -> dict:
    watch = get('http://127.0.0.1:3001/api/intelligence/watchlist?limit=80', timeout=60)
    payload = watch.get('json') if isinstance(watch.get('json'), dict) else {}
    rows = payload.get('data') if isinstance(payload.get('data'), list) else []

    distribution = {}
    for row in rows:
        key = str((row or {}).get('watch_reason') or 'UNKNOWN').upper()
        distribution[key] = distribution.get(key, 0) + 1

    count = len(rows)
    high_volatility = round((distribution.get('HIGH_VOLATILITY', 0) / count * 100), 2) if count else 0.0

    phase = {
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'status': watch['status'],
        'count': count,
        'distribution': distribution,
        'high_volatility_percent': high_volatility,
        'has_earnings': distribution.get('EARNINGS_UPCOMING', 0) > 0,
        'has_news': distribution.get('NEWS_PENDING', 0) > 0,
        'has_large_move': distribution.get('LARGE_MOVE', 0) > 0,
        'sample': rows[:10],
    }
    phase['pass'] = (
        phase['status'] == 200
        and phase['high_volatility_percent'] < 80
        and (phase['has_earnings'] or phase['has_news'] or phase['has_large_move'])
    )
    return phase


def write_json(name: str, data: dict) -> None:
    (LOGS / name).write_text(json.dumps(data, indent=2))


def main() -> None:
    p1 = run_phase_1()
    write_json('go_live_phase1_runtime.json', p1)

    p2 = run_phase_2()
    write_json('go_live_phase2_quotes.json', p2)

    p3 = run_phase_3()
    write_json('go_live_phase3_entry.json', p3)

    p4 = run_phase_4()
    write_json('go_live_phase4_watchlist.json', p4)

    print(
        json.dumps(
            {
                'phase1_pass': p1['pass'],
                'phase2_pass': p2['pass'],
                'phase3_pass': p3['pass'],
                'phase4_pass': p4['pass'],
            },
            indent=2,
        )
    )


if __name__ == '__main__':
    main()
