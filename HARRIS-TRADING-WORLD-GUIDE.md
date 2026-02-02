# Harris' Trading World - Complete Trading Dashboard

## 🎉 What You've Got

A professional 5-page trading dashboard with:

### **Page 1: Screeners** (`screeners.html`)
- 6 live Finviz Elite screeners
- Copy All buttons for quick TradingView paste
- Dropdown switchers (60+ preset screeners)
- Auto-refresh every 3 minutes
- **Best for:** Finding trade opportunities during 2:30-4:00 PM window

### **Page 2: Pre-Market** (`premarket.html`)
- Pre-market movers screener
- SPY pre-market chart (15M)
- Live market news from Finnhub
- **Best for:** 7:00 AM - 2:30 PM UK (before US open)

### **Page 3: Market Hours** (`market-hours.html`)
- Live ticker tape (SPY, QQQ, Bitcoin, EUR/USD)
- SPY + QQQ charts side-by-side (15M with VWAP/DEMA/Divergence)
- Sector performance cards
- Market heatmap
- **Best for:** 2:30 PM - 9:00 PM UK (during US trading)

### **Page 4: Post-Market** (`postmarket.html`)
- Day's top performers
- After-hours movers screener
- Latest SEC filings (8-K, 10-Q, etc.)
- Next day economic calendar
- **Best for:** 9:00 PM - 1:00 AM UK (after US close)

### **Page 5: Research** (`research.html`)
- **Symbol search** - Research any ticker
- **Symbol overview** with interactive chart
- **Financial data** - Income, balance sheet, cash flow
- **Technical analysis** - Oscillators, moving averages
- **Company profile** - Business description, fundamentals
- **Top stories** - Latest news for the ticker
- **Quick mini-chart** for 12-month view
- **Best for:** Deep-dive fundamental analysis on potential trades

---

## 🚀 Quick Setup (3 Steps)

### Step 1: Start the Proxy Server
```bash
cd ~/Server
python3 finviz_proxy.py
```

Keep this terminal window open while using the dashboard.

### Step 2: Open the Pages
Double-click any HTML file to open in Safari:
- `screeners.html` - Main screeners page
- `premarket.html` - Pre-market analysis
- `market-hours.html` - Live market hours
- `postmarket.html` - Post-market review
- `research.html` - Stock research

### Step 3: Navigate Between Pages
Use the tabs at the top to switch between pages. All pages work together seamlessly.

---

## 📊 Your Daily Workflow

### Morning (7:00 AM - 2:30 PM UK)
**Open: Pre-Market page**
- Check pre-market movers
- Read overnight news
- Plan potential trades
- Note catalysts

### Trading Window (2:30 PM - 4:00 PM UK)
**Open: Screeners + Market Hours pages**
- **Screeners page** - Main focus for finding setups
- **Market Hours** - Quick glance at SPY/QQQ direction
- Copy tickers → paste into TradingView
- Execute ORB strategy trades

### After Market (9:00 PM+)
**Open: Post-Market page**
- Review day's performance
- Check after-hours movers
- Read SEC filings for catalysts
- Check economic calendar for tomorrow

### Anytime
**Open: Research page**
- Deep-dive any ticker you're considering
- Check fundamentals before entry
- Review technical indicators
- Read latest company news

---

## 🎨 Customization Options

### Change Tickers in Market Hours
Edit `market-hours.html`, find the ticker tape section, and modify symbols:
```javascript
{"symbols":[
    {"proName":"FOREXCOM:SPXUSD","title":"S&P 500"},
    {"proName":"YOUR:TICKER","title":"Your Stock"}
]}
```

### Add Your Watchlist
In Research page, you can search any ticker.
TradingView widgets will update automatically.

### Modify Screener Timeframes
In `market-hours.html`, change `"interval":"15"` to:
- `"5"` for 5-minute
- `"60"` for 1-hour
- `"240"` for 4-hour

---

## 💡 Pro Tips

### For Your ORB Strategy:
1. Use **Screeners** to find gappers with volume
2. Cross-reference with **Market Hours** for SPY/QQQ trend
3. Use **Research** to check if catalyst is real
4. Copy tickers to TradingView for entry

### Bookmark These:
- Screeners page as your main landing page
- Research page for quick fundamental checks

### Speed Up Loading:
- Keep pages open in background tabs
- TradingView widgets cache after first load
- Refresh screeners only when needed

---

## 🔧 Troubleshooting

### "Cannot connect to proxy server"
- Make sure `python3 finviz_proxy.py` is running
- Check terminal for errors
- Try restarting the proxy

### Charts Not Loading
- Wait 10-15 seconds (TradingView widgets take time)
- Refresh the page (Cmd+R)
- Check internet connection

### Screeners Show "0 stocks"
- Market might be closed
- Try different screener from dropdown
- Check Finviz Elite subscription is active

### News Feed Empty
- Check Finnhub API key in `finviz_proxy.py`
- Make sure proxy server is running
- Wait a few seconds for initial load

---

## 🎯 What Makes This Special

✅ **Time-aware** - Different pages for different market sessions
✅ **Professional** - Consistent "Harris' Trading World" branding
✅ **Comprehensive** - Everything from screeners to fundamental research
✅ **Fast** - Optimized for quick decisions during your 2:30-4:00 PM window
✅ **Integrated** - All tools work together seamlessly

---

## 📝 Future Enhancements (Optional)

Want to add more? Easy additions:
- **Crypto page** - Track Bitcoin/Ethereum
- **Futures page** - ES/NQ futures for market direction
- **Position tracker** - Track your open trades
- **Journal** - Record trade notes and results

Let me know if you want any of these!

---

**You're all set!** Start the proxy, open the pages, and start trading. 🚀

Questions? Just ask!
