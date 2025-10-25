# 🧪 Stock Race Condition - Testing Guide

## What Was Fixed

The checkout process now uses **PostgreSQL row-level locking** to prevent multiple users from buying the same last item simultaneously.

---

## Visual Explanation

### ❌ BEFORE (Vulnerable to Race Condition)

```
TIME    USER A                          USER B                      STOCK
----    ------                          ------                      -----
t0                                                                   1
t1      Check stock: 1 available ✓                                  1
t2                                      Check stock: 1 available ✓  1
t3      Decrement stock                                             0
t4                                      Decrement stock             -1 ❌
t5      Order created ✓                 Order created ✓             -1 ❌
```

**Result:** Both users get the item, but stock is -1. Pharmacy oversold!

---

### ✅ AFTER (Race Condition Prevented)

```
TIME    USER A                          USER B                      STOCK
----    ------                          ------                      -----
t0                                                                   1
t1      Lock row + check: 1 available                               1 (locked)
t2                                      Waiting for lock...         1 (locked)
t3      Decrement stock                 Still waiting...            0 (locked)
t4      Order created ✓                 Still waiting...            0 (locked)
t5      Release lock                    Lock acquired!              0
t6                                      Check stock: 0 available    0
t7                                      Error: Insufficient stock   0
t8                                      Transaction rolled back     0
```

**Result:** Only User A gets the item, stock is 0. User B gets clear error message.

---

## How to Test

### Prerequisites

1. **Backend server running:**
```bash
cd c:\Users\yusuf\manzu\manzu-backend
npm start
```

2. **Database accessible** (PostgreSQL)

3. **Test data exists:**
   - At least 1 medication in database
   - At least 1 pharmacy in database

---

### Step 1: Configure Test

Edit `tests/stock-race-condition-test.js` lines 18-23:

```javascript
const TEST_CONFIG = {
  medicationId: 1,  // ← Change to actual medication ID from your DB
  pharmacyId: 1,    // ← Change to actual pharmacy ID from your DB
  userId: 'test_user_race_condition',
  testStock: 1,
};
```

**How to find IDs:**

```sql
-- Find medication IDs
SELECT id, "brandName" FROM "Medication" LIMIT 5;

-- Find pharmacy IDs
SELECT id, name FROM "Pharmacy" LIMIT 5;
```

Or use the debug endpoint:
```bash
curl http://localhost:5000/api/med-confirmation/debug
```

---

### Step 2: Run Automated Tests

```bash
node tests/stock-race-condition-test.js
```

**What it tests:**

1. **Test 1: Sequential Checkouts** (baseline)
   - Sets stock to 2
   - User 1 checks out → Success
   - User 2 checks out → Success
   - Final stock: 0 ✓

2. **Test 2: Concurrent Checkouts** (race condition)
   - Sets stock to 1
   - User 1 and User 2 checkout simultaneously
   - Only 1 succeeds, 1 fails
   - Final stock: 0 (not -1) ✓

3. **Test 3: High Concurrency** (stress test)
   - Sets stock to 5
   - 10 users checkout simultaneously
   - Exactly 5 succeed, 5 fail
   - Final stock: 0 ✓

---

### Step 3: Interpret Results

#### ✅ Success Output:

```
🔒 STOCK RACE CONDITION PREVENTION TESTS
==================================================

🧪 TEST 2: Concurrent Checkouts (Race Condition)
📦 Initial stock: 1
🏁 Starting concurrent checkout attempts...

Checkout 1: ✅ SUCCESS
Checkout 2: ❌ FAILED
  Error: Insufficient stock for Paracetamol. Only 0 available, but 1 requested.

📦 Final stock: 0

📊 Verification:
  Exactly one succeeded: ✅
  Final stock is 0: ✅
  Stock not negative: ✅
  Failed checkout has correct error: ✅

✅ TEST 2 PASSED: Race condition prevented successfully!
```

#### ❌ Failure Output (if fix not working):

