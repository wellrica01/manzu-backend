/**
 * ENVIRONMENT VARIABLE VALIDATOR
 * 
 * Validates critical environment variables on startup
 * Prevents app from starting with weak or missing secrets
 */

const crypto = require('crypto');

/**
 * Validate JWT secret strength
 */
function validateJWTSecret(secret) {
  if (!secret) {
    return {
      valid: false,
      error: 'JWT_SECRET is missing! This is a critical security requirement.'
    };
  }

  // Check minimum length
  if (secret.length < 64) {
    return {
      valid: false,
      error: `JWT_SECRET is too short (${secret.length} characters). Minimum 64 characters required for security.`
    };
  }

  // Check if it's a common/weak secret
  const weakSecrets = [
    'secret',
    'password',
    'jwt_secret',
    'your_jwt_secret_here',
    'changeme',
    '12345678',
    'test',
    'development'
  ];

  const lowerSecret = secret.toLowerCase();
  for (const weak of weakSecrets) {
    if (lowerSecret.includes(weak)) {
      return {
        valid: false,
        error: `JWT_SECRET contains weak pattern "${weak}". Use a cryptographically random secret.`
      };
    }
  }

  // Check entropy (hex strings have 16 unique chars but are still secure if long enough)
  const uniqueChars = new Set(secret).size;
  const isHexString = /^[0-9a-f]+$/i.test(secret);
  
  // Hex strings (from crypto.randomBytes) are secure if 128+ chars
  if (isHexString && secret.length >= 128) {
    // Valid hex string from crypto.randomBytes
    return { valid: true };
  }
  
  // Non-hex strings need more unique characters
  if (!isHexString && uniqueChars < 20) {
    return {
      valid: false,
      error: `JWT_SECRET has low entropy (only ${uniqueChars} unique characters). Use a random secret.`
    };
  }

  return { valid: true };
}

/**
 * Validate all required environment variables
 */
function validateEnvironment() {
  console.log('\n🔍 Validating environment variables...');
  
  const errors = [];
  const warnings = [];

  // Critical: JWT Secret
  const jwtValidation = validateJWTSecret(process.env.JWT_SECRET);
  if (!jwtValidation.valid) {
    errors.push(`❌ ${jwtValidation.error}`);
  } else {
    console.log('✅ JWT_SECRET: Valid and secure');
  }

  // Critical: Database URL
  if (!process.env.DATABASE_URL) {
    errors.push('❌ DATABASE_URL is missing');
  } else {
    console.log('✅ DATABASE_URL: Configured');
  }

  // Important: Node Environment
  if (!process.env.NODE_ENV) {
    warnings.push('⚠️  NODE_ENV not set, defaulting to development');
  } else {
    console.log(`✅ NODE_ENV: ${process.env.NODE_ENV}`);
  }

  // Production-specific checks
  if (process.env.NODE_ENV === 'production') {
    // In production, certain variables are critical
    if (!process.env.SENTRY_DSN) {
      warnings.push('⚠️  SENTRY_DSN not set in production (error monitoring disabled)');
    }

    if (process.env.SENTRY_DEBUG === 'true') {
      warnings.push('⚠️  SENTRY_DEBUG is enabled in production');
    }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      errors.push('❌ PAYSTACK_SECRET_KEY is missing in production');
    }
  }

  // Display warnings
  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    warnings.forEach(warning => console.log(warning));
  }

  // Display errors and exit if any
  if (errors.length > 0) {
    console.error('\n🚨 CRITICAL ERRORS - Application cannot start:');
    errors.forEach(error => console.error(error));
    console.error('\n📚 How to fix:');
    console.error('1. Generate a secure JWT secret:');
    console.error('   node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    console.error('2. Add it to your .env file:');
    console.error('   JWT_SECRET=<generated_secret>');
    console.error('3. Ensure .env is in .gitignore');
    console.error('4. Never commit secrets to git\n');
    
    process.exit(1);
  }

  console.log('\n✅ Environment validation passed!\n');
}

/**
 * Generate a new secure JWT secret
 */
function generateSecureSecret() {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Check if .env is in .gitignore
 */
function checkGitignore() {
  const fs = require('fs');
  const path = require('path');
  
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  
  if (!fs.existsSync(gitignorePath)) {
    console.warn('⚠️  WARNING: .gitignore file not found!');
    console.warn('   Create .gitignore and add .env to prevent committing secrets');
    return false;
  }

  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  
  if (!gitignoreContent.includes('.env')) {
    console.warn('⚠️  WARNING: .env is not in .gitignore!');
    console.warn('   Add .env to .gitignore to prevent committing secrets');
    return false;
  }

  console.log('✅ .env is properly ignored by git');
  return true;
}

module.exports = {
  validateEnvironment,
  validateJWTSecret,
  generateSecureSecret,
  checkGitignore
};
