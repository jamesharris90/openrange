import json
import urllib.request

URLS = [
    ('health', 'http://127.0.0.1:3000/api/health'),
    ('research_snapshot', 'http://127.0.0.1:3000/api/research/INTC'),
    ('research_full', 'http://127.0.0.1:3000/api/research/INTC/full'),
    ('chart_1day', 'http://127.0.0.1:3000/api/v5/chart?symbol=INTC&interval=1day'),
    ('chart_1min', 'http://127.0.0.1:3000/api/v5/chart?symbol=INTC&interval=1min'),
]

for name, url in URLS:
    print(f'\n== {name} ==')
    try:
        with urllib.request.urlopen(url, timeout=25) as response:
            payload = json.loads(response.read().decode('utf-8'))
            print('status', response.status)
            print('keys', list(payload.keys())[:15])
            print('success', payload.get('success'))
            print('error', payload.get('error'))
            print('message', payload.get('message'))
            print('candles', len(payload.get('candles') or []), 'dailyCandles', len(payload.get('dailyCandles') or []))
    except Exception as error:
        print('error', repr(error))
