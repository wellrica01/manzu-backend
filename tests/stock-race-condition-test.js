/**
 * STOCK RACE CONDITION TEST
 * 
 * This script tests that the stock deduction logic properly handles concurrent
 * checkout attempts and prevents overselling (negative stock).
 * 
 * TEST SCENARIO:
 * - Set medication stock to 1
 * - Simulate 2 users trying to checkout simultaneously
 * - Expected: Only 1 succeeds, 1 gets "Insufficient stock" error
 * - Final stock should be 0 (not negative)
 * 
 * SETUP REQUIRED:
 * 1. Backend server must be running
 * 2. Database must have test data (medication, pharmacy, user)
 * 3. Set environment variables for test configuration
 * 
 * USAGE:
 * node tests/stock-race-condition-test.js
 */

const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const CHECKOUT_ENDPOINT = `${BACKEND_URL}/api/med-checkout`;

// Test data - adjust these IDs based on your database
const TEST_CONFIG = {
  medicationId: 1, // Change to an actual medication ID in your DB
  pharmacyId: 1,   // Change to an actual pharmacy ID in your DB
  userId: 'test_user_race_condition',
  testStock: 1,    // We'll set stock to 1 to test race condition
};

/**
 * Setup: Create test medication availability with stock = 1
 */
async function setupTestData() {
  console.log('\n📋 Setting up test data...');
  console.log('=' .repeat(60));
  
  try {
    // Check if medication and pharmacy exist
    const medication = await prisma.medication.findUnique({
      where: { id: TEST_CONFIG.medicationId },
      select: { id: true, brandName: true, prescriptionRequired: true }
    });
    
    if (!medication) {
      console.log('❌ Medication not found. Please update TEST_CONFIG.medicationId');
      console.log('Available medications:');
      const meds = await prisma.medication.findMany({ take: 5, select: { id: true, brandName: true } });
      console.table(meds);
      return false;
    }
    
    const pharmacy = await prisma.pharmacy.findUnique({
      where: { id: TEST_CONFIG.pharmacyId },
      select: { id: true, name: true }
    });
    
    if (!pharmacy) {
      console.log('❌ Pharmacy not found. Please update TEST_CONFIG.pharmacyId');
      console.log('Available pharmacies:');
      const pharms = await prisma.pharmacy.findMany({ take: 5, select: { id: true, name: true } });
      console.table(pharms);
      return false;
    }
    
    console.log('✅ Found medication:', medication.brandName);
    console.log('✅ Found pharmacy:', pharmacy.name);
    
    // Create or update medication availability with stock = 1
    await prisma.medicationAvailability.upsert({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId,
        }
      },
      update: {
        stock: TEST_CONFIG.testStock,
        price: 1000, // 10 NGN for testing
      },
      create: {
        medicationId: TEST_CONFIG.medicationId,
        pharmacyId: TEST_CONFIG.pharmacyId,
        stock: TEST_CONFIG.testStock,
        price: 1000,
      }
    });
    
    console.log(`✅ Set stock to ${TEST_CONFIG.testStock} for testing`);
    
    // Clean up any existing test orders (delete OrderItems first due to foreign key)
    const existingOrders = await prisma.order.findMany({
      where: { userIdentifier: TEST_CONFIG.userId },
      select: { id: true }
    });
    
    if (existingOrders.length > 0) {
      // Delete order items first
      await prisma.orderItem.deleteMany({
        where: { 
          orderId: { in: existingOrders.map(o => o.id) }
        }
      });
      
      // Then delete orders
      await prisma.order.deleteMany({
        where: { userIdentifier: TEST_CONFIG.userId }
      });
      
      console.log(`✅ Cleaned up ${existingOrders.length} existing test orders`);
    } else {
      console.log('✅ No existing test orders to clean up');
    }
    
    // Create user consent (required by checkout middleware)
    await prisma.userConsent.upsert({
      where: {
        userIdentifier_consentType: {
          userIdentifier: TEST_CONFIG.userId,
          consentType: 'DATA_SHARING'
        }
      },
      update: {
        granted: true,
        createdAt: new Date()
      },
      create: {
        userIdentifier: TEST_CONFIG.userId,
        consentType: 'DATA_SHARING',
        granted: true,
        createdAt: new Date()
      }
    });
    
    console.log('✅ Created user consent for testing');
    
    return { medication, pharmacy };
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    return false;
  }
}

/**
 * Create a cart order for testing
 * @param {number} userNumber - Unique number to create separate user IDs
 */
