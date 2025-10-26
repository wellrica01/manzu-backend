/**
 * RATE LIMITING MIDDLEWARE
 * 
 * Extracted from app.js for better organization
 * Three-tier rate limiting strategy
 */

const rateLimit = require('express-rate-limit');
const { API_RATE_LIMIT, AUTH_RATE_LIMIT, CHECKOUT_RATE_LIMIT } = require('../config/rate-limits');

// ==================== TIER 1: General API Rate Limit ====================
const apiLimiter = rateLimit({
  ...API_RATE_LIMIT,
  handler: (req, res) => {
    console.log(`Rate limit exceeded for IP: ${req.ip} on ${req.originalUrl}`);
    res.status(429).json(API_RATE_LIMIT.message);
  },
});

// ==================== TIER 2: Authentication Rate Limit ====================
const authLimiter = rateLimit({
  ...AUTH_RATE_LIMIT,
  handler: (req, res) => {
    console.log(`Auth rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      ...AUTH_RATE_LIMIT.message,
      lockoutDuration: '15 minutes'
    });
  },
});

// ==================== TIER 3: Checkout Rate Limit ====================
const checkoutLimiter = rateLimit({
  ...CHECKOUT_RATE_LIMIT,
  handler: (req, res) => {
    console.log(`Checkout rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json(CHECKOUT_RATE_LIMIT.message);
  },
});

// Log configuration on startup
console.log('✅ Rate limiting configured:');
console.log(`  - General API: ${API_RATE_LIMIT.max} requests / ${API_RATE_LIMIT.windowMs / 60000} min`);
console.log(`  - Authentication: ${AUTH_RATE_LIMIT.max} attempts / ${AUTH_RATE_LIMIT.windowMs / 60000} min`);
console.log(`  - Checkout: ${CHECKOUT_RATE_LIMIT.max} attempts / ${CHECKOUT_RATE_LIMIT.windowMs / 60000 / 60} hour`);

module.exports = {
  apiLimiter,
  authLimiter,
  checkoutLimiter,
};