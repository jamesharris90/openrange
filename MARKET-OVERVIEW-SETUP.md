# Market Overview Page - Setup Instructions

## New Features Added

You now have a **two-page dashboard system**:

### Page 1: Screeners (`finviz-dashboard.html`)
- Your 6 custom screeners
- Copy All buttons
- Dropdown switchers for different presets
- Auto-refresh every 3 minutes

### Page 2: Market Overview (`market-overview.html`)  
- **SPY & QQQ Live Charts** - Embedded Finviz Elite charts
- **Sector Performance** - See which sectors are leading/lagging today
- **Latest SEC Filings** - Recent 8-K, 10-Q filings
- **Live News Feed** - Real-time market news from Finnhub
- Navigation tabs to switch between pages

---

## Setup Instructions

### Step 1: Get Your Free Finnhub API Key

1. Go to https://finnhub.io/register
2. Sign up for a **free account**
3. Get your API key from the dashboard
4. Free tier includes:
   - 60 API calls/minute
   - General market news
   - Company news
   - Perfect for your needs!

### Step 2: Add API Key to Proxy Server

Open `finviz_proxy.py` in VS Code and find line ~75:

```python
FINNHUB_API_KEY = 'YOUR_FINNHUB_API_KEY_HERE'
```

Replace with your actual key:

```python
FINNHUB_API_KEY = 'csuabc1234567890'  # Your key here
```

### Step 3: Restart Proxy Server

```bash
# Stop current server (Ctrl+C)
cd ~/Server
python3 finviz_proxy.py
```

### Step 4: Open Both Pages

Now you have both pages:
- **`finviz-dashboard.html`** - Your screeners
- **`market-overview.html`** - Market overview with news

Click the navigation tabs at the top to switch between them!

---

## How It Works

### Market Overview Page Features:

**SPY/QQQ Charts:**
- Live embedded charts from Finviz Elite
- Shows intraday price action
- Updates in real-time

**Sector Performance:**
- Shows all 11 S&P sectors
- Color-coded: Green = up, Red = down
- Updates every 5 minutes

**Latest Filings:**
- Recent SEC filings (8-K, 10-Q, etc.)
- Click to open full filing details
- Great for finding catalyst events

**News Feed (Right Side):**
- General market news from Finnhub
- Auto-refreshes every 5 minutes
- Click any article to read full story
- Shows source and time posted

---

## Daily Workflow

### Pre-Market (1:30 PM UK):
1. Open **Market Overview** page
2. Check SPY/QQQ direction
3. See which sectors are hot
4. Read latest market news
5. Switch to **Screeners** tab
6. Review your 6 screeners for trade ideas

### During Trading (2:30-4:00 PM):
1. Keep **Screeners** page open
2. Copy tickers from active screeners
3. Paste into TradingView for charting
4. Periodically check **Market Overview** for market direction

### After Market:
1. Review sector performance
2. Check latest filings for overnight catalysts
3. Read news for next day setup

---

## Customization Ideas

Want to add more? You can easily add:

**More Index Tracking:**
- DIA (Dow Jones)
- IWM (Russell 2000)
- VIX (Volatility Index)

**Custom Watchlists:**
- Add your favorite stocks to track
- Create custom news feeds for specific tickers

**Additional Data:**
- Crypto prices (BTC, ETH)
- Commodities (Gold, Oil)
- Futures data

Just let me know what you want and I can add it!

---

## Troubleshooting

### "Failed to load news"
- Check your Finnhub API key is correct
- Make sure proxy server is running
- Verify you haven't exceeded free tier limits (60/min)

### Charts not loading
- Make sure you're logged into Finviz Elite in your browser
- Finviz Elite session might have expired

### Navigation doesn't work
- Make sure both HTML files are in the same folder
- File names must match: `finviz-dashboard.html` and `market-overview.html`

---

**You now have a complete trading command center!** 🚀

Two-page system with screeners, market overview, sector tracking, and live news all in one place.