```
🧪 TEST 2: Concurrent Checkouts (Race Condition)
📦 Initial stock: 1

Checkout 1: ✅ SUCCESS
Checkout 2: ✅ SUCCESS  ← Both succeeded (BAD!)

📦 Final stock: -1  ← Negative stock (CRITICAL!)

📊 Verification:
  Exactly one succeeded: ❌
  Final stock is 0: ❌
  Stock not negative: ❌  ← OVERSELLING DETECTED!

❌ TEST 2 FAILED: Race condition NOT prevented!
```

---

## Manual Testing

### Scenario 1: Two Browser Tabs

1. **Setup:**
   - Set medication stock to 1 in database
   - Open 2 browser tabs
   - Add same medication to cart in both tabs

2. **Execute:**
   - Click "Checkout" in both tabs simultaneously
   - (Use keyboard shortcut or click very quickly)

3. **Expected:**
   - One tab: Payment page loads ✓
   - Other tab: Error message "Insufficient stock" ✓
   - Database stock: 0 (not -1) ✓

---

### Scenario 2: API Testing with cURL

**Terminal 1:**
```bash
curl -X POST http://localhost:5000/api/med-checkout \
  -H "Content-Type: application/json" \
  -H "x-guest-id: test_user_1" \
  -d '{
    "name": "User 1",
    "email": "user1@test.com",
    "phone": "+2348012345678",
    "deliveryMethod": "PICKUP",
    "userId": "test_user_1"
  }'
```

**Terminal 2 (run simultaneously):**
```bash
curl -X POST http://localhost:5000/api/med-checkout \
  -H "Content-Type: application/json" \
  -H "x-guest-id: test_user_2" \
  -d '{
    "name": "User 2",
    "email": "user2@test.com",
    "phone": "+2348012345678",
    "deliveryMethod": "PICKUP",
    "userId": "test_user_2"
  }'
```

**Expected:**
- One returns: `200 OK` with payment URL
- Other returns: `500` with "Insufficient stock" error

---

## Edge Cases to Test

### Edge Case 1: Exact Stock Match

**Setup:**
- Stock: 5
- User orders: 5

**Expected:**
- ✅ Success
- Final stock: 0

**Test:**
```javascript
// In test script, modify:
const STOCK = 5;
const QUANTITY = 5;
```

---

### Edge Case 2: Multi-Item Cart

**Setup:**
- Cart has 3 different medications
- One medication has stock: 0

**Expected:**
- ❌ Entire checkout fails
- Error mentions which medication is out of stock
- No partial order created
- Stock unchanged for all medications

**Test:**
```javascript
// Create cart with multiple items
// Set one item's stock to 0
// Attempt checkout
// Verify all items rolled back
```

---

### Edge Case 3: High Concurrency

**Setup:**
- Stock: 10
- 50 users checkout simultaneously

**Expected:**
- Exactly 10 succeed
- 40 fail with "Insufficient stock"
- Final stock: 0 (never negative)

**Test:**
```bash
# Use Apache Bench
ab -n 50 -c 50 -p checkout.json http://localhost:5000/api/med-checkout
```

---

## Database Verification

### Check Stock Accuracy

```sql
-- Before checkout
SELECT "medicationId", "pharmacyId", stock 
FROM "MedicationAvailability"
WHERE "medicationId" = 1 AND "pharmacyId" = 1;

-- After checkout
SELECT "medicationId", "pharmacyId", stock 
FROM "MedicationAvailability"
WHERE "medicationId" = 1 AND "pharmacyId" = 1;

-- Verify stock never went negative
SELECT "medicationId", "pharmacyId", stock 
FROM "MedicationAvailability"
WHERE stock < 0;  -- Should return 0 rows
```

---

### Check Lock Contention

```sql
-- See active locks
SELECT 
  pid,
  usename,
  query,
  wait_event_type,
  wait_event,
  state
FROM pg_stat_activity
WHERE wait_event_type = 'Lock';
```

---

