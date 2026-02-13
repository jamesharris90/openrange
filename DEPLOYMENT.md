# Deployment Guide - OpenRange Trading

This guide covers deploying your OpenRange Trader dashboard to your domain `openrangetrading.co.uk`.

## Prerequisites

- Domain registered and accessible: `openrangetrading.co.uk`
- Node.js 16+ installed
- A public IP or managed hosting service
- SSL/TLS certificate (required for production)

## Quick Start (Development)

### 1. Start the Server Locally

```bash
cd /Users/jamesharris/Server/server
npm start
```

The site will be available at `http://localhost:3000`.

**Default credentials:**
- Username: `trader`
- Password: `changeMe123!`

### 2. Update Environment Variables

Create `server/.env` with your production credentials:

```bash
# Security credentials (CHANGE THESE!)
AUTH_USERNAME=your_username
AUTH_PASSWORD=your_secure_password
JWT_SECRET=a_long_random_string_for_production

# Saxo API
SAXO_TOKEN=your_token_here
SAXO_CLIENT_KEY=your_client_key
SAXO_ACCOUNT_NUMBER=your_account_number

# Server
PORT=3000
NODE_ENV=production
PROXY_API_KEY=your_secure_api_key
```

## Production Deployment

### Option A: Cloud Hosting (Recommended)

#### Deploy on Heroku, Railway, or Render

1. Push your repo to GitHub:
```bash
cd /Users/jamesharris/Server
git remote add origin https://github.com/your-username/openrange-trading.git
git push -u origin main
```

2. Connect the repo to Heroku/Railway/Render in the dashboard.

3. Set environment variables in the platform:
   - `AUTH_USERNAME`
   - `AUTH_PASSWORD`
   - `JWT_SECRET`
   - `SAXO_TOKEN`, `SAXO_CLIENT_KEY`, `SAXO_ACCOUNT_NUMBER`
   - `PROXY_API_KEY`
   - `NODE_ENV=production`

4. Point your domain to the platform in DNS settings.

#### Configure DNS (for openrangetrading.co.uk)

- Go to your domain registrar's DNS settings
- Create a CNAME record:
  - **Type:** CNAME
  - **Name:** @ (or your subdomain)
  - **Value:** Your platform's domain (e.g., `openrange-trading.herokuapp.com`)

### Option B: Self-Hosted VPS

1. **Rent a VPS** (DigitalOcean, Linode, AWS EC2, etc.)

2. **SSH into your server** and set up Node.js:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

3. **Clone your repository:**
```bash
git clone https://github.com/your-username/openrange-trading.git
cd openrange-trading/server
npm install
```

4. **Set up SSL/TLS with Let's Encrypt:**
```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot certonly --standalone -d openrangetrading.co.uk
```

5. **Run the server with PM2** (process manager):
```bash
npm install -g pm2
pm2 start server/index.js --name "openrange-proxy"
pm2 startup
pm2 save
```

6. **Use Nginx as reverse proxy** with SSL:

Create `/etc/nginx/sites-available/openrange`:
```nginx
server {
    listen 443 ssl http2;
    server_name openrangetrading.co.uk;

    ssl_certificate /etc/letsencrypt/live/openrangetrading.co.uk/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/openrangetrading.co.uk/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 80;
    server_name openrangetrading.co.uk;
    return 301 https://$server_name$request_uri;
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/openrange /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

7. **Update DNS** to point to your VPS IP.

### Option C: macOS with launchd (Local Network Only)

If your Mac is on a static IP and you want to serve locally:

```bash
# Update the plist with your absolute path
cp server/launchd/com.openrange.saxo-proxy.plist ~/Library/LaunchAgents/

# Load the service
launchctl load ~/Library/LaunchAgents/com.openrange.saxo-proxy.plist
```

Then expose via a reverse proxy (ngrok, Cloudflare Tunnel, etc.) or port-forward on your router.

## Security Checklist

- [ ] Change default credentials (`AUTH_USERNAME`, `AUTH_PASSWORD`)
- [ ] Set a strong `JWT_SECRET` (minimum 32 characters)
- [ ] Enable HTTPS/SSL on your domain
- [ ] Never commit `.env` with secrets to git
- [ ] Keep `SAXO_TOKEN` and `PROXY_API_KEY` private
- [ ] Monitor server logs for suspicious activity
- [ ] Use strong passwords and consider 2FA if possible

## Monitoring

### Check Server Status

```bash
# View logs
tail -f /Users/jamesharris/Server/server/server.log

# Or via pm2 (if self-hosted with PM2)
pm2 logs openrange-proxy
```

### Health Check

```bash
curl https://openrangetrading.co.uk/api/health
```

Should return:
```json
{"ok":true,"env":"production"}
```

## Troubleshooting

### HTTPS errors
- Ensure SSL certificate is valid and not expired
- Check domain DNS is resolving correctly: `dig openrangetrading.co.uk`

### Login failures
- Verify `AUTH_USERNAME` and `AUTH_PASSWORD` are set in `.env`
- Check `JWT_SECRET` is configured
- Look at server logs for error details

### Saxo API errors
- Confirm `SAXO_TOKEN` is valid and not expired
- Test with the example client: `node server/examples/request_example.js`

### Port already in use
```bash
# Find process on port 3000
lsof -i :3000

# Kill it
kill -9 <PID>
```

## Next Steps

1. Test locally: `npm start` in `server/` folder
2. Choose a hosting platform
3. Set environment variables securely
4. Configure DNS for your domain
5. Monitor logs for issues

Need help? Check [server/README-server.md](server/README-server.md) for local development details.
