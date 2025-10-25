/**
 * PAYMENT FAILURE STOCK RESTORATION TEST
 * 
 * Tests that stock is automatically restored when Paystack payment fails
 * 
 * USAGE:
 * node tests/payment-failure-test.js
 */

const crypto = require('crypto');
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const WEBHOOK_ENDPOINT = `${BACKEND_URL}/api/med-confirmation/webhook`;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// Test configuration
const TEST_CONFIG = {
  medicationId: null,
  pharmacyId: null,
  userId: 'test_payment_failure_user',
  initialStock: 20,
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
 * Setup test data
 */
async function setupTestData() {
  console.log('\n📋 Setting up test data...');
  console.log('=' .repeat(60));
  
  try {
    // Find a test medication
    const medication = await prisma.medication.findFirst({
      where: { prescriptionRequired: false },
      select: { id: true, brandName: true }
    });
    
    if (!medication) {
      throw new Error('No OTC medication found for testing');
    }
    
    TEST_CONFIG.medicationId = medication.id;
    console.log('✅ Found medication:', medication.brandName);
    
    // Find a test pharmacy
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
    
    // Clean up any existing test data
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
async function createTestOrder(quantity = 5) {
  const paymentReference = `test_payment_ref_${Date.now()}`;
  const transactionReference = `test_txn_ref_${Date.now()}`;
  
  // Create order
  const order = await prisma.order.create({
    data: {
      userIdentifier: TEST_CONFIG.userId,
      pharmacyId: TEST_CONFIG.pharmacyId,
      status: 'PENDING',
      paymentStatus: 'PENDING',
      totalPrice: quantity * 1000,
      deliveryMethod: 'PICKUP',
      name: 'Test User',
      email: 'test@example.com',
      phone: '+2348012345678',
      paymentReference: paymentReference,
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
        quantity: quantity,
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
      data: { stock: { decrement: quantity } }
    });
  });
  
  // Create transaction reference
  await prisma.transactionReference.create({
    data: {
      transactionReference: transactionReference,
      orderReferences: [paymentReference],
      checkoutSessionId: `test_session_${Date.now()}`
    }
  });
  
  return { order, paymentReference, transactionReference };
}

/**
 * Test 1: Stock restored on payment failure
 */
async function testStockRestoredOnFailure() {
  console.log('🧪 TEST 1: Stock Restored on Payment Failure');
  console.log('=' .repeat(60));
  
  try {
    // Get initial stock
    const initialStock = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      select: { stock: true }
    });
    
    console.log(`📦 Initial stock: ${initialStock.stock}`);
    
    // Create order (stock will be decremented)
    const { order, transactionReference } = await createTestOrder(5);
    console.log(`✅ Created order ${order.id} (reserved 5 units)`);
    
    const stockAfterOrder = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      select: { stock: true }
    });
    
    console.log(`📦 Stock after order: ${stockAfterOrder.stock}`);
    
    // Send payment failure webhook
    const failureWebhook = {
      event: 'charge.failed',
      data: {
        id: `evt_failed_${Date.now()}`,
        reference: transactionReference,
        amount: 500000,
        status: 'failed',
        gateway_response: 'Insufficient funds',
        customer: {
          email: 'test@example.com'
        }
      }
    };
    
    const signature = generateSignature(failureWebhook, PAYSTACK_SECRET_KEY);
    
    console.log('📤 Sending payment failure webhook...');
    
    const response = await axios.post(WEBHOOK_ENDPOINT, failureWebhook, {
      headers: {
        'x-paystack-signature': signature,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });
    
    console.log(`Response status: ${response.status}`);
    console.log(`Response: ${response.data.message}`);
    
    // Check stock restored
    const finalStock = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      select: { stock: true }
    });
    
    console.log(`📦 Stock after failure webhook: ${finalStock.stock}`);
    
    // Check order status
    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id }
    });
    
    console.log(`📋 Order status: ${updatedOrder.status}`);
    console.log(`💳 Payment status: ${updatedOrder.paymentStatus}`);
    console.log(`❌ Cancel reason: ${updatedOrder.cancelReason}`);
    
    // Verify
    const stockRestored = finalStock.stock === initialStock.stock;
    const orderCancelled = updatedOrder.status === 'CANCELLED';
    const paymentFailed = updatedOrder.paymentStatus === 'FAILED';
    
    if (stockRestored && orderCancelled && paymentFailed) {
      console.log('\n✅ TEST 1 PASSED: Stock restored and order cancelled correctly\n');
      return true;
    } else {
      console.log('\n❌ TEST 1 FAILED:');
      if (!stockRestored) console.log('  - Stock not restored');
      if (!orderCancelled) console.log('  - Order not cancelled');
      if (!paymentFailed) console.log('  - Payment status not FAILED');
      console.log();
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 1 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 2: Multiple orders in same transaction
 */
async function testMultipleOrdersRestored() {
  console.log('🧪 TEST 2: Multiple Orders Stock Restoration');
  console.log('=' .repeat(60));
  
  try {
    const initialStock = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      select: { stock: true }
    });
    
    console.log(`📦 Initial stock: ${initialStock.stock}`);
    
    // Create 2 orders with same transaction reference
    const transactionReference = `test_txn_multi_${Date.now()}`;
    const orderReferences = [];
    
    for (let i = 1; i <= 2; i++) {
      const paymentReference = `test_payment_multi_${Date.now()}_${i}`;
      
      const order = await prisma.order.create({
        data: {
          userIdentifier: TEST_CONFIG.userId,
          pharmacyId: TEST_CONFIG.pharmacyId,
          status: 'PENDING',
          paymentStatus: 'PENDING',
          totalPrice: 3000,
          deliveryMethod: 'PICKUP',
          name: 'Test User',
          email: 'test@example.com',
          phone: '+2348012345678',
          paymentReference: paymentReference,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      });
      
      await prisma.$transaction(async (tx) => {
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            pharmacyId: TEST_CONFIG.pharmacyId,
            medicationId: TEST_CONFIG.medicationId,
            quantity: 3,
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
          data: { stock: { decrement: 3 } }
        });
      });
      
      orderReferences.push(paymentReference);
      console.log(`✅ Created order ${order.id} (reserved 3 units)`);
    }
    
    // Create transaction reference for both orders
    await prisma.transactionReference.create({
      data: {
        transactionReference: transactionReference,
        orderReferences: orderReferences,
        checkoutSessionId: `test_session_multi_${Date.now()}`
      }
    });
    
    const stockAfterOrders = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      select: { stock: true }
    });
    
    console.log(`📦 Stock after 2 orders: ${stockAfterOrders.stock} (reserved 6 total)`);
    
    // Send payment failure webhook
    const failureWebhook = {
      event: 'charge.failed',
      data: {
        id: `evt_failed_multi_${Date.now()}`,
        reference: transactionReference,
        amount: 600000,
        status: 'failed',
        gateway_response: 'Card declined',
        customer: {
          email: 'test@example.com'
        }
      }
    };
    
    const signature = generateSignature(failureWebhook, PAYSTACK_SECRET_KEY);
    
    console.log('📤 Sending payment failure webhook...');
    
    await axios.post(WEBHOOK_ENDPOINT, failureWebhook, {
      headers: {
        'x-paystack-signature': signature,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });
    
    const finalStock = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      select: { stock: true }
    });
    
    console.log(`📦 Stock after failure: ${finalStock.stock}`);
    
    const stockRestored = finalStock.stock === initialStock.stock;
    
    if (stockRestored) {
      console.log('\n✅ TEST 2 PASSED: All orders stock restored correctly\n');
      return true;
    } else {
      console.log('\n❌ TEST 2 FAILED: Stock not fully restored\n');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 2 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 3: Idempotency - duplicate failure webhooks
 */
async function testIdempotency() {
  console.log('🧪 TEST 3: Idempotency - Duplicate Failure Webhooks');
  console.log('=' .repeat(60));
  
  try {
    const initialStock = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      select: { stock: true }
    });
    
    console.log(`📦 Initial stock: ${initialStock.stock}`);
    
    // Create order
    const { transactionReference } = await createTestOrder(4);
    console.log('✅ Created order (reserved 4 units)');
    
    const stockAfterOrder = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      select: { stock: true }
    });
    
    console.log(`📦 Stock after order: ${stockAfterOrder.stock}`);
    
    // Create failure webhook
    const eventId = `evt_idempotent_${Date.now()}`;
    const failureWebhook = {
      event: 'charge.failed',
      data: {
        id: eventId,
        reference: transactionReference,
        amount: 400000,
        status: 'failed',
        gateway_response: 'Transaction timeout',
        customer: {
          email: 'test@example.com'
        }
      }
    };
    
    const signature = generateSignature(failureWebhook, PAYSTACK_SECRET_KEY);
    
    // Send webhook twice
    console.log('📤 Sending first failure webhook...');
    const response1 = await axios.post(WEBHOOK_ENDPOINT, failureWebhook, {
      headers: {
        'x-paystack-signature': signature,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });
    
    console.log(`First response: ${response1.data.message}`);
    
    console.log('📤 Sending duplicate failure webhook...');
    const response2 = await axios.post(WEBHOOK_ENDPOINT, failureWebhook, {
      headers: {
        'x-paystack-signature': signature,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });
    
    console.log(`Second response: ${response2.data.message}`);
    
    const finalStock = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      select: { stock: true }
    });
    
    console.log(`📦 Final stock: ${finalStock.stock}`);
    
    const stockCorrect = finalStock.stock === initialStock.stock;
    const duplicateDetected = response2.data.message === 'Webhook already processed';
    
    if (stockCorrect && duplicateDetected) {
      console.log('\n✅ TEST 3 PASSED: Idempotency working, stock restored only once\n');
      return true;
    } else {
      console.log('\n❌ TEST 3 FAILED:');
      if (!stockCorrect) console.log('  - Stock incorrect (double restoration?)');
      if (!duplicateDetected) console.log('  - Duplicate not detected');
      console.log();
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 3 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 4: Transaction not found (graceful handling)
 */
async function testTransactionNotFound() {
  console.log('🧪 TEST 4: Transaction Not Found (Graceful Handling)');
  console.log('=' .repeat(60));
  
  try {
    const failureWebhook = {
      event: 'charge.failed',
      data: {
        id: `evt_notfound_${Date.now()}`,
        reference: 'nonexistent_transaction_ref',
        amount: 100000,
        status: 'failed',
        gateway_response: 'Declined',
        customer: {
          email: 'test@example.com'
        }
      }
    };
    
    const signature = generateSignature(failureWebhook, PAYSTACK_SECRET_KEY);
    
    console.log('📤 Sending failure webhook for non-existent transaction...');
    
    const response = await axios.post(WEBHOOK_ENDPOINT, failureWebhook, {
      headers: {
        'x-paystack-signature': signature,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });
    
    console.log(`Response status: ${response.status}`);
    console.log(`Response: ${response.data.message}`);
    
    // Should return 404 but webhook should be marked as processed
    const webhookProcessed = await prisma.processedWebhook.findUnique({
      where: { eventId: failureWebhook.data.id }
    });
    
    if (response.status === 404 && webhookProcessed) {
      console.log('\n✅ TEST 4 PASSED: Gracefully handled missing transaction\n');
      return true;
    } else {
      console.log('\n❌ TEST 4 FAILED: Not handled correctly\n');
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
    
    // Delete test webhooks
    await prisma.processedWebhook.deleteMany({
      where: {
        eventId: { startsWith: 'evt_' }
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
  console.log('💳 PAYMENT FAILURE STOCK RESTORATION TESTS');
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
    await setupTestData();
    
    const test1 = await testStockRestoredOnFailure();
    const test2 = await testMultipleOrdersRestored();
    const test3 = await testIdempotency();
    const test4 = await testTransactionNotFound();
    
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
      stockRestored: test1,
      multipleOrders: test2,
      idempotency: test3,
      transactionNotFound: test4,
    };
    
    const passed = Object.values(results).filter(r => r).length;
    const total = Object.keys(results).length;
    
    console.log(`\nTests Passed: ${passed}/${total}\n`);
    console.log('Detailed Results:');
    console.log('  Stock Restored on Failure:', results.stockRestored ? '✅ PASS' : '❌ FAIL');
    console.log('  Multiple Orders Restored:', results.multipleOrders ? '✅ PASS' : '❌ FAIL');
    console.log('  Idempotency:', results.idempotency ? '✅ PASS' : '❌ FAIL');
    console.log('  Transaction Not Found:', results.transactionNotFound ? '✅ PASS' : '❌ FAIL');
    
    if (passed === total) {
      console.log('\n🎉 ALL TESTS PASSED! Payment failure stock restoration is working correctly.');
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
