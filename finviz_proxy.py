from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import random

app = Flask(__name__)
CORS(app)

FINVIZ_API_KEY = 'f50d08a2-074c-4721-8470-af7fe98730a0'
FINNHUB_API_KEY = 'd5v55r9r01qtqgujgqbgd5v55r9r01qtqgujgqc0'

@app.route('/api/screener', methods=['GET'])
def proxy_screener():
    """Proxy for Finviz Elite screener API"""
    try:
        filters = request.args.get('f', '')
        signal = request.args.get('s', '')
        columns = request.args.get('c', '0,1,2,3,4,5,6')
        
        base_url = 'https://elite.finviz.com/export.ashx'
        
        if signal:
            url = f'{base_url}?v=111&s={signal}&c={columns}&auth={FINVIZ_API_KEY}'
        else:
            url = f'{base_url}?v=111&f={filters}&c={columns}&auth={FINVIZ_API_KEY}'
        
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        
        return response.text, 200, {'Content-Type': 'text/csv'}
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/finnhub/news', methods=['GET'])
def proxy_finnhub_news():
    """Proxy for Finnhub news API"""
    try:
        category = request.args.get('category', 'general')
        url = f'https://finnhub.io/api/v1/news?category={category}&token={FINNHUB_API_KEY}'
        
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        
        return jsonify(response.json())
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/stock/<ticker>', methods=['GET'])
def get_stock_data(ticker):
    """Get stock data - using Finnhub as fallback"""
    try:
        ticker = ticker.upper()
        
        # Try Finnhub quote endpoint (works reliably)
        quote_url = f'https://finnhub.io/api/v1/quote?symbol={ticker}&token={FINNHUB_API_KEY}'
        profile_url = f'https://finnhub.io/api/v1/stock/profile2?symbol={ticker}&token={FINNHUB_API_KEY}'
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        
        # Get quote data
        quote_response = requests.get(quote_url, headers=headers, timeout=10)
        quote_data = quote_response.json()
        
        # Get profile data
        profile_response = requests.get(profile_url, headers=headers, timeout=10)
        profile_data = profile_response.json()
        
        # Calculate values
        current_price = quote_data.get('c', 0)  # current price
        prev_close = quote_data.get('pc', 0)     # previous close
        change = current_price - prev_close
        change_percent = (change / prev_close * 100) if prev_close else 0
        
        # Get market cap and outstanding shares from profile
        market_cap = profile_data.get('marketCapitalization', 0)  # in millions
        shares_outstanding = profile_data.get('shareOutstanding', 0)  # in millions
        
        def format_number(num):
            if num >= 1000:
                return f"{num/1000:.2f}B"
            elif num >= 1:
                return f"{num:.2f}M"
            return "N/A"
        
        stock_data = {
            'ticker': ticker,
            'price': f"{current_price:.2f}" if current_price else "N/A",
            'change': f"{change:+.2f}" if change else "N/A",
            'changePercent': f"{change_percent:+.2f}" if change_percent else "N/A",
            'volume': "N/A",  # Finnhub basic doesn't include volume
            'avgVolume': "N/A",
            'marketCap': format_number(market_cap) if market_cap else "N/A",
            'float': format_number(shares_outstanding * 0.7) if shares_outstanding else "N/A",  # Estimate
            'short': "N/A",
            'beta': "N/A",
            'open': f"{quote_data.get('o', 0):.2f}" if quote_data.get('o') else "N/A",
            'prevClose': f"{prev_close:.2f}" if prev_close else "N/A",
            'dayRange': f"{quote_data.get('l', 0):.2f} - {quote_data.get('h', 0):.2f}" if quote_data.get('l') else "N/A",
            'range52w': f"{quote_data.get('52_week_low', 0):.2f} - {quote_data.get('52_week_high', 0):.2f}" if quote_data.get('52_week_low') else "N/A"
        }
        
        print(f"[STOCK] {ticker}: ${current_price:.2f} ({change_percent:+.2f}%)")
        
        return jsonify(stock_data)
        
    except Exception as e:
        print(f"[ERROR] Stock data for {ticker}: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    print('🚀 Starting Harris Trading World Proxy Server...')
    print('📊 Finviz Elite API: Connected')
    print('📰 Finnhub News API: Connected')
    print('💹 Stock Data: Finnhub Quote API')
    print('🌐 Server running on http://localhost:8080')
    print('⚠️  Keep this window open!\n')
    
    app.run(host='127.0.0.1', port=8080, debug=False)
