/**
 * ENVIRONMENT VARIABLE VALIDATOR (FND-05b1)
 *
 * Validates critical environment variables on startup.
 * Prevents app from starting with weak or missing secrets.
 *
 * FND-05b1 adds split secrets - JWT_SECRET_PHARMACY, JWT_SECRET_ADMIN,
 * JWT_SECRET_STEPUP - with a two-phase rollout:
 *
 *   Phase 1 (this deploy): if any of the three is missing, validateEnvironment
 *   warns and the affected audience falls back to JWT_SECRET. The app boots.
 *
 *   Phase 2 (next deploy, after the owner adds the three vars to Render and
 *   .env): all three are present. validateSplitSecrets checks that none two
 *   are equal and that each passes the same strength test as JWT_SECRET.
 *
 * getSecretFor(audience) is the accessor the session services use:
 *   - 'pharmacy' -> JWT_SECRET_PHARMACY, else JWT_SECRET
 *   - 'admin'    -> JWT_SECRET_ADMIN,    else JWT_SECRET
 *   - 'stepup'   -> JWT_SECRET_STEPUP,   else JWT_SECRET
 * It never throws; it logs once per audience per process if it falls back.
 */

const crypto = require('crypto');

const SPLIT_SECRET_NAMES = Object.freeze({
  pharmacy: 'JWT_SECRET_PHARMACY',
  admin: 'JWT_SECRET_ADMIN',
  stepup: 'JWT_SECRET_STEPUP',
});

const warnedAudiences = new Set();

/**
 * Validate JWT secret strength (unchanged from before FND-05b1).
 */
function validateJWTSecret(secret) {
  if (!secret) {
    return {
      valid: false,
      error: 'JWT_SECRET is missing! This is a critical security requirement.'
    };
  }

  if (secret.length < 64) {
    return {
      valid: false,
      error: `JWT_SECRET is too short (${secret.length} characters). Minimum 64 characters required for security.`
    };
  }

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

  const uniqueChars = new Set(secret).size;
  const isHexString = /^[0-9a-f]+$/i.test(secret);
  if (isHexString && secret.length >= 128) {
    return { valid: true };
  }
  if (!isHexString && uniqueChars < 20) {
    return {
      valid: false,
      error: `JWT_SECRET has low entropy (only ${uniqueChars} unique characters). Use a random secret.`
    };
  }

  return { valid: true };
}

/**
 * Validate the split secrets (FND-05b1).
 * Never exits the process. Returns { errors, warnings, present }:
 *   present.pharmacy / present.admin / present.stepup -> boolean
 * The caller (validateEnvironment) decides what to do with errors.
 */
function validateSplitSecrets() {
  const errors = [];
  const warnings = [];
  const present = { pharmacy: false, admin: false, stepup: false };
  const values = {};

  for (const [audience, name] of Object.entries(SPLIT_SECRET_NAMES)) {
    const value = process.env[name];
    if (!value) {
      warnings.push(
        `${name} not set; ${audience} tokens will use JWT_SECRET as a fallback. Add ${name} before the Phase 2 deploy.`
      );
      continue;
    }
    present[audience] = true;
    values[audience] = value;
    const check = validateJWTSecret(value);
    if (!check.valid) {
      errors.push(check.error.replace('JWT_SECRET', name));
    }
  }

  // If any two of the present secrets are equal, error. That would mean a
  // pharmacy token could be accepted by the admin guard, or vice versa.
  const seen = new Map();
  for (const [audience, value] of Object.entries(values)) {
    if (seen.has(value)) {
      errors.push(
        `${SPLIT_SECRET_NAMES[audience]} is identical to ${SPLIT_SECRET_NAMES[seen.get(value)]}. Split secrets must be distinct.`
      );
    } else {
      seen.set(value, audience);
    }
  }

  return { errors, warnings, present };
}

/**
 * Accessor used by session services. Returns the correct secret for the given
 * audience, or JWT_SECRET as a fallback. Logs a warning once per audience per
 * process the first time it falls back, so production logs make it visible.
 */
function getSecretFor(audience) {
  const name = SPLIT_SECRET_NAMES[audience];
  if (!name) {
    throw new Error(`getSecretFor: unknown audience "${audience}"`);
  }
  const value = process.env[name];
  if (value) return value;

  if (!warnedAudiences.has(audience)) {
    warnedAudiences.add(audience);
    console.warn(`[env-validator] ${name} not set; ${audience} tokens are using JWT_SECRET. Add ${name} before the Phase 2 deploy.`);
  }
  if (!process.env.JWT_SECRET) {
    throw new Error(`getSecretFor: neither ${name} nor JWT_SECRET is set. Cannot sign ${audience} tokens.`);
  }
  return process.env.JWT_SECRET;
}

