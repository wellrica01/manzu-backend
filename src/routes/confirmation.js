const express = require('express');
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
        patientIdentifier: o.patientIdentifier,
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
    console.log('Paystack webhook received:', req.body);
    
    const { event, data } = req.body;
    
    if (event === 'charge.success') {
      const { reference, amount, customer } = data;
      
      console.log('Payment successful:', { reference, amount, customer });
      
      // Find the transaction reference
      const transactionRef = await prisma.transactionReference.findFirst({
        where: { transactionReference: reference },
      });
      
      if (!transactionRef) {
        console.error('Transaction reference not found:', reference);
        return res.status(404).json({ message: 'Transaction not found' });
      }
      
      // Update orders to paid status
      await prisma.$transaction(async (tx) => {
        for (const orderRef of transactionRef.orderReferences) {
          await tx.order.updateMany({
            where: { paymentReference: orderRef },
            data: { 
              paymentStatus: 'paid',
              status: 'confirmed',
              updatedAt: new Date()
            },
          });
        }
      });
      
      console.log('Orders updated to paid status for reference:', reference);
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