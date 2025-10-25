const express = require('express');
const crypto = require('crypto');
const confirmationService = require('../services/confirmationService');
const { validateOrderConfirmation } = require('../utils/validation');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const prisma = new PrismaClient();

console.log('Loaded confirmation.js version: 2025-06-18-v1');

// Debug endpoint to check database connection and TransactionReference table
router.get('/debug', async (req, res) => {
  try {
    console.log('Debug endpoint called');
    
    // Test database connection
    await prisma.$connect();
    console.log('Database connection successful');
    
    // Check if TransactionReference table exists and has data
    const transactionRefs = await prisma.transactionReference.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' }
    });
    
    console.log('TransactionReference table check:', {
      count: transactionRefs.length,
      records: transactionRefs.map(tr => ({
        id: tr.id,
        transactionReference: tr.transactionReference,
        orderReferences: tr.orderReferences,
        checkoutSessionId: tr.checkoutSessionId
      }))
    });
    
    // Check for orders with the specific session or reference
    const { reference, session } = req.query;
    let orders = [];
    
    if (reference) {
      orders = await prisma.order.findMany({
        where: { paymentReference: reference },
        include: { pharmacy: true }
      });
    } else if (session) {
      orders = await prisma.order.findMany({
        where: { checkoutSessionId: session },
        include: { pharmacy: true }
      });
    }
    
    res.json({
      message: 'Database connection successful',
      transactionRefsCount: transactionRefs.length,
      sampleRecords: transactionRefs.map(tr => ({
        id: tr.id,
        transactionReference: tr.transactionReference,
        orderReferences: tr.orderReferences,
        checkoutSessionId: tr.checkoutSessionId
      })),
      ordersFound: orders.length,
      orders: orders.map(o => ({
        id: o.id,
        userIdentifier: o.userIdentifier,
        paymentReference: o.paymentReference,
        checkoutSessionId: o.checkoutSessionId,
        status: o.status,
        paymentStatus: o.paymentStatus,
        pharmacy: o.pharmacy?.name
      }))
    });
  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({ 
      message: 'Database connection failed', 
      error: error.message,
      stack: error.stack
    });
  }
});