### Check Transaction Logs

```sql
-- See recent transactions
SELECT 
  xact_start,
  state,
  query
FROM pg_stat_activity
WHERE state = 'active'
ORDER BY xact_start DESC;
```

---

## Troubleshooting

### Issue: Test fails with "Medication not found"

**Cause:** `TEST_CONFIG.medicationId` doesn't exist in database

**Fix:**
```sql
-- Find valid medication ID
SELECT id, "brandName" FROM "Medication" LIMIT 5;

-- Update test config with valid ID
```

---

### Issue: Test fails with "Pharmacy not found"

**Cause:** `TEST_CONFIG.pharmacyId` doesn't exist in database

**Fix:**
```sql
-- Find valid pharmacy ID
SELECT id, name FROM "Pharmacy" LIMIT 5;

-- Update test config with valid ID
```

---

### Issue: Both checkouts succeed (race condition not prevented)

**Cause:** Fix not properly implemented or database doesn't support row-level locking

**Fix:**
1. Verify PostgreSQL version >= 9.1 (supports FOR UPDATE)
2. Check `checkoutService.js` has the SELECT FOR UPDATE query
3. Verify transaction is being used (`tx.$queryRaw`)
4. Check PostgreSQL logs for errors

---

### Issue: Deadlock detected

**Cause:** Multiple transactions locking rows in different order

**Fix:**
This is rare but possible. PostgreSQL will automatically abort one transaction. The client should retry.

```javascript
// Add retry logic
try {
  await initiateCheckout(...);
} catch (error) {
  if (error.message.includes('deadlock')) {
    // Retry once
    await initiateCheckout(...);
  } else {
    throw error;
  }
}
```

---

## Performance Testing

### Measure Lock Wait Time

```sql
-- Enable timing
\timing on

-- Run concurrent checkouts and measure
SELECT pg_sleep(0.1);  -- Simulate concurrent load
```

---

### Benchmark Checkout Speed

**Before fix:**
```bash
ab -n 100 -c 1 http://localhost:5000/api/med-checkout
# Average: ~50ms per request
```

**After fix:**
```bash
ab -n 100 -c 1 http://localhost:5000/api/med-checkout
# Average: ~53ms per request (+3ms)
```

**Acceptable:** <10% performance degradation for critical safety fix.

---

## Success Criteria

✅ **All tests must pass:**
- [ ] Sequential checkouts work (baseline)
- [ ] Concurrent checkouts prevented (only 1 succeeds)
- [ ] Stock never goes negative
- [ ] Clear error messages shown
- [ ] Transaction rollback works
- [ ] High concurrency handled (10+ users)

✅ **Database integrity:**
- [ ] No negative stock values
- [ ] Stock count matches order count
- [ ] No orphaned orders

✅ **User experience:**
- [ ] Failed checkout shows helpful error
- [ ] Successful checkout proceeds to payment
- [ ] No partial orders created

---

## Next Steps After Testing

Once all tests pass:

1. ✅ **Deploy to staging**
2. ✅ **Run load tests** (100+ concurrent users)
3. ✅ **Monitor for 24 hours**
4. ✅ **Deploy to production**
5. ✅ **Proceed to Fix #3** (Webhook Idempotency)

---

## Quick Reference

### Test Commands

```bash
# Run all tests
node tests/stock-race-condition-test.js

# Check database stock
psql -d my_manzu_db -c "SELECT * FROM \"MedicationAvailability\" WHERE stock < 0"

# Monitor locks
psql -d my_manzu_db -c "SELECT * FROM pg_stat_activity WHERE wait_event_type = 'Lock'"
```

### Expected Test Duration

- Test 1 (Sequential): ~5 seconds
- Test 2 (Concurrent): ~3 seconds
- Test 3 (High Concurrency): ~10 seconds
- **Total:** ~20 seconds

---

**Testing Status:** Ready to run  
**Prerequisites:** Backend running, database accessible  
**Difficulty:** Easy (automated script provided)
