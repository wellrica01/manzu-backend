# 🧪 Webhook Signature Verification - Testing Guide

## What Was Changed

### Modified File: `src/routes/confirmation.js`

**Line 2:** Added crypto import
```javascript
const crypto = require('crypto');
```

**Lines 108-138:** Added signature verification logic BEFORE webhook processing
- Checks if `PAYSTACK_SECRET_KEY` is configured
- Generates HMAC SHA512 hash of request body
- Compares with `x-paystack-signature` header
- Returns 401 if signature doesn't match
- Logs all invalid signature attempts with timestamp and IP

---

## NPM Packages Required

**Good news:** No new packages needed! 

The `crypto` module is built into Node.js, so you don't need to install anything.

---

## Environment Setup

### 1. Add Paystack Secret Key to `.env`

```bash
PAYSTACK_SECRET_KEY=sk_test_your_actual_key_here
```

**Where to find this:**
1. Log into Paystack Dashboard
2. Go to **Settings** → **API Keys & Webhooks**
3. Copy your **Secret Key** (starts with `sk_test_` for test mode, `sk_live_` for production)

⚠️ **CRITICAL:** Never commit this key to Git! Make sure `.env` is in your `.gitignore`

---

## Testing Methods

### Method 1: Automated Test Script (Recommended)

#### Step 1: Install axios (if not already installed)
```bash
cd c:\Users\yusuf\manzu\manzu-backend
npm install axios
```

#### Step 2: Set environment variable
```powershell
# PowerShell
$env:PAYSTACK_SECRET_KEY="sk_test_your_key_here"
$env:BACKEND_URL="http://localhost:5000"
```

#### Step 3: Run the test script
```bash
node tests/webhook-signature-test.js
```

#### Expected Output:
```
🔒 PAYSTACK WEBHOOK SIGNATURE VERIFICATION TESTS
==================================================
Backend URL: http://localhost:5000
Webhook Endpoint: http://localhost:5000/api/med-confirmation/webhook

🧪 TEST 1: Valid Signature
✅ PASS: Valid signature accepted

🧪 TEST 2: Invalid Signature
✅ PASS: Invalid signature rejected with 401

🧪 TEST 3: Missing Signature
✅ PASS: Missing signature rejected with 401

🧪 TEST 4: Tampered Payload
✅ PASS: Tampered payload rejected with 401

📊 TEST SUMMARY
Tests Passed: 4/4
🎉 ALL TESTS PASSED!
```

---

### Method 2: Manual Testing with cURL

#### Test 1: Valid Signature

```bash
# 1. Generate signature using Node.js
node -e "
const crypto = require('crypto');
const payload = {\"event\":\"charge.success\",\"data\":{\"reference\":\"test123\"}};
const secret = 'YOUR_PAYSTACK_SECRET_KEY';
const signature = crypto.createHmac('sha512', secret).update(JSON.stringify(payload)).digest('hex');
console.log(signature);
"

# 2. Send request with the generated signature
curl -X POST http://localhost:5000/api/med-confirmation/webhook \
  -H "Content-Type: application/json" \
  -H "x-paystack-signature: PASTE_SIGNATURE_HERE" \
  -d '{"event":"charge.success","data":{"reference":"test123"}}'
```

**Expected Response:** `200 OK` with `{"message": "Webhook processed successfully"}`

#### Test 2: Invalid Signature

```bash
curl -X POST http://localhost:5000/api/med-confirmation/webhook \
  -H "Content-Type: application/json" \
  -H "x-paystack-signature: invalid_signature_12345" \
  -d '{"event":"charge.success","data":{"reference":"test123"}}'
```

**Expected Response:** `401 Unauthorized` with `{"message": "Invalid signature"}`

#### Test 3: Missing Signature

```bash
curl -X POST http://localhost:5000/api/med-confirmation/webhook \
  -H "Content-Type: application/json" \
  -d '{"event":"charge.success","data":{"reference":"test123"}}'
```

**Expected Response:** `401 Unauthorized` with `{"message": "Invalid signature"}`

---

### Method 3: Testing with Postman

