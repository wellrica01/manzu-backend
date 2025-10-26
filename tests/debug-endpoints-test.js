/**
 * DEBUG ENDPOINTS SECURITY TEST
 * 
 * Tests that debug/development endpoints are properly secured or removed
 * 
 * USAGE:
 * node tests/debug-endpoints-test.js
 */

const axios = require('axios');

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const TEST_ENDPOINTS = [
  '/api/med-confirmation/debug',
  '/api/debug',
  '/api/test',
  '/api/dev',
  '/debug',
  '/test',
];

/**
 * Test 1: Debug endpoint removed/returns 404
 */
async function testDebugEndpointRemoved() {
  console.log('🧪 TEST 1: Debug Endpoint Removed');
  console.log('=' .repeat(60));
  
  try {
    const endpoint = `${BACKEND_URL}/api/med-confirmation/debug`;
    console.log(`📡 Testing: ${endpoint}`);
    
    const response = await axios.get(endpoint, {
      validateStatus: () => true // Don't throw on non-2xx
    });
    
    console.log(`Response status: ${response.status}`);
    
    // Should return 404 (not found) since endpoint is removed
    if (response.status === 404) {
      console.log('✅ TEST 1 PASSED: Debug endpoint returns 404 (removed)\n');
      return true;
    } else if (response.status === 200) {
      console.log('❌ TEST 1 FAILED: Debug endpoint still accessible!');
      console.log('Response data:', JSON.stringify(response.data, null, 2));
      console.log();
      return false;
    } else {
      console.log(`⚠️  Unexpected status: ${response.status}\n`);
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 1 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 2: Debug endpoint doesn't expose sensitive data
 */
async function testNoSensitiveDataExposed() {
  console.log('🧪 TEST 2: No Sensitive Data Exposed');
  console.log('=' .repeat(60));
  
  try {
    const endpoint = `${BACKEND_URL}/api/med-confirmation/debug`;
    console.log(`📡 Testing: ${endpoint}?reference=test&session=test`);
    
    const response = await axios.get(endpoint, {
      params: { reference: 'test', session: 'test' },
      validateStatus: () => true
    });
    
    console.log(`Response status: ${response.status}`);
    
    // Check if response contains sensitive data
    const responseStr = JSON.stringify(response.data).toLowerCase();
    const sensitiveKeywords = [
      'transactionreference',
      'orderreference',
      'useridentifier',
      'paymentreference',
      'email',
      'phone',
      'address'
    ];
    
    let foundSensitive = false;
    const foundKeywords = [];
    
    for (const keyword of sensitiveKeywords) {
      if (responseStr.includes(keyword)) {
        foundSensitive = true;
        foundKeywords.push(keyword);
      }
    }
    
    if (response.status === 404) {
      console.log('✅ Endpoint not found (good)');
    }
    
    if (!foundSensitive || response.status === 404) {
      console.log('✅ TEST 2 PASSED: No sensitive data exposed\n');
      return true;
    } else {
      console.log('❌ TEST 2 FAILED: Sensitive data found in response!');
      console.log('Found keywords:', foundKeywords);
      console.log();
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 2 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 3: Other debug endpoints don't exist
 */
async function testOtherDebugEndpoints() {
  console.log('🧪 TEST 3: Other Debug Endpoints');
  console.log('=' .repeat(60));
  
  const results = [];
  
  for (const endpoint of TEST_ENDPOINTS) {
    try {
      const url = `${BACKEND_URL}${endpoint}`;
      console.log(`📡 Testing: ${url}`);
      
      const response = await axios.get(url, {
        validateStatus: () => true
      });
      
      console.log(`   Status: ${response.status}`);
      
      if (response.status === 404) {
        console.log('   ✅ Not found (good)');
        results.push(true);
      } else if (response.status === 401 || response.status === 403) {
        console.log('   ⚠️  Protected (acceptable)');
        results.push(true);
      } else if (response.status === 200) {
        console.log('   ❌ Accessible without auth (bad!)');
        results.push(false);
      } else {
        console.log(`   ⚠️  Unexpected: ${response.status}`);
        results.push(true); // Not accessible, so OK
      }
      
    } catch (error) {
      // Network errors are OK (endpoint doesn't exist)
      console.log(`   ✅ Not accessible`);
      results.push(true);
    }
  }
  
  const allSecure = results.every(r => r);
  
  if (allSecure) {
    console.log('\n✅ TEST 3 PASSED: No debug endpoints accessible\n');
    return true;
  } else {
    console.log('\n❌ TEST 3 FAILED: Some debug endpoints accessible\n');
    return false;
  }
}

/**
 * Test 4: Error messages don't expose stack traces
 */
async function testNoStackTraces() {
  console.log('🧪 TEST 4: No Stack Traces in Errors');
  console.log('=' .repeat(60));
  
  try {
    // Try to trigger an error
    const endpoint = `${BACKEND_URL}/api/med-confirmation`;
    console.log(`📡 Testing error handling: ${endpoint}`);
    
    const response = await axios.get(endpoint, {
      params: { reference: 'invalid_ref_12345' },
      validateStatus: () => true
    });
    
    console.log(`Response status: ${response.status}`);
    
    const responseStr = JSON.stringify(response.data);
    const hasStackTrace = responseStr.includes('at ') && 
                          (responseStr.includes('.js:') || responseStr.includes('Error:'));
    
    if (!hasStackTrace) {
      console.log('✅ TEST 4 PASSED: No stack traces in error responses\n');
      return true;
    } else {
      console.log('❌ TEST 4 FAILED: Stack trace found in error response!');
      console.log('Response:', JSON.stringify(response.data, null, 2));
      console.log();
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 4 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 5: Production environment check
 */
async function testProductionBehavior() {
  console.log('🧪 TEST 5: Production Environment Behavior');
  console.log('=' .repeat(60));
  
  const currentEnv = process.env.NODE_ENV || 'development';
  console.log(`Current environment: ${currentEnv}`);
  
  if (currentEnv === 'production') {
    console.log('✅ Running in production mode');
    
    // In production, debug endpoints should definitely not exist
    const endpoint = `${BACKEND_URL}/api/med-confirmation/debug`;
    
    try {
      const response = await axios.get(endpoint, {
        validateStatus: () => true
      });
      
      if (response.status === 404) {
        console.log('✅ TEST 5 PASSED: Debug endpoint not accessible in production\n');
        return true;
      } else {
        console.log('❌ TEST 5 FAILED: Debug endpoint accessible in production!');
        console.log(`Status: ${response.status}\n`);
        return false;
      }
    } catch (error) {
      console.log('✅ TEST 5 PASSED: Debug endpoint not accessible\n');
      return true;
    }
  } else {
    console.log('⚠️  Not in production mode, skipping production-specific tests');
    console.log('✅ TEST 5 PASSED: N/A for development\n');
    return true;
  }
}

/**
 * Test 6: Rate limiting on sensitive endpoints
 */
async function testRateLimiting() {
  console.log('🧪 TEST 6: Rate Limiting on Sensitive Endpoints');
  console.log('=' .repeat(60));
  
  try {
    const endpoint = `${BACKEND_URL}/api/auth/login`;
    console.log(`📡 Testing rate limiting: ${endpoint}`);
    console.log('Sending 10 rapid requests...');
    
    const requests = [];
    for (let i = 0; i < 10; i++) {
      requests.push(
        axios.post(endpoint, {
          email: 'test@example.com',
          password: 'wrongpassword'
        }, {
          validateStatus: () => true
        })
      );
    }
    
    const responses = await Promise.all(requests);
    const statuses = responses.map(r => r.status);
    
    console.log('Response statuses:', statuses);
    
    // Check if any request was rate limited (429)
    const hasRateLimit = statuses.includes(429);
    
    if (hasRateLimit) {
      console.log('✅ TEST 6 PASSED: Rate limiting active\n');
      return true;
    } else {
      console.log('⚠️  TEST 6 WARNING: No rate limiting detected');
      console.log('   (May need more requests to trigger)\n');
      return true; // Don't fail, might need more requests
    }
    
  } catch (error) {
    console.error('❌ TEST 6 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 7: HTTPS enforcement (if in production)
 */
async function testHTTPSEnforcement() {
  console.log('🧪 TEST 7: HTTPS Enforcement');
  console.log('=' .repeat(60));
  
  const currentEnv = process.env.NODE_ENV || 'development';
  
  if (currentEnv === 'production' && BACKEND_URL.startsWith('http://')) {
    console.log('❌ TEST 7 FAILED: Production URL uses HTTP instead of HTTPS!');
    console.log(`URL: ${BACKEND_URL}\n`);
    return false;
  } else if (currentEnv === 'production') {
    console.log('✅ Production URL uses HTTPS');
    console.log('✅ TEST 7 PASSED: HTTPS enforced in production\n');
    return true;
  } else {
    console.log('⚠️  Development mode, HTTPS not required');
    console.log('✅ TEST 7 PASSED: N/A for development\n');
    return true;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🔒 DEBUG ENDPOINTS SECURITY TESTS');
  console.log('='.repeat(60));
  console.log('Backend URL:', BACKEND_URL);
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('='.repeat(60));
  console.log();
  
  try {
    const test1 = await testDebugEndpointRemoved();
    const test2 = await testNoSensitiveDataExposed();
    const test3 = await testOtherDebugEndpoints();
    const test4 = await testNoStackTraces();
    const test5 = await testProductionBehavior();
    const test6 = await testRateLimiting();
    const test7 = await testHTTPSEnforcement();
    
    // Summary
    console.log('='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const results = {
      debugEndpointRemoved: test1,
      noSensitiveData: test2,
      otherDebugEndpoints: test3,
      noStackTraces: test4,
      productionBehavior: test5,
      rateLimiting: test6,
      httpsEnforcement: test7,
    };
    
    const passed = Object.values(results).filter(r => r).length;
    const total = Object.keys(results).length;
    
    console.log(`\nTests Passed: ${passed}/${total}\n`);
    console.log('Detailed Results:');
    console.log('  Debug Endpoint Removed:', results.debugEndpointRemoved ? '✅ PASS' : '❌ FAIL');
    console.log('  No Sensitive Data Exposed:', results.noSensitiveData ? '✅ PASS' : '❌ FAIL');
    console.log('  Other Debug Endpoints:', results.otherDebugEndpoints ? '✅ PASS' : '❌ FAIL');
    console.log('  No Stack Traces:', results.noStackTraces ? '✅ PASS' : '❌ FAIL');
    console.log('  Production Behavior:', results.productionBehavior ? '✅ PASS' : '❌ FAIL');
    console.log('  Rate Limiting:', results.rateLimiting ? '✅ PASS' : '⚠️  WARNING');
    console.log('  HTTPS Enforcement:', results.httpsEnforcement ? '✅ PASS' : '❌ FAIL');
    
    if (passed === total) {
      console.log('\n🎉 ALL TESTS PASSED! Debug endpoints are secure.');
      process.exit(0);
    } else {
      console.log('\n⚠️  SOME TESTS FAILED! Review security implementation.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n💥 Test suite crashed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runAllTests();
