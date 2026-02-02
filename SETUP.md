# Finviz Elite Dashboard - Setup Instructions

## Quick Start (2 minutes)

### Step 1: Install Dependencies

Open Terminal and run:

```bash
pip3 install flask flask-cors requests
```

### Step 2: Start the Proxy Server

Navigate to the folder where you saved the files, then run:

```bash
python3 finviz_proxy.py
```

You should see:
```
============================================================
🚀 Starting Finviz Elite Proxy Server
============================================================
Server running at: http://localhost:5000
Health check: http://localhost:5000/health
Press Ctrl+C to stop the server
============================================================
```

**Keep this Terminal window open!** The server needs to run while you use the dashboard.

### Step 3: Open the Dashboard

Double-click `finviz-dashboard.html` to open it in your browser.

You should now see all 6 screeners loading with live data!

---

## Daily Trading Workflow

**Before market open (1:30 PM UK time):**

1. Open Terminal
2. Run: `python3 finviz_proxy.py`
3. Open `finviz-dashboard.html` in browser
4. Monitor your pre-market gappers and momentum plays
5. Dashboard auto-refreshes every 3 minutes

**After trading (4:00 PM UK time):**

1. Close the browser tab
2. In Terminal, press `Ctrl+C` to stop the server

---

## Troubleshooting

### "Failed to load data: Cannot connect to proxy server"

**Solution:** Make sure `finviz_proxy.py` is running in Terminal.

### "Command not found: pip3"

**Solution:** Try `pip` instead of `pip3`:
```bash
pip install flask flask-cors requests
```

### "Port 5000 is already in use"

**Solution:** Something else is using port 5000. Kill the process:
```bash
lsof -ti:5000 | xargs kill -9
```
Then restart the proxy server.

### Dashboard shows "0 stocks" for all screeners

**Solution:** Check the Terminal window running the proxy server for error messages. You might need to verify your Finviz Elite API key is still valid.

---

## Optional: Make It Even Easier

### Create a Quick Launch Script

Save this as `start_trading.sh`:

```bash
#!/bin/bash
cd ~/Documents/Trading  # Change to your folder location
python3 finviz_proxy.py
```

Make it executable:
```bash
chmod +x start_trading.sh
```

Now you can just double-click `start_trading.sh` to start the server!

---

## Advanced: Auto-Start on Login

If you want the proxy server to start automatically when you log in:

1. Open **System Preferences** → **Users & Groups**
2. Click your username → **Login Items**
3. Click **+** and add `start_trading.sh`

---

## File Structure

Your trading folder should look like:

```
Trading/
├── finviz_proxy.py          ← The proxy server
├── finviz-dashboard.html    ← Your dashboard
├── SETUP.md                 ← This file
└── start_trading.sh         ← (Optional) Quick launch script
```

---

## Need Help?

- Check Terminal window for error messages
- Test the proxy server: Visit http://localhost:5000/health in your browser
- Make sure Finviz Elite subscription is active
- Verify API key hasn't expired

---

**Happy Trading! 📈**