async function createCartOrder(medication, pharmacy, userNumber = 1) {
  try {
    const userId = `${TEST_CONFIG.userId}_${userNumber}`;
    
    // Create user consent for this specific user
    await prisma.userConsent.upsert({
      where: {
        userIdentifier_consentType: {
          userIdentifier: userId,
          consentType: 'DATA_SHARING'
        }
      },
      update: {
        granted: true,
        createdAt: new Date()
      },
      create: {
        userIdentifier: userId,
        consentType: 'DATA_SHARING',
        granted: true,
        createdAt: new Date()
      }
    });
    
    // Create a CART order with the test medication
    const order = await prisma.order.create({
      data: {
        userIdentifier: userId,
        pharmacyId: TEST_CONFIG.pharmacyId,
        status: 'CART',
        paymentStatus: 'PENDING',
        totalPrice: 1000,
        deliveryMethod: 'PICKUP',
        name: `Test User ${userNumber}`,
        email: `test${userNumber}@example.com`,
        phone: '+2348012345678',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    });
    
    // Add order item
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        pharmacyId: TEST_CONFIG.pharmacyId,
        medicationId: TEST_CONFIG.medicationId,
        quantity: 1, // Trying to buy 1 unit
        price: 1000,
      }
    });
    
    return { order, userId };
  } catch (error) {
    console.error('Failed to create cart order:', error.message);
    throw error;
  }
}

/**
 * Simulate a checkout attempt
 */
async function attemptCheckout(attemptNumber) {
  const userId = `${TEST_CONFIG.userId}_${attemptNumber}`;
  
  const checkoutData = {
    name: `Test User ${attemptNumber}`,
    email: `test${attemptNumber}@example.com`,
    phone: '+2348012345678',
    address: '123 Test Street',
    deliveryMethod: 'PICKUP',
    userId: userId,
  };
  
  try {
    const response = await axios.post(CHECKOUT_ENDPOINT, checkoutData, {
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': userId,
      },
      timeout: 10000, // 10 second timeout
    });
    
    return {
      success: true,
      attemptNumber,
      userId,
      status: response.status,
      data: response.data,
    };
  } catch (error) {
    return {
      success: false,
      attemptNumber,
      userId,
      status: error.response?.status,
      error: error.response?.data?.message || error.message,
    };
  }
}

/**
 * Test 1: Sequential checkouts (baseline test)
 */
