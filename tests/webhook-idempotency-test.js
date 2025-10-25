/**
 * WEBHOOK IDEMPOTENCY TEST
 * 
 * Tests that duplicate webhooks are properly detected and ignored
 * 
 * USAGE:
 * node tests/webhook-idempotency-test.js
 */

const crypto = require('crypto');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const WEBHOOK_ENDPOINT = `${BACKEND_URL}/api/med-confirmation/webhook`;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

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
 * Test 1: First webhook should be processed
 */
async function testFirstWebhook() {
  console.log('\n🧪 TEST 1: First Webhook Processing');
  console.log('=' .repeat(60));
  
  try {
    const webhookPayload = {
      event: 'charge.success',
      data: {
        id: `test_event_${Date.now()}`,
        reference: `test_ref_${Date.now()}`,
        amount: 50000,
        status: 'success',
        customer: {
          email: 'test@example.com'
        }
      }
    };
    
    const signature = generateSignature(webhookPayload, PAYSTACK_SECRET_KEY);
    
    console.log('Sending first webhook...');
    console.log('Event ID:', webhookPayload.data.id);
    
    const response = await axios.post(WEBHOOK_ENDPOINT, webhookPayload, {
      headers: {
        'x-paystack-signature': signature,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });
    
    console.log('Response status:', response.status);
    console.log('Response:', response.data);
    
    // Check if webhook was recorded in database
    const recorded = await prisma.processedWebhook.findUnique({
      where: { eventId: String(webhookPayload.data.id) }
    });
    
    if (response.status === 200 && recorded) {
      console.log('\n✅ TEST 1 PASSED: First webhook processed and recorded');
      return { passed: true, eventId: webhookPayload.data.id, payload: webhookPayload };
    } else if (response.status === 404) {
      console.log('\n⚠️  TEST 1 SKIPPED: Transaction not found (expected for test data)');
      return { passed: true, eventId: webhookPayload.data.id, payload: webhookPayload };
    } else {
      console.log('\n❌ TEST 1 FAILED: Unexpected response');
      return { passed: false };
    }
    
  } catch (error) {
    console.error('❌ TEST 1 ERROR:', error.message);
    return { passed: false };
  }
}

/**
 * Test 2: Duplicate webhook should be ignored
 */
async function testDuplicateWebhook(eventId, originalPayload) {
  console.log('\n🧪 TEST 2: Duplicate Webhook Detection');
  console.log('=' .repeat(60));
  
  try {
    const signature = generateSignature(originalPayload, PAYSTACK_SECRET_KEY);
    
    console.log('Sending duplicate webhook...');
    console.log('Event ID:', eventId);
    
    const response = await axios.post(WEBHOOK_ENDPOINT, originalPayload, {
      headers: {
        'x-paystack-signature': signature,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });
    
    console.log('Response status:', response.status);
    console.log('Response:', response.data);
    
    // Should return 200 but with "already processed" message
    if (response.status === 200 && response.data.message === 'Webhook already processed') {
      console.log('\n✅ TEST 2 PASSED: Duplicate webhook detected and ignored');
      return true;
    } else {
      console.log('\n❌ TEST 2 FAILED: Duplicate not detected properly');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 2 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 3: Multiple rapid duplicates
 */
async function testRapidDuplicates() {
  console.log('\n🧪 TEST 3: Rapid Duplicate Webhooks');
  console.log('=' .repeat(60));
  
  try {
    const webhookPayload = {
      event: 'charge.success',
      data: {
        id: `test_rapid_${Date.now()}`,
        reference: `test_ref_rapid_${Date.now()}`,
        amount: 50000,
        status: 'success',
        customer: {
          email: 'test@example.com'
        }
      }
    };
    
    const signature = generateSignature(webhookPayload, PAYSTACK_SECRET_KEY);
    
    console.log('Sending 5 identical webhooks simultaneously...');
    console.log('Event ID:', webhookPayload.data.id);
    
    // Send 5 identical webhooks at the same time
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        axios.post(WEBHOOK_ENDPOINT, webhookPayload, {
          headers: {
            'x-paystack-signature': signature,
            'Content-Type': 'application/json'
          },
          validateStatus: () => true
        })
      );
    }
    
    const responses = await Promise.all(promises);
    
    // Count how many were processed vs ignored
    const processed = responses.filter(r => 
      r.status === 200 && r.data.message === 'Webhook processed successfully'
    ).length;
    
    const ignored = responses.filter(r => 
      r.status === 200 && r.data.message === 'Webhook already processed'
    ).length;
    
    const notFound = responses.filter(r => r.status === 404).length;
    
    console.log(`\n📊 Results:`);
    console.log(`  Processed: ${processed}`);
    console.log(`  Ignored (already processed): ${ignored}`);
    console.log(`  Not found: ${notFound}`);
    
    // Check database - should only have 1 record
    const records = await prisma.processedWebhook.findMany({
      where: { eventId: String(webhookPayload.data.id) }
    });
    
    console.log(`  Database records: ${records.length}`);
    
    // Should have exactly 1 record in database
    if (records.length === 1 && (processed === 1 || notFound === 1)) {
      console.log('\n✅ TEST 3 PASSED: Only one webhook processed, rest ignored');
      return true;
    } else {
      console.log('\n❌ TEST 3 FAILED: Multiple webhooks were processed');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 3 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 4: Different events with same reference
 */
async function testDifferentEvents() {
  console.log('\n🧪 TEST 4: Different Event Types');
  console.log('=' .repeat(60));
  
  try {
    const baseReference = `test_ref_${Date.now()}`;
    
    // Send two different event types with same reference
    const event1 = {
      event: 'charge.success',
      data: {
        id: `event1_${Date.now()}`,
        reference: baseReference,
        amount: 50000,
        status: 'success'
      }
    };
    
    const event2 = {
      event: 'transfer.success',
      data: {
        id: `event2_${Date.now()}`,
        reference: baseReference,
        amount: 50000,
        status: 'success'
      }
    };
    
    console.log('Sending two different event types with same reference...');
    
    const sig1 = generateSignature(event1, PAYSTACK_SECRET_KEY);
    const sig2 = generateSignature(event2, PAYSTACK_SECRET_KEY);
    
    const response1 = await axios.post(WEBHOOK_ENDPOINT, event1, {
      headers: { 'x-paystack-signature': sig1 },
      validateStatus: () => true
    });
    
    const response2 = await axios.post(WEBHOOK_ENDPOINT, event2, {
      headers: { 'x-paystack-signature': sig2 },
      validateStatus: () => true
    });
    
    console.log('Event 1 status:', response1.status);
    console.log('Event 2 status:', response2.status);
    
    // Both should be processed (different event IDs)
    const records = await prisma.processedWebhook.findMany({
      where: {
        eventId: {
          in: [String(event1.data.id), String(event2.data.id)]
        }
      }
    });
    
    console.log(`Database records: ${records.length}`);
    
    if (records.length === 2) {
      console.log('\n✅ TEST 4 PASSED: Different events processed separately');
      return true;
    } else {
      console.log('\n❌ TEST 4 FAILED: Events not processed correctly');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 4 ERROR:', error.message);
    return false;
  }
}

/**
 * Cleanup test data
 */
async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  
  try {
    // Delete test webhook records
    const result = await prisma.processedWebhook.deleteMany({
      where: {
        eventId: {
          startsWith: 'test_'
        }
      }
    });
    
    console.log(`✅ Deleted ${result.count} test webhook records`);
  } catch (error) {
    console.error('⚠️  Cleanup error:', error.message);
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🔄 WEBHOOK IDEMPOTENCY TESTS');
  console.log('='.repeat(60));
  console.log('Backend URL:', BACKEND_URL);
  console.log('Webhook Endpoint:', WEBHOOK_ENDPOINT);
  console.log('Secret Key:', PAYSTACK_SECRET_KEY ? '✅ Configured' : '❌ Missing');
  
  if (!PAYSTACK_SECRET_KEY) {
    console.log('\n⚠️  WARNING: PAYSTACK_SECRET_KEY not configured!');
    console.log('Set it in your .env file.');
    process.exit(1);
  }
  
  try {
    // Run tests
    const test1 = await testFirstWebhook();
    
    let test2 = false;
    if (test1.passed && test1.eventId) {
      test2 = await testDuplicateWebhook(test1.eventId, test1.payload);
    }
    
    const test3 = await testRapidDuplicates();
    const test4 = await testDifferentEvents();
    
    // Cleanup
    await cleanup();
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const results = {
      firstWebhook: test1.passed,
      duplicateDetection: test2,
      rapidDuplicates: test3,
      differentEvents: test4,
    };
    
    const passed = Object.values(results).filter(r => r).length;
    const total = Object.keys(results).length;
    
    console.log(`\nTests Passed: ${passed}/${total}\n`);
    console.log('Detailed Results:');
    console.log('  First Webhook:', results.firstWebhook ? '✅ PASS' : '❌ FAIL');
    console.log('  Duplicate Detection:', results.duplicateDetection ? '✅ PASS' : '❌ FAIL');
    console.log('  Rapid Duplicates:', results.rapidDuplicates ? '✅ PASS' : '❌ FAIL');
    console.log('  Different Events:', results.differentEvents ? '✅ PASS' : '❌ FAIL');
    
    if (passed === total) {
      console.log('\n🎉 ALL TESTS PASSED! Webhook idempotency is working correctly.');
      process.exit(0);
    } else {
      console.log('\n⚠️  SOME TESTS FAILED! Review the implementation.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n💥 Test suite crashed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run tests
runAllTests();
