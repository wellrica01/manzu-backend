/**
 * WEBHOOK SIGNATURE VERIFICATION TEST
 * 
 * This script tests the Paystack webhook signature verification
 * to ensure it properly rejects invalid signatures and accepts valid ones.
 * 
 * USAGE:
 * 1. Make sure your backend server is running
 * 2. Set PAYSTACK_SECRET_KEY in your .env file
 * 3. Run: node tests/webhook-signature-test.js
 */

const crypto = require('crypto');
const axios = require('axios');

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const WEBHOOK_ENDPOINT = `${BACKEND_URL}/api/med-confirmation/webhook`;

// Your Paystack secret key (same as in .env)
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_your_key_here';

// Sample webhook payload (Paystack charge.success event)
const webhookPayload = {
  event: 'charge.success',
  data: {
    id: 123456789,
    domain: 'test',
    status: 'success',
    reference: 'test_ref_' + Date.now(),
    amount: 50000, // 500 NGN in kobo
    message: 'Approved',
    gateway_response: 'Successful',
    paid_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    channel: 'card',
    currency: 'NGN',
    ip_address: '127.0.0.1',
    metadata: {},
    customer: {
      id: 123456,
      first_name: 'Test',
      last_name: 'User',
      email: 'test@example.com',
      phone: '+2348012345678'
    }
  }
};

/**
 * Generate valid Paystack signature
 */
function generateSignature(payload, secret) {
  return crypto
    .createHmac('sha512', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

/**
 * Test 1: Valid signature should be accepted
 */
async function testValidSignature() {
  console.log('\n🧪 TEST 1: Valid Signature');
  console.log('=' .repeat(50));
  
  try {
    const validSignature = generateSignature(webhookPayload, PAYSTACK_SECRET_KEY);
    
    console.log('Sending webhook with VALID signature...');
    console.log('Signature:', validSignature.substring(0, 20) + '...');
    
    const response = await axios.post(WEBHOOK_ENDPOINT, webhookPayload, {
      headers: {
        'x-paystack-signature': validSignature,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 200) {
      console.log('✅ PASS: Valid signature accepted');
      console.log('Response:', response.data);
      return true;
    } else {
      console.log('❌ FAIL: Unexpected status code:', response.status);
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL: Request failed');
    console.log('Error:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Test 2: Invalid signature should be rejected
 */
async function testInvalidSignature() {
  console.log('\n🧪 TEST 2: Invalid Signature');
  console.log('=' .repeat(50));
  
  try {
    const invalidSignature = 'invalid_signature_12345';
    
    console.log('Sending webhook with INVALID signature...');
    console.log('Signature:', invalidSignature);
    
    const response = await axios.post(WEBHOOK_ENDPOINT, webhookPayload, {
      headers: {
        'x-paystack-signature': invalidSignature,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true // Don't throw on 401
    });
    
    if (response.status === 401) {
      console.log('✅ PASS: Invalid signature rejected with 401');
      console.log('Response:', response.data);
      return true;
    } else {
      console.log('❌ FAIL: Expected 401, got:', response.status);
      console.log('Response:', response.data);
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL: Request failed unexpectedly');
    console.log('Error:', error.message);
    return false;
  }
}

/**
 * Test 3: Missing signature should be rejected
 */
async function testMissingSignature() {
  console.log('\n🧪 TEST 3: Missing Signature');
  console.log('=' .repeat(50));
  
  try {
    console.log('Sending webhook with NO signature header...');
    
    const response = await axios.post(WEBHOOK_ENDPOINT, webhookPayload, {
      headers: {
        'Content-Type': 'application/json'
        // No x-paystack-signature header
      },
      validateStatus: () => true
    });
    
    if (response.status === 401) {
      console.log('✅ PASS: Missing signature rejected with 401');
      console.log('Response:', response.data);
      return true;
    } else {
      console.log('❌ FAIL: Expected 401, got:', response.status);
      console.log('Response:', response.data);
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL: Request failed unexpectedly');
    console.log('Error:', error.message);
    return false;
  }
}

/**
 * Test 4: Tampered payload should be rejected
 */
async function testTamperedPayload() {
  console.log('\n🧪 TEST 4: Tampered Payload');
  console.log('=' .repeat(50));
  
  try {
    // Generate signature for original payload
    const validSignature = generateSignature(webhookPayload, PAYSTACK_SECRET_KEY);
    
    // Tamper with the payload AFTER generating signature
    const tamperedPayload = {
      ...webhookPayload,
      data: {
        ...webhookPayload.data,
        amount: 999999999 // Attacker tries to change amount
      }
    };
    
    console.log('Sending TAMPERED payload with original signature...');
    console.log('Original amount:', webhookPayload.data.amount);
    console.log('Tampered amount:', tamperedPayload.data.amount);
    
    const response = await axios.post(WEBHOOK_ENDPOINT, tamperedPayload, {
      headers: {
        'x-paystack-signature': validSignature,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });
    
    if (response.status === 401) {
      console.log('✅ PASS: Tampered payload rejected with 401');
      console.log('Response:', response.data);
      return true;
    } else {
      console.log('❌ FAIL: Expected 401, got:', response.status);
      console.log('⚠️  WARNING: Payload tampering was NOT detected!');
      console.log('Response:', response.data);
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL: Request failed unexpectedly');
    console.log('Error:', error.message);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(50));
  console.log('🔒 PAYSTACK WEBHOOK SIGNATURE VERIFICATION TESTS');
  console.log('='.repeat(50));
  console.log('Backend URL:', BACKEND_URL);
  console.log('Webhook Endpoint:', WEBHOOK_ENDPOINT);
  console.log('Secret Key:', PAYSTACK_SECRET_KEY ? '✅ Configured' : '❌ Missing');
  
  if (!PAYSTACK_SECRET_KEY || PAYSTACK_SECRET_KEY === 'sk_test_your_key_here') {
    console.log('\n⚠️  WARNING: PAYSTACK_SECRET_KEY not configured!');
    console.log('Set it in your .env file or as an environment variable.');
    console.log('Example: export PAYSTACK_SECRET_KEY=sk_test_xxxxx');
    process.exit(1);
  }
  
  const results = {
    validSignature: await testValidSignature(),
    invalidSignature: await testInvalidSignature(),
    missingSignature: await testMissingSignature(),
    tamperedPayload: await testTamperedPayload()
  };
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(50));
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  
  console.log(`Tests Passed: ${passed}/${total}`);
  console.log('\nDetailed Results:');
  console.log('  Valid Signature:', results.validSignature ? '✅ PASS' : '❌ FAIL');
  console.log('  Invalid Signature:', results.invalidSignature ? '✅ PASS' : '❌ FAIL');
  console.log('  Missing Signature:', results.missingSignature ? '✅ PASS' : '❌ FAIL');
  console.log('  Tampered Payload:', results.tamperedPayload ? '✅ PASS' : '❌ FAIL');
  
  if (passed === total) {
    console.log('\n🎉 ALL TESTS PASSED! Webhook signature verification is working correctly.');
    process.exit(0);
  } else {
    console.log('\n⚠️  SOME TESTS FAILED! Review the implementation.');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  console.error('\n💥 Test suite crashed:', error.message);
  process.exit(1);
});
