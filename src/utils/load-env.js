/**
 * Environment Configuration Loader
 * 
 * Loads environment-specific .env files based on NODE_ENV
 * Priority: .env.[environment] > .env
 */

const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

function loadEnvironment() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  // Load base .env file first
  const baseEnvPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(baseEnvPath)) {
    dotenv.config({ path: baseEnvPath });
    console.log(`✅ Loaded base environment from: .env`);
  }
  
  // Load environment-specific .env file (overrides base)
  const envPath = path.resolve(process.cwd(), `.env.${nodeEnv}`);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
    console.log(`✅ Loaded ${nodeEnv} environment from: .env.${nodeEnv}`);
  } else {
    console.warn(`⚠️  No .env.${nodeEnv} file found, using base .env`);
  }
  
  // Validate required variables
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'PAYSTACK_SECRET_KEY',
    'FRONTEND_URL',
    'BACKEND_URL'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  
  console.log(`🚀 Environment: ${nodeEnv}`);
  console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`🔗 Backend URL: ${process.env.BACKEND_URL}`);
  console.log(`💳 Paystack Callback: ${process.env.PAYSTACK_CALLBACK_URL}`);
}

module.exports = { loadEnvironment };