import json
import time
import urllib.request

URL = 'http://127.0.0.1:3000/api/system/coverage-campaign'
SAMPLES = 5
SLEEP_SECONDS = 20

points = []
for index in range(SAMPLES):
    with urllib.request.urlopen(URL) as response:
        obj = json.load(response)
    status = obj.get('status') or {}
    points.append({
        'ts': obj.get('generatedAt'),
        'phase': status.get('phase'),
        'cycle': status.get('cycle'),
        'missing_news_count': status.get('missing_news_count'),
        'missing_earnings_count': status.get('missing_earnings_count'),
        'resolved_news_symbols': status.get('resolved_news_symbols'),
        'news_batch_size': status.get('news_batch_size'),
        'news_concurrency': status.get('news_concurrency'),
    })
    if index < SAMPLES - 1:
        time.sleep(SLEEP_SECONDS)

first = points[0]
last = points[-1]
summary = {
    'samples': points,
    'window_minutes': round(((SAMPLES - 1) * SLEEP_SECONDS) / 60, 2),
    'news_delta': (first.get('missing_news_count') or 0) - (last.get('missing_news_count') or 0),
    'earnings_delta': (first.get('missing_earnings_count') or 0) - (last.get('missing_earnings_count') or 0),
    'resolved_news_delta': (last.get('resolved_news_symbols') or 0) - (first.get('resolved_news_symbols') or 0),
}
print(json.dumps(summary, indent=2))
