# 📦 Install New Dependencies for Fix #3

## Required Packages

Run this command to install the new security dependencies:

```bash
npm install helmet express-rate-limit
```

## What These Packages Do

### helmet (v7.1.0+)
- **Purpose:** Adds security headers to HTTP responses
- **Size:** ~50KB
- **Features:**
  - Content-Security-Policy (prevents XSS)
  - Strict-Transport-Security (forces HTTPS)
  - X-Content-Type-Options (prevents MIME sniffing)
  - X-Frame-Options (prevents clickjacking)
  - X-XSS-Protection (enables browser XSS filter)
  - Hides X-Powered-By header

### express-rate-limit (v7.1.5+)
- **Purpose:** Rate limiting middleware for Express
- **Size:** ~30KB
- **Features:**
  - IP-based rate limiting
  - Configurable time windows
  - Custom error messages
  - Rate limit headers (RateLimit-*)
  - Skip successful requests option

## Verification

After installation, verify packages are in `package.json`:

```bash
npm list helmet express-rate-limit
```

Expected output:
```
manzu-backend@1.0.0
├── helmet@7.x.x
└── express-rate-limit@7.x.x
```

## Already Installed?

If you get "up to date" message, the packages are already installed. You're good to go!

```bash
npm start
```
