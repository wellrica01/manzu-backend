/**
 * STOCK RESERVATION TIMEOUT TEST
 * 
 * Tests that stock is automatically released when orders timeout
 * 
 * USAGE:
 * node tests/stock-reservation-timeout-test.js
 */

const { PrismaClient } = require('@prisma/client');
const { cleanupPendingPaymentOrders } = require('../src/jobs/cron');

const prisma = new PrismaClient();

// Test configuration
const TEST_CONFIG = {
  medicationId: null,
  pharmacyId: null,
  userId: 'test_stock_timeout_user',
  initialStock: 10,
};

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
    
    // Clean up any existing test orders
    const existingOrders = await prisma.order.findMany({
      where: { userIdentifier: TEST_CONFIG.userId },
      select: { id: true }
    });
    
    if (existingOrders.length > 0) {
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: existingOrders.map(o => o.id) } }
      });
      
      await prisma.order.deleteMany({
        where: { userIdentifier: TEST_CONFIG.userId }
      });
      
      console.log(`✅ Cleaned up ${existingOrders.length} existing test orders`);
    }
    
    console.log('✅ Test data setup complete\n');
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    throw error;
  }
}

/**
 * Test 1: Stock decremented on checkout
 */
async function testStockDecrement() {
  console.log('🧪 TEST 1: Stock Decremented on Checkout');
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
    
    // Create a PENDING order (simulating checkout)
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
        paymentReference: `test_ref_${Date.now()}`,
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
    
    const afterStock = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      select: { stock: true }
    });
    
    console.log(`📦 Stock after checkout: ${afterStock.stock}`);
    
    if (afterStock.stock === initialStock.stock - 3) {
      console.log('✅ TEST 1 PASSED: Stock decremented correctly\n');
      return { passed: true, orderId: order.id };
    } else {
      console.log('❌ TEST 1 FAILED: Stock not decremented correctly\n');
      return { passed: false };
    }
    
  } catch (error) {
    console.error('❌ TEST 1 ERROR:', error.message);
    return { passed: false };
  }
}

/**
 * Test 2: Timeout detection for old orders
 */
async function testTimeoutDetection() {
  console.log('🧪 TEST 2: Timeout Detection');
  console.log('=' .repeat(60));
  
  try {
    // Create an old PENDING order (25 hours ago - past 24 hour timeout)
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    
    const oldOrder = await prisma.order.create({
      data: {
        userIdentifier: TEST_CONFIG.userId,
        pharmacyId: TEST_CONFIG.pharmacyId,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        totalPrice: 2000,
        deliveryMethod: 'PICKUP',
        name: 'Test User',
        email: 'test@example.com',
        phone: '+2348012345678',
        paymentReference: `test_ref_old_${Date.now()}`,
        createdAt: twentyFiveHoursAgo,
        updatedAt: twentyFiveHoursAgo,
      }
    });
    
    await prisma.$transaction(async (tx) => {
      await tx.orderItem.create({
        data: {
          orderId: oldOrder.id,
          pharmacyId: TEST_CONFIG.pharmacyId,
          medicationId: TEST_CONFIG.medicationId,
          quantity: 2,
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
        data: { stock: { decrement: 2 } }
      });
    });
    
    console.log(`📅 Created old order: ${oldOrder.id}`);
    console.log(`   Created at: ${twentyFiveHoursAgo.toISOString()}`);
    console.log(`   Age: 25 hours (timeout: 24 hours)`);
    
    // Check if order is detected as timed out
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const timedOutOrders = await prisma.order.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lte: twentyFourHoursAgo }
      }
    });
    
    const isDetected = timedOutOrders.some(o => o.id === oldOrder.id);
    
    if (isDetected) {
      console.log('✅ TEST 2 PASSED: Old order detected as timed out\n');
      return { passed: true, orderId: oldOrder.id };
    } else {
      console.log('❌ TEST 2 FAILED: Old order not detected\n');
      return { passed: false };
    }
    
  } catch (error) {
    console.error('❌ TEST 2 ERROR:', error.message);
    return { passed: false };
  }
}

/**
 * Test 3: Stock restored on timeout
 */
