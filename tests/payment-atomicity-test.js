/**
 * PAYMENT VERIFICATION ATOMICITY TEST
 * 
 * Tests that payment verification and database updates happen atomically
 * 
 * USAGE:
 * node tests/payment-atomicity-test.js
 */

const { PrismaClient } = require('@prisma/client');
const { confirmOrder } = require('../src/services/confirmationService');
const axios = require('axios');

const prisma = new PrismaClient();

// Test configuration
const TEST_CONFIG = {
  medicationId: null,
  pharmacyId: null,
  userId: 'test_atomicity_user',
  initialStock: 50,
};

/**
 * Setup test data
 */
async function setupTestData() {
  console.log('\n📋 Setting up test data...');
  console.log('=' .repeat(60));
  
  try {
    // Find test medication
    const medication = await prisma.medication.findFirst({
      where: { prescriptionRequired: false },
      select: { id: true, brandName: true }
    });
    
    if (!medication) {
      throw new Error('No OTC medication found for testing');
    }
    
    TEST_CONFIG.medicationId = medication.id;
    console.log('✅ Found medication:', medication.brandName);
    
    // Find test pharmacy
    const pharmacy = await prisma.pharmacy.findFirst({
      select: { id: true, name: true }
    });
    
    if (!pharmacy) {
      throw new Error('No pharmacy found for testing');
    }
    
    TEST_CONFIG.pharmacyId = pharmacy.id;
    console.log('✅ Found pharmacy:', pharmacy.name);
    
    // Set initial stock
    await prisma.medicationAvailability.upsert({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      update: { stock: TEST_CONFIG.initialStock },
      create: {
        medicationId: TEST_CONFIG.medicationId,
        pharmacyId: TEST_CONFIG.pharmacyId,
        stock: TEST_CONFIG.initialStock,
        price: 1000
      }
    });
    
    console.log(`✅ Set initial stock to ${TEST_CONFIG.initialStock}`);
    
    // Clean up existing test data
    await cleanup();
    
    console.log('✅ Test data setup complete\n');
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    throw error;
  }
}

/**
 * Create test order with transaction reference
 */