async function testSequentialCheckouts(medication, pharmacy) {
  console.log('\n🧪 TEST 1: Sequential Checkouts (Baseline)');
  console.log('=' .repeat(60));
  console.log('Testing that normal sequential checkouts work correctly\n');
  
  try {
    // Reset stock to 2
    await prisma.medicationAvailability.update({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId,
        }
      },
      data: { stock: 2 }
    });
    
    console.log('📦 Initial stock: 2');
    
    // Create cart order for user 1
    await createCartOrder(medication, pharmacy, 1);
    console.log('✅ Created cart order 1');
    
    // First checkout
    const result1 = await attemptCheckout(1);
    console.log(`Checkout 1: ${result1.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    if (!result1.success) console.log('  Error:', result1.error);
    
    // Check stock after first checkout
    const stockAfter1 = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId,
        }
      },
      select: { stock: true }
    });
    console.log(`📦 Stock after checkout 1: ${stockAfter1.stock}`);
    
    // Create cart order for user 2
    await createCartOrder(medication, pharmacy, 2);
    console.log('✅ Created cart order 2');
    
    // Second checkout
    const result2 = await attemptCheckout(2);
    console.log(`Checkout 2: ${result2.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    if (!result2.success) console.log('  Error:', result2.error);
    
    // Check final stock
    const finalStock = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId,
        }
      },
      select: { stock: true }
    });
    console.log(`📦 Final stock: ${finalStock.stock}`);
    
    // Verify results
    const passed = result1.success && result2.success && finalStock.stock === 0;
    
    if (passed) {
      console.log('\n✅ TEST 1 PASSED: Sequential checkouts work correctly');
    } else {
      console.log('\n❌ TEST 1 FAILED');
    }
    
    return passed;
    
  } catch (error) {
    console.error('❌ TEST 1 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 2: Concurrent checkouts (race condition test)
 */
async function testConcurrentCheckouts(medication, pharmacy) {
  console.log('\n🧪 TEST 2: Concurrent Checkouts (Race Condition)');
  console.log('=' .repeat(60));
  console.log('Testing that only 1 checkout succeeds when 2 users try simultaneously\n');
  
  try {
    // Reset stock to 1
    await prisma.medicationAvailability.update({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId,
        }
      },
      data: { stock: 1 }
    });
    
    console.log('📦 Initial stock: 1');
    
    // Create 2 cart orders (simulating 2 users with items in cart)
    await createCartOrder(medication, pharmacy, 1);
    console.log('✅ Created cart order for User 1');
    
    // Small delay to ensure orders are created separately
    await new Promise(resolve => setTimeout(resolve, 50));
    
    await createCartOrder(medication, pharmacy, 2);
    console.log('✅ Created cart order for User 2');
    
    console.log('\n🏁 Starting concurrent checkout attempts...\n');
    
    // Launch both checkouts simultaneously (with tiny stagger to reduce exact collision)
    const checkout1Promise = attemptCheckout(1);
    await new Promise(resolve => setTimeout(resolve, 10)); // 10ms stagger
    const checkout2Promise = attemptCheckout(2);
    
    const [result1, result2] = await Promise.all([checkout1Promise, checkout2Promise]);
    
    console.log('Checkout 1:', result1.success ? '✅ SUCCESS' : '❌ FAILED');
    if (!result1.success) console.log('  Error:', result1.error);
    
    console.log('Checkout 2:', result2.success ? '✅ SUCCESS' : '❌ FAILED');
    if (!result2.success) console.log('  Error:', result2.error);
    
    // Check final stock
    const finalStock = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId,
        }
      },
      select: { stock: true }
    });
    
    console.log(`\n📦 Final stock: ${finalStock.stock}`);
    
    // Verify results
    const oneSucceeded = (result1.success && !result2.success) || (!result1.success && result2.success);
    const stockIsZero = finalStock.stock === 0;
    const stockNotNegative = finalStock.stock >= 0;
    const failedHasCorrectError = (!result1.success && result1.error?.includes('Insufficient stock')) ||
                                   (!result2.success && result2.error?.includes('Insufficient stock'));
    
    console.log('\n📊 Verification:');
    console.log(`  Exactly one succeeded: ${oneSucceeded ? '✅' : '❌'}`);
    console.log(`  Final stock is 0: ${stockIsZero ? '✅' : '❌'}`);
    console.log(`  Stock not negative: ${stockNotNegative ? '✅' : '❌'}`);
    console.log(`  Failed checkout has correct error: ${failedHasCorrectError ? '✅' : '❌'}`);
    
    const passed = oneSucceeded && stockIsZero && stockNotNegative && failedHasCorrectError;
    
    if (passed) {
      console.log('\n✅ TEST 2 PASSED: Race condition prevented successfully!');
      console.log('   Only one user got the last item, stock did not go negative.');
    } else {
      console.log('\n❌ TEST 2 FAILED: Race condition NOT prevented!');
      if (!oneSucceeded) console.log('   ⚠️  Both checkouts had same result (both succeeded or both failed)');
      if (!stockIsZero) console.log(`   ⚠️  Stock is ${finalStock.stock}, expected 0`);
      if (!stockNotNegative) console.log('   ⚠️  CRITICAL: Stock went negative!');
    }
    
    return passed;
    
  } catch (error) {
    console.error('❌ TEST 2 ERROR:', error.message);
    return false;
  }
}

/**
 * Test 3: High concurrency (stress test)
 */