#### Setup:
1. Create a new POST request to `http://localhost:5000/api/med-confirmation/webhook`
2. Set **Body** to `raw` → `JSON`:
```json
{
  "event": "charge.success",
  "data": {
    "reference": "test_ref_123",
    "amount": 50000,
    "customer": {
      "email": "test@example.com"
    }
  }
}
```

#### Test Valid Signature:
3. Add **Pre-request Script**:
```javascript
const crypto = require('crypto');
const secret = pm.environment.get('PAYSTACK_SECRET_KEY');
const body = JSON.stringify(JSON.parse(pm.request.body.raw));
const signature = crypto.createHmac('sha512', secret).update(body).digest('hex');
pm.request.headers.add({key: 'x-paystack-signature', value: signature});
```

4. Set Postman environment variable: `PAYSTACK_SECRET_KEY = sk_test_your_key`
5. Send request → Should get `200 OK`

#### Test Invalid Signature:
6. In **Headers**, manually set `x-paystack-signature: invalid_signature`
7. Send request → Should get `401 Unauthorized`

---

## Verification Checklist

After implementing, verify these behaviors:

- [ ] **Valid signature accepted:** Webhook processes successfully (200 OK)
- [ ] **Invalid signature rejected:** Returns 401 with "Invalid signature" message
- [ ] **Missing signature rejected:** Returns 401 (signature is undefined)
- [ ] **Tampered payload rejected:** Changing payload after signature generation fails
- [ ] **Logs invalid attempts:** Check console for error logs with timestamp and IP
- [ ] **Logs successful verification:** Check console for success message
- [ ] **Environment check:** Returns 500 if PAYSTACK_SECRET_KEY not configured
- [ ] **Existing functionality intact:** Order processing still works after signature verification

---

## Monitoring in Production

### What to Watch:

1. **Invalid Signature Logs:**
```javascript
// You'll see this in logs if someone tries to fake a webhook
Invalid webhook signature detected: {
  timestamp: '2025-10-24T19:50:00.000Z',
  receivedSignature: 'present',
  ipAddress: '192.168.1.100'
}
```

2. **Success Logs:**
```javascript
Webhook signature verified successfully
Payment successful: { reference: 'xyz123', amount: 50000, customer: {...} }
```

### Security Alerts:

Set up alerts for:
- Multiple invalid signature attempts from same IP (potential attack)
- Webhooks with missing PAYSTACK_SECRET_KEY (configuration issue)
- Sudden spike in 401 responses on webhook endpoint

---

## Troubleshooting

### Issue: All webhooks return 401 even with valid signature

**Cause:** Secret key mismatch between your code and Paystack

**Fix:**
1. Verify `PAYSTACK_SECRET_KEY` in `.env` matches Paystack Dashboard
2. Restart your server after changing `.env`
3. Make sure you're using the correct key (test vs live)

### Issue: "PAYSTACK_SECRET_KEY not configured" error

**Cause:** Environment variable not loaded

**Fix:**
1. Check `.env` file exists in project root
2. Verify you're using `dotenv` package: `require('dotenv').config()`
3. Restart server

### Issue: Signature verification works locally but fails in production

**Cause:** Different secret key or body parsing issue

**Fix:**
1. Verify production environment has correct `PAYSTACK_SECRET_KEY`
2. Ensure `express.json()` middleware is applied BEFORE webhook route
3. Check if any middleware is modifying `req.body`

---

## Next Steps After Testing

Once all tests pass:

1. ✅ **Deploy to staging** and test with Paystack test webhooks
2. ✅ **Configure Paystack webhook URL** in dashboard: `https://yourdomain.com/api/med-confirmation/webhook`
3. ✅ **Monitor logs** for 24 hours to catch any issues
4. ✅ **Test with real Paystack test payments**
5. ✅ **Update production environment** with live secret key
6. ✅ **Proceed to Fix #2** (Stock Race Condition)

---

## Security Notes

✅ **What's now protected:**
- Fake payment webhooks from attackers
- Replay attacks (when combined with idempotency - Fix #3)
- Man-in-the-middle payload tampering

⚠️ **Still needed:**
- Idempotency checks (Fix #3) to prevent duplicate processing
- Rate limiting (Fix #7) to prevent webhook flooding
- HTTPS enforcement (Fix #6) to prevent interception

---

**Questions?** Check the implementation in `src/routes/confirmation.js` lines 108-138