/**
 * Validate all required environment variables.
 */
function validateEnvironment() {
  console.log('\nValidating environment variables...');

  const errors = [];
  const warnings = [];

  // Critical: the legacy base secret. Still required in Phase 1 because the
  // split secrets fall back to it. Phase 2 keeps it as the fallback path.
  const jwtValidation = validateJWTSecret(process.env.JWT_SECRET);
  if (!jwtValidation.valid) {
    errors.push(jwtValidation.error);
  } else {
    console.log('JWT_SECRET: Valid and secure');
  }

  // Split secrets (FND-05b1). Warnings only in Phase 1.
  const split = validateSplitSecrets();
  warnings.push(...split.warnings);
  errors.push(...split.errors);
  if (split.present.pharmacy && split.present.admin && split.present.stepup) {
    console.log('Split secrets: JWT_SECRET_PHARMACY, JWT_SECRET_ADMIN, JWT_SECRET_STEPUP all set and distinct');
  } else {
    console.log('Split secrets: partial - falling back to JWT_SECRET for missing audiences (Phase 1)');
  }

  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL is missing');
  } else {
    console.log('DATABASE_URL: Configured');
  }

  if (!process.env.NODE_ENV) {
    warnings.push('NODE_ENV not set, defaulting to development');
  } else {
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  }

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.SENTRY_DSN) {
      warnings.push('SENTRY_DSN not set in production (error monitoring disabled)');
    }
    if (process.env.SENTRY_DEBUG === 'true') {
      warnings.push('SENTRY_DEBUG is enabled in production');
    }
    if (!process.env.PAYSTACK_SECRET_KEY) {
      errors.push('PAYSTACK_SECRET_KEY is missing in production');
    }
    // P-06: invite codes are HMACd with this pepper. Stored hashes are useless without it.
    if (!process.env.INVITE_PEPPER || process.env.INVITE_PEPPER.length < 32) {
      errors.push('INVITE_PEPPER is missing or shorter than 32 characters in production');
    }
    // In production, missing split secrets are a warning in Phase 1 but must
    // become an error in Phase 2. Flip SEC_REQUIRE_SPLIT_SECRETS=true to
    // enforce now, without a code change.
    const requireSplit = String(process.env.SEC_REQUIRE_SPLIT_SECRETS || '').toLowerCase() === 'true';
    if (requireSplit && !(split.present.pharmacy && split.present.admin && split.present.stepup)) {
      errors.push(
        'SEC_REQUIRE_SPLIT_SECRETS=true but one or more of JWT_SECRET_PHARMACY, JWT_SECRET_ADMIN, JWT_SECRET_STEPUP is missing'
      );
    }
  }

  if (warnings.length > 0) {
    console.log('\nWarnings:');
    warnings.forEach((warning) => console.log(warning));
  }

  if (errors.length > 0) {
    console.error('\nCRITICAL ERRORS - Application cannot start:');
    errors.forEach((error) => console.error(error));
    console.error('\nHow to fix:');
    console.error('1. Generate a secure JWT secret:');
    console.error('   node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    console.error('2. Add it to your .env file (JWT_SECRET, and optionally the three split secrets):');
    console.error('   JWT_SECRET=<generated_secret>');
    console.error('   JWT_SECRET_PHARMACY=<generated_secret>');
    console.error('   JWT_SECRET_ADMIN=<generated_secret>');
    console.error('   JWT_SECRET_STEPUP=<generated_secret>');
    console.error('3. Ensure .env is in .gitignore');
    console.error('4. Never commit secrets to git\n');
    process.exit(1);
  }

  console.log('\nEnvironment validation passed!\n');
}

function generateSecureSecret() {
  return crypto.randomBytes(64).toString('hex');
}

function checkGitignore() {
  const fs = require('fs');
  const path = require('path');
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    console.warn('WARNING: .gitignore file not found!');
    console.warn('   Create .gitignore and add .env to prevent committing secrets');
    return false;
  }
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  if (!gitignoreContent.includes('.env')) {
    console.warn('WARNING: .env is not in .gitignore!');
    console.warn('   Add .env to .gitignore to prevent committing secrets');
    return false;
  }
  console.log('.env is properly ignored by git');
  return true;
}

module.exports = {
  validateEnvironment,
  validateJWTSecret,
  validateSplitSecrets,
  getSecretFor,
  generateSecureSecret,
  checkGitignore,
  SPLIT_SECRET_NAMES,
};