async function createTestOrderWithPayment(sessionId) {
  const paymentReference = `test_payment_${Date.now()}`;
  const transactionReference = `test_txn_${Date.now()}`;
  
  // Create order
  const order = await prisma.order.create({
    data: {
      userIdentifier: TEST_CONFIG.userId,
      pharmacyId: TEST_CONFIG.pharmacyId,
      status: 'PENDING',
      paymentStatus: 'PENDING',
      totalPrice: 5000,
      deliveryMethod: 'PICKUP',
      name: 'Test User',
      email: 'test@example.com',
      phone: '+2348012345678',
      paymentReference: paymentReference,
      checkoutSessionId: sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  });
  
  // Add order item and decrement stock
  await prisma.$transaction(async (tx) => {
    await tx.orderItem.create({
      data: {
        orderId: order.id,
        pharmacyId: TEST_CONFIG.pharmacyId,
        medicationId: TEST_CONFIG.medicationId,
        quantity: 5,
        price: 1000,
      }
    });
    
    await tx.medicationAvailability.update({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      data: { stock: { decrement: 5 } }
    });
  });
  
  // Create transaction reference
  await prisma.transactionReference.create({
    data: {
      transactionReference: transactionReference,
      orderReferences: [paymentReference],
      checkoutSessionId: sessionId
    }
  });
  
  return { order, paymentReference, transactionReference, sessionId };
}

/**
 * Test 1: Happy path - Payment verified and DB updated atomically
 */
async function testHappyPath() {
  console.log('🧪 TEST 1: Happy Path - Atomic Success');
  console.log('=' .repeat(60));
  
  try {
    const sessionId = `test_session_${Date.now()}`;
    const { order, transactionReference } = await createTestOrderWithPayment(sessionId);
    
    console.log(`✅ Created order ${order.id}`);
    console.log(`📝 Transaction reference: ${transactionReference}`);
    
    // Mock successful Paystack response
    const originalAxiosGet = axios.get;
    axios.get = async (url, config) => {
      if (url.includes('paystack.co/transaction/verify')) {
        console.log('✅ Mocked Paystack verification (success)');
        return {
          data: {
            status: true,
            data: {
              status: 'success',
              amount: 500000,
              reference: transactionReference
            }
          }
        };
      }
      return originalAxiosGet(url, config);
    };
    
    // Verify payment
    console.log('🔄 Calling confirmOrder...');
    const result = await confirmOrder({
      reference: transactionReference,
      session: sessionId,
      userId: TEST_CONFIG.userId
    });
    
    // Restore axios
    axios.get = originalAxiosGet;
    
    console.log(`✅ confirmOrder returned: ${result.status}`);
    
    // Verify order updated
    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id }
    });
    
    console.log(`📋 Order status: ${updatedOrder.status}`);
    console.log(`💳 Payment status: ${updatedOrder.paymentStatus}`);
    
    // Verify idempotency record created
    const verification = await prisma.processedWebhook.findUnique({
      where: { eventId: `verification_${transactionReference}` }
    });
    
    console.log(`🔐 Idempotency record: ${verification ? 'Created' : 'Missing'}`);
    
    const success = updatedOrder.status === 'CONFIRMED' && 
                    updatedOrder.paymentStatus === 'PAID' &&
                    verification !== null;
    
    if (success) {
      console.log('\n✅ TEST 1 PASSED: Payment verified and DB updated atomically\n');
      return true;
    } else {
      console.log('\n❌ TEST 1 FAILED: Atomic operation incomplete\n');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 1 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 2: Paystack timeout - Entire transaction rolled back
 */
async function testPaystackTimeout() {
  console.log('🧪 TEST 2: Paystack Timeout - Transaction Rollback');
  console.log('=' .repeat(60));
  
  try {
    const sessionId = `test_session_timeout_${Date.now()}`;
    const { order, transactionReference } = await createTestOrderWithPayment(sessionId);
    
    console.log(`✅ Created order ${order.id}`);
    
    // Mock Paystack timeout
    const originalAxiosGet = axios.get;
    axios.get = async (url, config) => {
      if (url.includes('paystack.co/transaction/verify')) {
        console.log('⏱️  Simulating Paystack timeout...');
        throw new Error('ETIMEDOUT');
      }
      return originalAxiosGet(url, config);
    };
    
    // Try to verify payment (should fail)
    console.log('🔄 Calling confirmOrder (expecting failure)...');
    let errorCaught = false;
    try {
      await confirmOrder({
        reference: transactionReference,
        session: sessionId,
        userId: TEST_CONFIG.userId
      });
    } catch (error) {
      errorCaught = true;
      console.log(`✅ Error caught: ${error.message}`);
    }
    
    // Restore axios
    axios.get = originalAxiosGet;
    
    // Verify order NOT updated (rollback)
    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id }
    });
    
    console.log(`📋 Order status: ${updatedOrder.status}`);
    console.log(`💳 Payment status: ${updatedOrder.paymentStatus}`);
    
    // Verify no idempotency record (rollback)
    const verification = await prisma.processedWebhook.findUnique({
      where: { eventId: `verification_${transactionReference}` }
    });
    
    console.log(`🔐 Idempotency record: ${verification ? 'Created (BAD!)' : 'Not created (GOOD!)'}`);
    
    const success = errorCaught &&
                    updatedOrder.status === 'PENDING' &&
                    verification === null;
    
    if (success) {
      console.log('\n✅ TEST 2 PASSED: Transaction rolled back on Paystack timeout\n');
      return true;
    } else {
      console.log('\n❌ TEST 2 FAILED: Transaction not properly rolled back\n');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 2 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 3: Idempotency - Duplicate verification attempts
 */
async function testIdempotency() {
  console.log('🧪 TEST 3: Idempotency - Duplicate Verification');
  console.log('=' .repeat(60));
  
  try {
    const sessionId = `test_session_idem_${Date.now()}`;
    const { order, transactionReference } = await createTestOrderWithPayment(sessionId);
    
    console.log(`✅ Created order ${order.id}`);
    
    // Mock successful Paystack response
    const originalAxiosGet = axios.get;
    axios.get = async (url, config) => {
      if (url.includes('paystack.co/transaction/verify')) {
        console.log('✅ Mocked Paystack verification (success)');
        return {
          data: {
            status: true,
            data: {
              status: 'success',
              amount: 500000,
              reference: transactionReference
            }
          }
        };
      }
      return originalAxiosGet(url, config);
    };
    
    // First verification
    console.log('🔄 First verification attempt...');
    await confirmOrder({
      reference: transactionReference,
      session: sessionId,
      userId: TEST_CONFIG.userId
    });
    console.log('✅ First verification succeeded');
    
    // Second verification (should fail with idempotency)
    console.log('🔄 Second verification attempt (duplicate)...');
    let duplicateBlocked = false;
    try {
      await confirmOrder({
        reference: transactionReference,
        session: sessionId,
        userId: TEST_CONFIG.userId
      });
    } catch (error) {
      if (error.message.includes('already processed')) {
        duplicateBlocked = true;
        console.log('✅ Duplicate blocked:', error.message);
      }
    }
    
    // Restore axios
    axios.get = originalAxiosGet;
    
    // Verify order updated only once
    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id }
    });
    
    console.log(`📋 Order status: ${updatedOrder.status}`);
    console.log(`💳 Payment status: ${updatedOrder.paymentStatus}`);
    
    // Verify only one idempotency record
    const verifications = await prisma.processedWebhook.findMany({
      where: { eventId: `verification_${transactionReference}` }
    });
    
    console.log(`🔐 Idempotency records: ${verifications.length}`);
    
    const success = duplicateBlocked &&
                    updatedOrder.status === 'CONFIRMED' &&
                    verifications.length === 1;
    
    if (success) {
      console.log('\n✅ TEST 3 PASSED: Idempotency working correctly\n');
      return true;
    } else {
      console.log('\n❌ TEST 3 FAILED: Idempotency not working\n');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 3 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 4: Retry logic - Paystack fails then succeeds
 */
async function testRetryLogic() {
  console.log('🧪 TEST 4: Retry Logic - Paystack Fails Then Succeeds');
  console.log('=' .repeat(60));
  
  try {
    const sessionId = `test_session_retry_${Date.now()}`;
    const { order, transactionReference } = await createTestOrderWithPayment(sessionId);
    
    console.log(`✅ Created order ${order.id}`);
    
    // Mock Paystack to fail twice, then succeed
    let attemptCount = 0;
    const originalAxiosGet = axios.get;
    axios.get = async (url, config) => {
      if (url.includes('paystack.co/transaction/verify')) {
        attemptCount++;
        console.log(`📡 Paystack attempt ${attemptCount}`);
        
        if (attemptCount <= 2) {
          throw new Error('Network error');
        }
        
        return {
          data: {
            status: true,
            data: {
              status: 'success',
              amount: 500000,
              reference: transactionReference
            }
          }
        };
      }
      return originalAxiosGet(url, config);
    };
    
    // Verify payment (should succeed on 3rd attempt)
    console.log('🔄 Calling confirmOrder (will retry)...');
    const result = await confirmOrder({
      reference: transactionReference,
      session: sessionId,
      userId: TEST_CONFIG.userId
    });
    
    // Restore axios
    axios.get = originalAxiosGet;
    
    console.log(`✅ Succeeded after ${attemptCount} attempts`);
    
    // Verify order updated
    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id }
    });
    
    console.log(`📋 Order status: ${updatedOrder.status}`);
    console.log(`💳 Payment status: ${updatedOrder.paymentStatus}`);
    
    const success = attemptCount === 3 &&
                    updatedOrder.status === 'CONFIRMED' &&
                    updatedOrder.paymentStatus === 'PAID';
    
    if (success) {
      console.log('\n✅ TEST 4 PASSED: Retry logic working correctly\n');
      return true;
    } else {
      console.log('\n❌ TEST 4 FAILED: Retry logic not working\n');
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
  try {
    // Delete test orders
    const orders = await prisma.order.findMany({
      where: { userIdentifier: TEST_CONFIG.userId },
      select: { id: true, paymentReference: true }
    });
    
    if (orders.length > 0) {
      // Delete order items
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: orders.map(o => o.id) } }
      });
      
      // Delete transaction references
      await prisma.transactionReference.deleteMany({
        where: { 
          orderReferences: { 
            hasSome: orders.map(o => o.paymentReference).filter(Boolean) 
          } 
        }
      });
      
      // Delete orders
      await prisma.order.deleteMany({
        where: { userIdentifier: TEST_CONFIG.userId }
      });
    }
    
    // Delete test verification records
    await prisma.processedWebhook.deleteMany({
      where: {
        eventId: { startsWith: 'verification_test_' }
      }
    });
    
  } catch (error) {
    console.error('⚠️  Cleanup error:', error.message);
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('⚛️  PAYMENT VERIFICATION ATOMICITY TESTS');
  console.log('='.repeat(60));
  
  try {
    await setupTestData();
    
    const test1 = await testHappyPath();
    const test2 = await testPaystackTimeout();
    const test3 = await testIdempotency();
    const test4 = await testRetryLogic();
    
    console.log('🧹 Cleaning up test data...');
    await cleanup();
    
    // Restore initial stock
    await prisma.medicationAvailability.update({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      data: { stock: TEST_CONFIG.initialStock }
    });
    console.log('✅ Cleanup complete\n');
    
    // Summary
    console.log('='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const results = {
      happyPath: test1,
      paystackTimeout: test2,
      idempotency: test3,
      retryLogic: test4,
    };
    
    const passed = Object.values(results).filter(r => r).length;
    const total = Object.keys(results).length;
    
    console.log(`\nTests Passed: ${passed}/${total}\n`);
    console.log('Detailed Results:');
    console.log('  Happy Path (Atomic Success):', results.happyPath ? '✅ PASS' : '❌ FAIL');
    console.log('  Paystack Timeout (Rollback):', results.paystackTimeout ? '✅ PASS' : '❌ FAIL');
    console.log('  Idempotency:', results.idempotency ? '✅ PASS' : '❌ FAIL');
    console.log('  Retry Logic:', results.retryLogic ? '✅ PASS' : '❌ FAIL');
    
    if (passed === total) {
      console.log('\n🎉 ALL TESTS PASSED! Payment verification is atomic and safe.');
      process.exit(0);
    } else {
      console.log('\n⚠️  SOME TESTS FAILED! Review the implementation.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n💥 Test suite crashed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run tests
runAllTests();