async function testHighConcurrency(medication, pharmacy) {
  console.log('\n🧪 TEST 3: High Concurrency (Stress Test)');
  console.log('=' .repeat(60));
  console.log('Testing with 10 concurrent users trying to buy 5 items\n');
  
  try {
    const STOCK = 5;
    const USERS = 10;
    
    // Reset stock
    await prisma.medicationAvailability.update({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId,
        }
      },
      data: { stock: STOCK }
    });
    
    console.log(`📦 Initial stock: ${STOCK}`);
    console.log(`👥 Concurrent users: ${USERS}\n`);
    
    // Create cart orders for all users
    for (let i = 1; i <= USERS; i++) {
      await createCartOrder(medication, pharmacy, i);
    }
    console.log(`✅ Created ${USERS} cart orders\n`);
    
    console.log('🏁 Starting concurrent checkout attempts...\n');
    
    // Launch all checkouts simultaneously
    const promises = [];
    for (let i = 1; i <= USERS; i++) {
      promises.push(attemptCheckout(i));
    }
    
    const results = await Promise.all(promises);
    
    // Analyze results
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`✅ Succeeded: ${succeeded}`);
    console.log(`❌ Failed: ${failed}`);
    
    // Check final stock
    const finalStock = await prisma.medicationAvailability.findUnique({
      where: {
        medicationId_pharmacyId: {
          medicationId: TEST_CONFIG.medicationId,
          pharmacyId: TEST_CONFIG.pharmacyId,
        }
      },
      select: { stock: true }
    });
    
    console.log(`\n📦 Final stock: ${finalStock.stock}`);
    
    // Verify results
    const correctSuccessCount = succeeded === STOCK;
    const correctFailCount = failed === (USERS - STOCK);
    const stockIsZero = finalStock.stock === 0;
    const stockNotNegative = finalStock.stock >= 0;
    
    console.log('\n📊 Verification:');
    console.log(`  Correct success count (${STOCK}): ${correctSuccessCount ? '✅' : '❌'}`);
    console.log(`  Correct fail count (${USERS - STOCK}): ${correctFailCount ? '✅' : '❌'}`);
    console.log(`  Final stock is 0: ${stockIsZero ? '✅' : '❌'}`);
    console.log(`  Stock not negative: ${stockNotNegative ? '✅' : '❌'}`);
    
    const passed = correctSuccessCount && correctFailCount && stockIsZero && stockNotNegative;
    
    if (passed) {
      console.log('\n✅ TEST 3 PASSED: High concurrency handled correctly!');
    } else {
      console.log('\n❌ TEST 3 FAILED');
      if (!stockNotNegative) console.log('   ⚠️  CRITICAL: Stock went negative!');
    }
    
    return passed;
    
  } catch (error) {
    console.error('❌ TEST 3 ERROR:', error.message);
    return false;
  }
}

/**
 * Cleanup test data
 */
async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  
  try {
    // Find all test orders (for all test users)
    const testOrders = await prisma.order.findMany({
      where: { 
        userIdentifier: { 
          startsWith: TEST_CONFIG.userId 
        } 
      },
      select: { id: true }
    });
    
    if (testOrders.length > 0) {
      // Delete order items first (foreign key constraint)
      await prisma.orderItem.deleteMany({
        where: { 
          orderId: { in: testOrders.map(o => o.id) }
        }
      });
      
      // Then delete orders
      await prisma.order.deleteMany({
        where: { 
          userIdentifier: { 
            startsWith: TEST_CONFIG.userId 
          } 
        }
      });
      
      console.log(`✅ Removed ${testOrders.length} test orders`);
    }
    
    // Delete all user consents for test users
    await prisma.userConsent.deleteMany({
      where: { 
        userIdentifier: { 
          startsWith: TEST_CONFIG.userId 
        } 
      }
    });
    
    console.log('✅ Cleanup complete');
  } catch (error) {
    console.error('⚠️  Cleanup error:', error.message);
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🔒 STOCK RACE CONDITION PREVENTION TESTS');
  console.log('='.repeat(60));
  console.log('Backend URL:', BACKEND_URL);
  console.log('Checkout Endpoint:', CHECKOUT_ENDPOINT);
  
  try {
    // Setup
    const testData = await setupTestData();
    if (!testData) {
      console.log('\n❌ Setup failed. Please check configuration and try again.');
      process.exit(1);
    }
    
    const { medication, pharmacy } = testData;
    
    // Run tests
    const results = {
      sequential: await testSequentialCheckouts(medication, pharmacy),
      concurrent: await testConcurrentCheckouts(medication, pharmacy),
      highConcurrency: await testHighConcurrency(medication, pharmacy),
    };
    
    // Cleanup
    await cleanup();
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    
    const passed = Object.values(results).filter(r => r).length;
    const total = Object.keys(results).length;
    
    console.log(`\nTests Passed: ${passed}/${total}\n`);
    console.log('Detailed Results:');
    console.log('  Sequential Checkouts:', results.sequential ? '✅ PASS' : '❌ FAIL');
    console.log('  Concurrent Checkouts:', results.concurrent ? '✅ PASS' : '❌ FAIL');
    console.log('  High Concurrency:', results.highConcurrency ? '✅ PASS' : '❌ FAIL');
    
    if (passed === total) {
      console.log('\n🎉 ALL TESTS PASSED! Stock race condition is properly prevented.');
      console.log('   Your checkout system is safe from overselling.');
      process.exit(0);
    } else {
      console.log('\n⚠️  SOME TESTS FAILED! Review the implementation.');
      console.log('   There may still be race condition vulnerabilities.');
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
