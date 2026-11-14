// src/server.js
// Side-effecting entry point. npm start / npm run dev point here.
// Loads env, initialises Sentry, mounts the app, starts cron, listens.

const { loadEnvironment } = require('./utils/load-env');
loadEnvironment();

const { validateEnvironment, checkGitignore } = require('./utils/env-validator');
validateEnvironment();
checkGitignore();

const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');
const { sanitizeData } = require('./utils/error-reporter');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  sendDefaultPii: false,
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
  profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '0.1'),
  integrations: [nodeProfilingIntegration()],
  debug: process.env.SENTRY_DEBUG === 'true',
  release: process.env.npm_package_version,
  beforeSend(event) {
    if (process.env.NODE_ENV === 'test') return null;
    if (event.request?.url?.includes('/health')) return null;
    if (event.request) {
      if (event.request.url) event.request.url = event.request.url.split('?')[0];
      if (event.request.query_string) event.request.query_string = '[REDACTED]';
      if (typeof event.request.data === 'string') event.request.data = '[REDACTED]';
    }
    return sanitizeData(event);
  },
});

global.Sentry = Sentry;
console.log('Sentry initialized:', {
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  dsn: process.env.SENTRY_DSN ? 'Configured' : 'Not configured',
});

const { createApp } = require('./app');
const { initializeErrorHandlers } = require('./middleware/error-handler');

// Cron jobs (must not run inside tests)
require('./jobs/cron');

// Install process-wide handlers for unhandledRejection / uncaughtException
initializeErrorHandlers();

const app = createApp();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});