// GET /confirmation - Confirm payment and retrieve order details
router.get('/', async (req, res) => {
  try {
    const { reference, session } = req.query;
    const userId = req.headers['x-guest-id'];

    console.log('Confirmation request:', { reference, session, userId });

    // Validate input
    const { error } = validateOrderConfirmation({ reference, session, userId });
    if (error) {
      console.error('Validation error:', error.message);
      return res.status(400).json({ message: error.message });
    }

    const result = await confirmationService.confirmOrder({ reference, session, userId });
    res.status(200).json(result);
  } catch (error) {
    console.error('Confirmation error:', { message: error.message, stack: error.stack });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /webhook - Paystack webhook to handle payment completion
router.post('/webhook', async (req, res) => {
  try {
    console.log('Paystack webhook received at:', new Date().toISOString());
    
    // ✅ VERIFY PAYSTACK SIGNATURE
    // Get the secret key from environment (found in Paystack Dashboard > Settings > API Keys & Webhooks)
    const secret = process.env.PAYSTACK_SECRET_KEY;
    
    if (!secret) {
      console.error('PAYSTACK_SECRET_KEY not configured in environment variables');
      return res.status(500).json({ message: 'Server configuration error' });
    }
    
    // Generate hash from request body
    const hash = crypto
      .createHmac('sha512', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');
    
    // Get signature from headers
    const signature = req.headers['x-paystack-signature'];
    
    // Verify signature matches
    if (hash !== signature) {
      console.error('Invalid webhook signature detected:', {
        timestamp: new Date().toISOString(),
        receivedSignature: signature ? 'present' : 'missing',
        ipAddress: req.ip || req.connection.remoteAddress
      });
      return res.status(401).json({ message: 'Invalid signature' });
    }
    
    console.log('Webhook signature verified successfully');
    
    const { event, data } = req.body;
    
    // ✅ IDEMPOTENCY CHECK: Prevent duplicate webhook processing
    // Use Paystack's event ID or reference as unique identifier
    const eventId = data.id || data.reference || `${event}_${data.reference}_${Date.now()}`;
    
    // Check if this webhook has already been processed
    const existingWebhook = await prisma.processedWebhook.findUnique({
      where: { eventId: String(eventId) }
    });
    
    if (existingWebhook) {
      console.log('Webhook already processed:', {
        eventId,
        eventType: event,
        processedAt: existingWebhook.processedAt
      });
      return res.status(200).json({ 
        message: 'Webhook already processed',
        processedAt: existingWebhook.processedAt
      });
    }
    
    // Mark webhook as processed FIRST (before any business logic)
    // This ensures idempotency even if transaction lookup fails
    await prisma.processedWebhook.create({
      data: {
        eventId: String(eventId),
        eventType: event,
        payload: req.body
      }
    });
    
    // Process webhook based on event type
    if (event === 'charge.success') {
      const { reference, amount, customer } = data;
      
      console.log('Payment successful:', { reference, amount, customer });
      
      // Find the transaction reference
      const transactionRef = await prisma.transactionReference.findFirst({
        where: { transactionReference: reference },
      });
      
      if (!transactionRef) {
        console.error('Transaction reference not found:', reference);
        // Webhook already marked as processed, so duplicate won't retry
        return res.status(404).json({ message: 'Transaction not found' });
      }
      
      // Update orders to paid status (webhook already marked processed above)
      await prisma.$transaction(async (tx) => {
        for (const orderRef of transactionRef.orderReferences) {
          await tx.order.updateMany({
            where: { paymentReference: orderRef },
            data: { 
              paymentStatus: 'PAID',
              status: 'CONFIRMED',
              updatedAt: new Date()
            },
          });
        }
      });
      
      console.log('Orders updated to paid status for reference:', reference);
    } else if (event === 'charge.failed') {
      // ✅ PAYMENT FAILURE HANDLER: Restore stock when payment fails
      const { reference, amount, customer, gateway_response } = data;
      
      console.log('Payment failed:', { reference, amount, customer, gateway_response });
      
      // Find the transaction reference
      const transactionRef = await prisma.transactionReference.findFirst({
        where: { transactionReference: reference },
      });
      
      if (!transactionRef) {
        console.error('Transaction reference not found for failed payment:', reference);
        // Webhook already marked as processed, so duplicate won't retry
        return res.status(404).json({ message: 'Transaction not found' });
      }
      
      // Cancel orders and restore stock atomically
      await prisma.$transaction(async (tx) => {
        for (const orderRef of transactionRef.orderReferences) {
          // Find orders with their items
          const orders = await tx.order.findMany({
            where: { paymentReference: orderRef },
            include: { OrderItem: true }
          });
          
          for (const order of orders) {
            // Update order status
            await tx.order.update({
              where: { id: order.id },
              data: { 
                paymentStatus: 'FAILED',
                status: 'CANCELLED',
                cancelReason: `Payment failed: ${gateway_response || 'Unknown error'}`,
                cancelledAt: new Date(),
                updatedAt: new Date()
              },
            });
            
            // Restore stock for each order item
            for (const item of order.OrderItem) {
              await tx.medicationAvailability.update({
                where: {
                  medicationId_pharmacyId: {
                    medicationId: item.medicationId,
                    pharmacyId: item.pharmacyId
                  }
                },
                data: {
                  stock: { increment: item.quantity }
                }
              });
              
              console.log(`Stock restored: ${item.quantity} units for medication ${item.medicationId}`);
            }
          }
        }
      });
      
      console.log('Orders cancelled and stock restored for reference:', reference);
      
      // TODO: Send notification to user (email/SMS)
      // This should be non-blocking and use a queue system
      try {
        // Placeholder for notification service
        console.log('TODO: Send payment failure notification to:', customer?.email);
      } catch (notificationError) {
        // Don't fail the webhook if notification fails
        console.error('Notification failed:', notificationError.message);
      }
    } else {
      // For other event types, webhook already marked as processed
      console.log('Webhook event recorded:', event);
    }
    
    res.status(200).json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ message: 'Webhook processing failed' });
  }
});

// GET /callback - Paystack callback redirect for successful payments
router.get('/callback', async (req, res) => {
  try {
    const { reference, session, trxref } = req.query;
    
    console.log('Paystack callback received:', { reference, session, trxref });
    console.log('All query parameters:', req.query);
    
    // Use trxref if reference is not available (Paystack sometimes sends trxref instead)
    const paymentReference = reference || trxref;
    
    if (paymentReference && session) {
      // Redirect to confirmation page with reference
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const redirectUrl = `${frontendUrl}/confirmation?reference=${paymentReference}&session=${session}`;
      console.log('Redirecting to:', redirectUrl);
      res.redirect(redirectUrl);
    } else if (session) {
      // Fallback redirect with just session
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const redirectUrl = `${frontendUrl}/confirmation?session=${session}`;
      console.log('Redirecting to (fallback):', redirectUrl);
      res.redirect(redirectUrl);
    } else {
      // Final fallback
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const redirectUrl = `${frontendUrl}/confirmation`;
      console.log('Redirecting to (final fallback):', redirectUrl);
      res.redirect(redirectUrl);
    }
  } catch (error) {
    console.error('Callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/confirmation`);
  }
});

module.exports = router;