async function testStockRestoration() {
  console.log('🧪 TEST 3: Stock Restored on Timeout');
  console.log('=' .repeat(60));
  
  try {
    const stockBefore = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      select: { stock: true }
    });
    
    console.log(`📦 Stock before cleanup: ${stockBefore.stock}`);
    
    // Run cleanup job
    console.log('🔄 Running cleanup job...');
    await cleanupPendingPaymentOrders();
    
    const stockAfter = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId
        }
      },
      select: { stock: true }
    });
    
    console.log(`📦 Stock after cleanup: ${stockAfter.stock}`);
    
    // Check cancelled orders
    const cancelledOrders = await prisma.order.findMany({
      where: {
        userIdentifier: TEST_CONFIG.userId,
        status: 'CANCELLED'
      },
      include: { OrderItem: true }
    });
    
    console.log(`📋 Cancelled orders: ${cancelledOrders.length}`);
    
    // Calculate expected stock (initial - active orders)
    const activeOrders = await prisma.order.findMany({
      where: {
        userIdentifier: TEST_CONFIG.userId,
        status: 'PENDING'
      },
      include: { OrderItem: true }
    });
    
    const reservedStock = activeOrders.reduce((sum, order) => {
      return sum + order.OrderItem.reduce((itemSum, item) => itemSum + item.quantity, 0);
    }, 0);
    
    const expectedStock = TEST_CONFIG.initialStock - reservedStock;
    
    console.log(`📊 Verification:`);
    console.log(`   Initial stock: ${TEST_CONFIG.initialStock}`);
    console.log(`   Reserved (active orders): ${reservedStock}`);
    console.log(`   Expected stock: ${expectedStock}`);
    console.log(`   Actual stock: ${stockAfter.stock}`);
    
    if (stockAfter.stock === expectedStock && cancelledOrders.length > 0) {
      console.log('✅ TEST 3 PASSED: Stock restored correctly\n');
      return true;
    } else {
      console.log('❌ TEST 3 FAILED: Stock not restored correctly\n');
      return false;
    }
    
  } catch (error) {
    console.error('❌ TEST 3 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 4: Recent orders not affected
 */
async function testRecentOrdersNotAffected() {
  console.log('🧪 TEST 4: Recent Orders Not Affected');
  console.log('=' .repeat(60));
  
  try {
    // Create a recent order (1 hour ago - within 24 hour window)
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
    
    const recentOrder = await prisma.order.create({
      data: {
        userIdentifier: TEST_CONFIG.userId,
        pharmacyId: TEST_CONFIG.pharmacyId,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        totalPrice: 1000,
        deliveryMethod: 'PICKUP',
        name: 'Test User',
        email: 'test@example.com',
        phone: '+2348012345678',
        paymentReference: `test_ref_recent_${Date.now()}`,
        createdAt: oneHourAgo,
        updatedAt: oneHourAgo,
      }
    });
    
    await prisma.orderItem.create({
      data: {
        orderId: recentOrder.id,
        pharmacyId: TEST_CONFIG.pharmacyId,
        medicationId: TEST_CONFIG.medicationId,
        quantity: 1,
        price: 1000,
      }
    });
    
    console.log(`📅 Created recent order: ${recentOrder.id}`);
    console.log(`   Created at: ${oneHourAgo.toISOString()}`);
    console.log(`   Age: 1 hour (timeout: 24 hours)`);
    
    // Run cleanup
    await cleanupPendingPaymentOrders();
    
    // Check if order still exists and is PENDING
    const orderAfterCleanup = await prisma.order.findUnique({
      where: { id: recentOrder.id }
    });
    
    if (orderAfterCleanup && orderAfterCleanup.status === 'PENDING') {
      console.log('✅ TEST 4 PASSED: Recent order not cancelled\n');
      return true;
    } else {
      console.log('❌ TEST 4 FAILED: Recent order was cancelled\n');
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
  console.log('🧹 Cleaning up test data...');
  
  try {
    const orders = await prisma.order.findMany({
      where: { userIdentifier: TEST_CONFIG.userId },
      select: { id: true }
    });
    
    if (orders.length > 0) {
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: orders.map(o => o.id) } }
      });
      
      await prisma.order.deleteMany({
        where: { userIdentifier: TEST_CONFIG.userId }
      });
      
      console.log(`✅ Removed ${orders.length} test orders`);
    }
    
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
    
  } catch (error) {
    console.error('⚠️  Cleanup error:', error.message);
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('⏱️  STOCK RESERVATION TIMEOUT TESTS');
  console.log('='.repeat(60));
  
  try {
    await setupTestData();
    
    const test1 = await testStockDecrement();
    const test2 = await testTimeoutDetection();
    const test3 = await testStockRestoration();
    const test4 = await testRecentOrdersNotAffected();
    
    await cleanup();
    
    // Summary
    console.log('='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const results = {
      stockDecrement: test1.passed,
      timeoutDetection: test2.passed,
      stockRestoration: test3,
      recentOrdersNotAffected: test4,
    };
    
    const passed = Object.values(results).filter(r => r).length;
    const total = Object.keys(results).length;
    
    console.log(`\nTests Passed: ${passed}/${total}\n`);
    console.log('Detailed Results:');
    console.log('  Stock Decrement:', results.stockDecrement ? '✅ PASS' : '❌ FAIL');
    console.log('  Timeout Detection:', results.timeoutDetection ? '✅ PASS' : '❌ FAIL');
    console.log('  Stock Restoration:', results.stockRestoration ? '✅ PASS' : '❌ FAIL');
    console.log('  Recent Orders Protected:', results.recentOrdersNotAffected ? '✅ PASS' : '❌ FAIL');
    
    if (passed === total) {
      console.log('\n🎉 ALL TESTS PASSED! Stock reservation timeout is working correctly.');
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
