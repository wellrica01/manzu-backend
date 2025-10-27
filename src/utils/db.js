/**
 * CENTRALIZED CONFIGURATION
 * 
 * Environment-specific configuration for Manzu platform
 * Validates all required variables on startup
 * Prevents production deployment with invalid config
 */

const crypto = require('crypto');

/**
 * Validate required environment variables
 */
function validateConfig() {
  const errors = [];
  const warnings = [];

  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
    'FRONTEND_URL',
    'BACKEND_URL',
    'ALLOWED_ORIGINS'
  ];

  // Check required variables
  required.forEach(varName => {
    if (!process.env[varName]) {
      errors.push(`Missing required environment variable: ${varName}`);
    }
  });

  // Validate JWT_SECRET strength
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 64) {
    errors.push('JWT_SECRET must be at least 64 characters long');
  }

  // Production-specific validation
  if (process.env.NODE_ENV === 'production') {
    const productionRequired = [
      'PAYSTACK_SECRET_KEY',
      'SENTRY_DSN',
      'SENDGRID_API_KEY'
    ];

    productionRequired.forEach(varName => {
      if (!process.env[varName]) {
        warnings.push(`Production warning: ${varName} not set`);
      }
    });

    // Check for hardcoded IPs in production
    const urlVars = ['FRONTEND_URL', 'BACKEND_URL', 'ALLOWED_ORIGINS'];
    urlVars.forEach(varName => {
      const value = process.env[varName];
      if (value && /192\.168\.\d+\.\d+/.test(value)) {
        errors.push(`${varName} contains hardcoded IP address: ${value}`);
      }
      if (value && value.includes('localhost') && process.env.NODE_ENV === 'production') {
        errors.push(`${varName} contains localhost in production: ${value}`);
      }
    });
  }

  // Display warnings
  if (warnings.length > 0) {
    console.warn('\n⚠️  Configuration Warnings:');
    warnings.forEach(warning => console.warn(`   ${warning}`));
  }

  // Fail if errors
  if (errors.length > 0) {
    console.error('\n🚨 CONFIGURATION ERRORS:');
    errors.forEach(error => console.error(`   ❌ ${error}`));
    console.error('\n📚 Fix these errors before starting the application.\n');
    throw new Error('Invalid configuration');
  }
}

/**
 * Get configuration based on NODE_ENV
 */
function getConfig() {
  const env = process.env.NODE_ENV || 'development';

  // Base configuration (common to all environments)
  const baseConfig = {
    env,
    port: parseInt(process.env.PORT || '5000', 10),
    
    // URLs
    frontendUrl: process.env.FRONTEND_URL,
    backendUrl: process.env.BACKEND_URL,
    
    // Database
    database: {
      url: process.env.DATABASE_URL
    },
    
    // Authentication
    jwt: {
      secret: process.env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    },
    
    // CORS
    cors: {
      origins: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
        : []
    },
    
    // Paystack
    paystack: {
      secretKey: process.env.PAYSTACK_SECRET_KEY,
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL || `${process.env.BACKEND_URL}/api/med-confirmation/callback`,
      paymentUrl: process.env.PAYMENT_URL || `${process.env.FRONTEND_URL}/checkout`
    },
    
    // Supabase
    supabase: {
      url: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    },
    
    // Email (SendGrid)
    email: {
      apiKey: process.env.SENDGRID_API_KEY,
      fromEmail: process.env.SENDGRID_FROM_EMAIL
    },
    
    // SMS (Twilio)
    sms: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER,
      whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER
    },
    
    // Sentry
    sentry: {
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || env,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0'),
      profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '1.0'),
      debug: process.env.SENTRY_DEBUG === 'true'
    },
    
  // Geocoding (fallback to OpenStreetMap if no API key)
  geocoding: {
    provider: process.env.OPENCAGE_API_KEY ? 'opencage' : 'openstreetmap',
    apiKey: process.env.OPENCAGE_API_KEY || null
  }

  };

  // Environment-specific overrides
  const envConfigs = {
    development: {
      isDevelopment: true,
      isProduction: false,
      isTest: false
    },
    production: {
      isDevelopment: false,
      isProduction: true,
      isTest: false
    },
    test: {
      isDevelopment: false,
      isProduction: false,
      isTest: true
    }
  };

  return {
    ...baseConfig,
    ...(envConfigs[env] || envConfigs.development)
  };
}

// Validate on module load
validateConfig();

// Export configuration
const config = getConfig();

console.log('✅ Configuration loaded:', {
  environment: config.env,
  frontendUrl: config.frontendUrl,
  backendUrl: config.backendUrl,
  corsOrigins: config.cors.origins.length,
  database: config.database.url ? 'Configured' : 'Not configured'
});

module.exports = config;
