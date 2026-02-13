# Security Guide for OpenRange Trader

## Overview

This document provides security best practices and procedures for managing credentials, secrets, and sensitive data in the OpenRange Trader application.

## Critical Security Considerations

### 🔴 Immediate Actions Required

1. **Rotate All Credentials** - The `.env` file currently contains live credentials that should be rotated
2. **Never Commit Secrets** - The `.env` file is gitignored, but verify it hasn't been committed to version control
3. **Use Strong Secrets** - Replace all placeholder values with cryptographically secure random strings

---

## Environment Variables

### Required Secrets

All sensitive credentials should be stored in `server/.env` (never commit this file):

```bash
# Saxo Bank API Credentials
SAXO_TOKEN=your_actual_saxo_token_here
SAXO_CLIENT_KEY=your_client_key_here
SAXO_ACCOUNT_NUMBER=your_account_number_here
SAXO_API_URL=https://gateway.saxobank.com/openapi

# Server Configuration
PORT=3000
REQUEST_TIMEOUT=10000
NODE_ENV=production

# Security Keys
PROXY_API_KEY=generate_secure_random_string_here
JWT_SECRET=generate_long_secure_random_string_here

# External APIs
FINNHUB_API_KEY=your_finnhub_api_key_here
FINVIZ_NEWS_TOKEN=your_finviz_elite_token_here
```

### Generating Secure Secrets

Use these commands to generate cryptographically secure random strings:

```bash
# Generate 32-byte random string (for PROXY_API_KEY)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate 64-byte random string (for JWT_SECRET)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Credential Rotation Procedures

### When to Rotate Credentials

Rotate credentials immediately if:
- Credentials are accidentally committed to version control
- Credentials are exposed in logs or error messages
- A team member with access leaves the organization
- There's a suspected security breach
- Every 90 days as a best practice

### How to Rotate Saxo Bank Tokens

1. **Generate New Token**
   - Log into Saxo Bank OpenAPI portal
   - Navigate to Authentication settings
   - Generate a new access token
   - Copy the token (it will only be shown once)

2. **Update Server Configuration**
   ```bash
   # Edit server/.env
   SAXO_TOKEN=new_token_here
   ```

3. **Restart Server**
   ```bash
   cd server
   npm restart
   # OR if using systemd/launchd
   sudo systemctl restart openrange-trader
   ```

4. **Verify Connection**
   ```bash
   curl http://localhost:3000/api/health
   ```

5. **Revoke Old Token**
   - Return to Saxo Bank portal
   - Revoke the old token

### How to Rotate JWT Secret

⚠️ **WARNING:** Rotating JWT_SECRET will invalidate all existing user sessions.

1. **Generate New Secret**
   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

2. **Update .env**
   ```bash
   JWT_SECRET=new_secret_here
   ```

3. **Notify Users** (optional)
   - Send email notification that they'll need to log in again

4. **Restart Server**
   ```bash
   cd server
   npm restart
   ```

### How to Rotate PROXY_API_KEY

1. **Generate New Key**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Update .env**
   ```bash
   PROXY_API_KEY=new_key_here
   ```

3. **Restart Server**
   ```bash
   cd server
   npm restart
   ```

---

## Secret Storage Best Practices

### DO ✅

- Store all secrets in `server/.env`
- Use `.env.example` as a template (with placeholders only)
- Use a secrets manager in production (AWS Secrets Manager, HashiCorp Vault, etc.)
- Rotate credentials regularly (every 90 days)
- Use different credentials for development, staging, and production
- Grant access on a need-to-know basis
- Enable two-factor authentication on all API accounts

### DON'T ❌

- Never commit `.env` to version control
- Never hardcode secrets in source code
- Never share credentials via email or Slack
- Never use production credentials in development
- Never log secrets or tokens
- Never store credentials in client-side code

---

## Checking for Exposed Secrets

### Scan Git History

```bash
# Check if .env was ever committed
git log --all --full-history -- "**/.env"

