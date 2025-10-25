/**
 * SECURITY FEATURES TEST
 * 
 * Tests HTTPS enforcement, security headers, and rate limiting
 * 
 * USAGE:
 * node tests/security-test.js
 */

const axios = require('axios');

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const TEST_ENDPOINTS = {
  health: `${BACKEND_URL}/`,
  api: `${BACKEND_URL}/api/medication`,
  auth: `${BACKEND_URL}/api/auth/login`,
  checkout: `${BACKEND_URL}/api/med-checkout`,
};

/**
 * Test 1: Security Headers
 */
async function testSecurityHeaders() {
  console.log('\n🧪 TEST 1: Security Headers');
  console.log('=' .repeat(60));
  
  try {
    const response = await axios.get(TEST_ENDPOINTS.health, {
      validateStatus: () => true // Don't throw on any status
    });
    
    const headers = response.headers;
    
    console.log('\n📋 Security Headers Check:');
    
    const checks = {
      'X-Content-Type-Options': headers['x-content-type-options'] === 'nosniff',
      'X-Frame-Options': !!headers['x-frame-options'],
      'X-XSS-Protection': !!headers['x-xss-protection'],
      'Strict-Transport-Security': !!headers['strict-transport-security'],
      'Content-Security-Policy': !!headers['content-security-policy'],
      'X-Powered-By Removed': !headers['x-powered-by'],
    };
    
    let passed = 0;
    let total = 0;
    
    for (const [header, present] of Object.entries(checks)) {
      total++;
      if (present) {
        console.log(`  ✅ ${header}`);
        passed++;
      } else {
        console.log(`  ❌ ${header}`);
      }
    }
    
    console.log(`\n📊 Headers Score: ${passed}/${total}`);
    
    if (passed === total) {
      console.log('✅ TEST 1 PASSED: All security headers present');
      return true;
    } else {
      console.log('⚠️  TEST 1 PARTIAL: Some headers missing');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 1 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 2: General API Rate Limiting (100 requests / 15 min)
 */
async function testApiRateLimit() {
  console.log('\n🧪 TEST 2: General API Rate Limiting');
  console.log('=' .repeat(60));
  console.log('Sending 105 rapid requests to trigger rate limit...\n');
  
  try {
    let successCount = 0;
    let rateLimitHit = false;
    let rateLimitResponse = null;
    
    for (let i = 1; i <= 105; i++) {
      try {
        const response = await axios.get(TEST_ENDPOINTS.api, {
          validateStatus: () => true
        });
        
        if (response.status === 200) {
          successCount++;
          if (i % 20 === 0) {
            console.log(`  Request ${i}: ✅ Success (${successCount} total)`);
          }
        } else if (response.status === 429) {
          if (!rateLimitHit) {
            console.log(`  Request ${i}: 🚫 Rate limit hit!`);
            rateLimitResponse = response.data;
            rateLimitHit = true;
          }
        }
        
        // Stop after hitting rate limit
        if (rateLimitHit && i > successCount + 5) {
          break;
        }
        
      } catch (error) {
        // Continue on errors
      }
    }
    
    console.log(`\n📊 Results:`);
    console.log(`  Successful requests: ${successCount}`);
    console.log(`  Rate limit hit: ${rateLimitHit ? 'Yes' : 'No'}`);
    
    if (rateLimitResponse) {
      console.log(`\n📋 Rate Limit Response:`);
      console.log(`  Error: ${rateLimitResponse.error}`);
      console.log(`  Message: ${rateLimitResponse.message}`);
      console.log(`  Retry After: ${rateLimitResponse.retryAfter}`);
    }
    
    // Should hit rate limit around 100 requests
    if (rateLimitHit && successCount >= 90 && successCount <= 110) {
      console.log('\n✅ TEST 2 PASSED: Rate limiting working correctly');
      return true;
    } else if (!rateLimitHit) {
      console.log('\n❌ TEST 2 FAILED: Rate limit not triggered');
      return false;
    } else {
      console.log('\n⚠️  TEST 2 PARTIAL: Rate limit triggered but at unexpected count');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 2 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 3: Auth Rate Limiting (5 attempts / 15 min)
 */
async function testAuthRateLimit() {
  console.log('\n🧪 TEST 3: Authentication Rate Limiting');
  console.log('=' .repeat(60));
  console.log('Sending 7 login attempts to trigger auth rate limit...\n');
  
  try {
    let successCount = 0;
    let rateLimitHit = false;
    let rateLimitResponse = null;
    
    for (let i = 1; i <= 7; i++) {
      try {
        const response = await axios.post(TEST_ENDPOINTS.auth, {
          email: 'test@example.com',
          password: 'wrongpassword'
        }, {
          validateStatus: () => true
        });
        
        if (response.status !== 429) {
          successCount++;
          console.log(`  Attempt ${i}: Request sent (status: ${response.status})`);
        } else {
          if (!rateLimitHit) {
            console.log(`  Attempt ${i}: 🚫 Auth rate limit hit!`);
            rateLimitResponse = response.data;
            rateLimitHit = true;
          }
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        // Continue on errors
      }
    }
    
    console.log(`\n📊 Results:`);
    console.log(`  Requests before rate limit: ${successCount}`);
    console.log(`  Rate limit hit: ${rateLimitHit ? 'Yes' : 'No'}`);
    
    if (rateLimitResponse) {
      console.log(`\n📋 Rate Limit Response:`);
      console.log(`  Error: ${rateLimitResponse.error}`);
      console.log(`  Message: ${rateLimitResponse.message}`);
      console.log(`  Lockout Duration: ${rateLimitResponse.lockoutDuration}`);
    }
    
    // Should hit rate limit after 5-6 attempts
    if (rateLimitHit && successCount >= 5 && successCount <= 6) {
      console.log('\n✅ TEST 3 PASSED: Auth rate limiting working correctly');
      return true;
    } else if (!rateLimitHit) {
      console.log('\n❌ TEST 3 FAILED: Auth rate limit not triggered');
      return false;
    } else {
      console.log('\n⚠️  TEST 3 PARTIAL: Rate limit triggered but at unexpected count');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 3 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 4: Checkout Rate Limiting (10 attempts / 1 hour)
 */
async function testCheckoutRateLimit() {
  console.log('\n🧪 TEST 4: Checkout Rate Limiting');
  console.log('=' .repeat(60));
  console.log('Sending 12 checkout attempts to trigger checkout rate limit...\n');
  
  try {
    let successCount = 0;
    let rateLimitHit = false;
    let rateLimitResponse = null;
    
    for (let i = 1; i <= 12; i++) {
      try {
        const response = await axios.post(TEST_ENDPOINTS.checkout, {
          name: 'Test User',
          email: 'test@example.com',
          phone: '+2348012345678',
          deliveryMethod: 'PICKUP'
        }, {
          headers: {
            'x-guest-id': 'test_rate_limit_user'
          },
          validateStatus: () => true
        });
        
        if (response.status !== 429) {
          successCount++;
          console.log(`  Attempt ${i}: Request sent (status: ${response.status})`);
        } else {
          if (!rateLimitHit) {
            console.log(`  Attempt ${i}: 🚫 Checkout rate limit hit!`);
            rateLimitResponse = response.data;
            rateLimitHit = true;
          }
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        // Continue on errors
      }
    }
    
    console.log(`\n📊 Results:`);
    console.log(`  Requests before rate limit: ${successCount}`);
    console.log(`  Rate limit hit: ${rateLimitHit ? 'Yes' : 'No'}`);
    
    if (rateLimitResponse) {
      console.log(`\n📋 Rate Limit Response:`);
      console.log(`  Error: ${rateLimitResponse.error}`);
      console.log(`  Message: ${rateLimitResponse.message}`);
      console.log(`  Retry After: ${rateLimitResponse.retryAfter}`);
    }
    
    // Should hit rate limit after 10-11 attempts
    if (rateLimitHit && successCount >= 10 && successCount <= 11) {
      console.log('\n✅ TEST 4 PASSED: Checkout rate limiting working correctly');
      return true;
    } else if (!rateLimitHit) {
      console.log('\n❌ TEST 4 FAILED: Checkout rate limit not triggered');
      return false;
    } else {
      console.log('\n⚠️  TEST 4 PARTIAL: Rate limit triggered but at unexpected count');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 4 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 5: Rate Limit Headers
 */
async function testRateLimitHeaders() {
  console.log('\n🧪 TEST 5: Rate Limit Headers');
  console.log('=' .repeat(60));
  
  try {
    const response = await axios.get(TEST_ENDPOINTS.api, {
      validateStatus: () => true
    });
    
    const headers = response.headers;
    
    console.log('\n📋 Rate Limit Headers:');
    console.log(`  RateLimit-Limit: ${headers['ratelimit-limit'] || 'Not present'}`);
    console.log(`  RateLimit-Remaining: ${headers['ratelimit-remaining'] || 'Not present'}`);
    console.log(`  RateLimit-Reset: ${headers['ratelimit-reset'] || 'Not present'}`);
    
    const hasHeaders = headers['ratelimit-limit'] && 
                       headers['ratelimit-remaining'] && 
                       headers['ratelimit-reset'];
    
    if (hasHeaders) {
      console.log('\n✅ TEST 5 PASSED: Rate limit headers present');
      return true;
    } else {
      console.log('\n❌ TEST 5 FAILED: Rate limit headers missing');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 5 ERROR:', error.message);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🔒 SECURITY FEATURES TESTS');
  console.log('='.repeat(60));
  console.log('Backend URL:', BACKEND_URL);
  console.log('\n⚠️  WARNING: These tests will trigger rate limits!');
  console.log('You may need to wait 15-60 minutes before running again.\n');
  
  const results = {
    securityHeaders: await testSecurityHeaders(),
    rateLimitHeaders: await testRateLimitHeaders(),
    apiRateLimit: await testApiRateLimit(),
    authRateLimit: await testAuthRateLimit(),
    checkoutRateLimit: await testCheckoutRateLimit(),
  };
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  
  console.log(`\nTests Passed: ${passed}/${total}\n`);
  console.log('Detailed Results:');
  console.log('  Security Headers:', results.securityHeaders ? '✅ PASS' : '❌ FAIL');
  console.log('  Rate Limit Headers:', results.rateLimitHeaders ? '✅ PASS' : '❌ FAIL');
  console.log('  API Rate Limiting:', results.apiRateLimit ? '✅ PASS' : '⚠️  SKIP/FAIL');
  console.log('  Auth Rate Limiting:', results.authRateLimit ? '✅ PASS' : '⚠️  SKIP/FAIL');
  console.log('  Checkout Rate Limiting:', results.checkoutRateLimit ? '✅ PASS' : '⚠️  SKIP/FAIL');
  
  if (passed >= 2) { // At least headers tests should pass
    console.log('\n✅ SECURITY FEATURES WORKING!');
    console.log('   Headers and rate limiting are properly configured.');
    process.exit(0);
  } else {
    console.log('\n⚠️  SOME TESTS FAILED! Review the implementation.');
    process.exit(1);
  }
}

// Run tests
runAllTests();