# Search for potential secrets in history
git grep -i 'password\|secret\|token\|key' $(git rev-list --all)
```

### Remove Exposed Secrets from Git

If secrets were accidentally committed:

```bash
# Install git-filter-repo (recommended)
pip install git-filter-repo

# Remove file from entire history
git filter-repo --path server/.env --invert-paths

# Force push (WARNING: This rewrites history)
git push --force --all
```

**Then immediately:**
1. Rotate ALL exposed credentials
2. Notify your team
3. Review access logs for suspicious activity

---

## Environment-Specific Configuration

### Development

```bash
# server/.env.development
SAXO_TOKEN=sandbox_token_here
SAXO_API_URL=https://gateway.saxobank.com/sim/openapi
NODE_ENV=development
LOG_LEVEL=debug
```

### Production

```bash
# server/.env.production
SAXO_TOKEN=production_token_here
SAXO_API_URL=https://gateway.saxobank.com/openapi
NODE_ENV=production
LOG_LEVEL=info
```

### Using Environment Files

```bash
# Development
cp server/.env.development server/.env
npm run dev

# Production
cp server/.env.production server/.env
npm start
```

---

## Database Security

### User Passwords

- Passwords are hashed using bcrypt with 10 rounds
- Never store plaintext passwords
- Enforce password requirements (8+ chars, mixed case, numbers)

### Database Encryption

For production, consider encrypting the SQLite database:

```bash
# Install SQLCipher
npm install sqlite3 --build-from-source --sqlite=/path/to/sqlcipher

# Encrypt existing database
sqlcipher users.db
sqlite> ATTACH DATABASE 'encrypted.db' AS encrypted KEY 'your-encryption-key';
sqlite> SELECT sqlcipher_export('encrypted');
sqlite> DETACH DATABASE encrypted;
```

---

## Monitoring & Alerts

### Set Up Log Monitoring

1. **Review Error Logs**
   ```bash
   tail -f server/logs/error.log
   ```

2. **Watch for Failed Login Attempts**
   ```bash
   grep "Invalid credentials" server/logs/combined.log | tail -20
   ```

3. **Monitor Rate Limiting**
   ```bash
   grep "rate limit" server/logs/combined.log
   ```

### Recommended Alerts

Set up alerts for:
- Failed login attempts (>5 in 1 hour)
- 401/403 errors (unauthorized access)
- Database errors
- API token expiration

---

## Incident Response

### If Credentials Are Compromised

1. **Immediate Actions (Within 1 hour)**
   - Rotate all affected credentials
   - Review access logs for suspicious activity
   - Notify affected users
   - Document the incident

2. **Short-term Actions (Within 24 hours)**
   - Audit all system access
   - Review and update security policies
   - Implement additional monitoring
   - Conduct post-incident review

3. **Long-term Actions (Within 1 week)**
   - Implement lessons learned
   - Update documentation
   - Train team on security best practices
   - Consider security audit

---

## Security Checklist

Use this checklist before deploying to production:

- [ ] All `.env` files excluded from version control
- [ ] All placeholder values replaced with real credentials
- [ ] All secrets rotated from development values
- [ ] JWT_SECRET is at least 64 characters
- [ ] PROXY_API_KEY is at least 32 characters
- [ ] Database file excluded from version control
- [ ] HTTPS enabled (not HTTP)
- [ ] Rate limiting configured
- [ ] Input validation enabled
- [ ] Error messages don't leak sensitive info
- [ ] Logging configured properly (no secrets logged)
- [ ] Backup strategy in place
- [ ] Monitoring and alerts configured

---

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP API Security](https://owasp.org/www-project-api-security/)
- [Saxo Bank Security Guidelines](https://www.developer.saxo/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

---

## Contact

For security concerns or to report vulnerabilities:
- Email: security@yourdomain.com
- Create a private security advisory on GitHub

**Last Updated:** 2025-02-02
