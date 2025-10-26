const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');
const { alertNotificationServiceDown } = require('./error-reporter');

// Configure SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Track consecutive failures for alerting
let sendgridFailureCount = 0;
let twilioFailureCount = 0;
const FAILURE_THRESHOLD = 3; // Alert after 3 consecutive failures

async function sendVerificationNotification(prescription, status, order) {
  try {
    const email = prescription.email || order?.email;
    const phone = prescription.phone || order?.phone;
    if (!email && !phone) {
      console.warn('No contact details for prescription:', { prescriptionId: prescription.id });
      return;
    }
    let guestLink = `${process.env.FRONTEND_URL}/status-check?userIdentifier=${prescription.userIdentifier}`;
    if (order && order.totalPrice > 0) {
      guestLink += `&orderId=${order.id}`;
    }
    let msg = {};
    if (status === 'VERIFIED') {
      msg = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Your Prescription is Ready',
        text: `Your prescription #${prescription.id} has been verified. ${order && order.totalPrice > 0 ? 'Complete your order payment' : 'View your medications and select pharmacies'}: ${guestLink}`,
      };
    } else if (status === 'REJECTED') {
      msg = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Prescription Rejected',
        text: `Your prescription #${prescription.id} was rejected. Please upload a clearer image or contact support.`,
      };
    } else {
      msg = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Prescription Update',
        text: `Your prescription #${prescription.id} status: ${status}.`,
      };
    }
    if (email) {
      try {
        await sgMail.send(msg);
        console.log('Email sent:', { email, status, prescriptionId: prescription.id });
        sendgridFailureCount = 0; // Reset on success
      } catch (emailError) {
        sendgridFailureCount++;
        console.error('❌ Email send failed:', emailError.message);
        
        // 🚨 Alert if SendGrid is down
        if (sendgridFailureCount >= FAILURE_THRESHOLD) {
          alertNotificationServiceDown('SendGrid', emailError, {
            consecutiveFailures: sendgridFailureCount,
            notificationType: 'verification'
          });
        }
      }
    }

    if (phone) {
      try {
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await twilioClient.messages.create({
          body: status === 'VERIFIED'
            ? `Prescription #${prescription.id} verified. ${order && order.totalPrice > 0 ? 'Pay for your order' : 'Select pharmacies'}: ${guestLink}`
            : status === 'REJECTED'
              ? `Prescription #${prescription.id} rejected. Upload again or contact support.`
              : `Prescription #${prescription.id} status: ${status}.`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phone,
        });
        console.log('SMS sent:', { phone, status, prescriptionId: prescription.id });
        twilioFailureCount = 0; // Reset on success
      } catch (smsError) {
        twilioFailureCount++;
        console.error('❌ SMS send failed:', smsError.message);
        
        // 🚨 Alert if Twilio is down
        if (twilioFailureCount >= FAILURE_THRESHOLD) {
          alertNotificationServiceDown('Twilio', smsError, {
            consecutiveFailures: twilioFailureCount,
            notificationType: 'verification'
          });
        }
      }
    }
  } catch (error) {
    console.error('Notification error:', { message: error.message, prescriptionId: prescription.id });
  }
}

async function sendPrescriptionExpiryNotification(prescription, isWarning = false) {
  try {
    const email = prescription.email;
    const phone = prescription.phone;
    
    if (!email && !phone) {
      console.warn('No contact details for prescription:', { prescriptionId: prescription.id });
      return false;
    }

    const expiryDate = new Date(prescription.expiryDate).toLocaleDateString();
    const uploadLink = `${process.env.FRONTEND_URL}/upload-prescription?userIdentifier=${prescription.userIdentifier}`;
    
    const subject = isWarning ? 'Prescription Expiring Soon' : 'Prescription Expired';
    const message = isWarning 
      ? `Your prescription will expire in 3 days (${expiryDate}). Please upload a new one to continue your order.`
      : `Your prescription has expired. Please upload a new prescription to proceed with your order.`;

    // Send email notification
    if (email) {
      try {
        const emailMessage = {
          to: email,
          from: process.env.SENDGRID_FROM_EMAIL,
          subject: subject,
          text: `${message}\n\nUpload new prescription: ${uploadLink}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: ${isWarning ? '#ff9800' : '#d32f2f'};">${subject}</h2>
              <p>${message}</p>
              <p>
                <a href="${uploadLink}" style="background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Upload New Prescription</a>
              </p>
              <p style="color: #666; margin-top: 30px;">Prescription ID: #${prescription.id}</p>
              <p><strong>Manzu Team</strong></p>
            </div>
          `
        };

        await sgMail.send(emailMessage);
        console.log('✅ Expiry email sent:', { email, prescriptionId: prescription.id, isWarning });
        sendgridFailureCount = 0; // Reset on success
      } catch (emailError) {
        sendgridFailureCount++;
        console.error('❌ Email send failed:', emailError.message);
        
        // 🚨 Alert if SendGrid is down
        if (sendgridFailureCount >= FAILURE_THRESHOLD) {
          alertNotificationServiceDown('SendGrid', emailError, {
            consecutiveFailures: sendgridFailureCount,
            notificationType: 'expiry'
          });
        }
      }
    }

    // Send SMS notification
    if (phone) {
      try {
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const smsMessage = `${message} Upload: ${uploadLink}`;
        
        await twilioClient.messages.create({
          body: smsMessage,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phone,
        });
        
        console.log('✅ Expiry SMS sent:', { phone, prescriptionId: prescription.id, isWarning });
        twilioFailureCount = 0; // Reset on success
      } catch (smsError) {
        twilioFailureCount++;
        console.error('❌ SMS send failed:', smsError.message);
        
        // 🚨 Alert if Twilio is down
        if (twilioFailureCount >= FAILURE_THRESHOLD) {
          alertNotificationServiceDown('Twilio', smsError, {
            consecutiveFailures: twilioFailureCount,
            notificationType: 'expiry'
          });
        }
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Expiry notification error:', { 
      message: error.message, 
      prescriptionId: prescription.id 
    });
    return false;
  }
}

/**
 * Send notification when pharmacy rejects order
 */
async function sendOrderRejectionNotification(order, refund) {
  try {
    const email = order.email;
    const phone = order.phone;
    
    if (!email && !phone) {
      console.warn('No contact details for order:', { orderId: order.id });
      return;
    }

    const refundAmount = refund.amount.toString();
    const trackingCode = order.trackingCode || order.id;
    const statusLink = `${process.env.FRONTEND_URL}/order-status?trackingCode=${trackingCode}`;

    // Send email notification
    if (email) {
      try {
        const emailMessage = {
          to: email,
          from: process.env.SENDGRID_FROM_EMAIL,
          subject: 'Order Cancelled - Refund Initiated',
          text: `Dear Customer,\n\nYour order #${trackingCode} has been cancelled by the pharmacy.\n\nRefund Details:\n- Amount: ₦${refundAmount}\n- Status: Processing\n- Expected: 5-10 business days\n\nThe refund will be credited back to your original payment method.\n\nTrack your order: ${statusLink}\n\nWe apologize for the inconvenience.\n\nBest regards,\nManzu Team`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #d32f2f;">Order Cancelled</h2>
              <p>Dear Customer,</p>
              <p>Your order <strong>#${trackingCode}</strong> has been cancelled by the pharmacy.</p>
              
              <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Refund Details</h3>
                <p><strong>Amount:</strong> ₦${refundAmount}</p>
                <p><strong>Status:</strong> Processing</p>
                <p><strong>Expected:</strong> 5-10 business days</p>
              </div>
              
              <p>The refund will be credited back to your original payment method.</p>
              
              <p>
                <a href="${statusLink}" style="background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Track Your Order</a>
              </p>
              
              <p style="color: #666; margin-top: 30px;">We apologize for the inconvenience.</p>
              <p><strong>Manzu Team</strong></p>
            </div>
          `
        };

        await sgMail.send(emailMessage);
        console.log('✅ Rejection email sent:', { email, orderId: order.id });
        sendgridFailureCount = 0; // Reset on success
      } catch (emailError) {
        sendgridFailureCount++;
        console.error('❌ Email send failed:', emailError.message);
        
        // 🚨 Alert if SendGrid is down
        if (sendgridFailureCount >= FAILURE_THRESHOLD) {
          alertNotificationServiceDown('SendGrid', emailError, {
            consecutiveFailures: sendgridFailureCount,
            notificationType: 'order_rejection'
          });
        }
      }
    }

    // Send SMS notification
    if (phone) {
      try {
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const smsMessage = `Order #${trackingCode} cancelled. Refund of ₦${refundAmount} is being processed (5-10 days). Track: ${statusLink}`;
        
        await twilioClient.messages.create({
          body: smsMessage,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phone,
        });
        
        console.log('✅ Rejection SMS sent:', { phone, orderId: order.id });
        twilioFailureCount = 0; // Reset on success
      } catch (smsError) {
        twilioFailureCount++;
        console.error('❌ SMS send failed:', smsError.message);
        
        // 🚨 Alert if Twilio is down
        if (twilioFailureCount >= FAILURE_THRESHOLD) {
          alertNotificationServiceDown('Twilio', smsError, {
            consecutiveFailures: twilioFailureCount,
            notificationType: 'order_rejection'
          });
        }
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Rejection notification error:', { 
      message: error.message, 
      orderId: order.id 
    });
    // Don't throw - notification failure shouldn't block refund
    return false;
  }
}

/**
 * Send payment confirmation notification
 */
async function sendPaymentConfirmationNotification(order) {
  try {
    const email = order.email;
    const phone = order.phone;
    
    if (!email && !phone) {
      console.warn('No contact details for order:', { orderId: order.id });
      return false;
    }

    const trackingCode = order.trackingCode || order.id;
    const statusLink = `${process.env.FRONTEND_URL}/order-status?trackingCode=${trackingCode}`;
    const amount = order.totalPrice.toString();

    // Send email notification
    if (email) {
      try {
        const emailMessage = {
          to: email,
          from: process.env.SENDGRID_FROM_EMAIL,
          subject: 'Payment Confirmed - Order Received',
          text: `Dear Customer,\n\nYour payment of ₦${amount} has been confirmed!\n\nOrder Details:\n- Order ID: #${trackingCode}\n- Amount: ₦${amount}\n- Status: ${order.status}\n- Delivery: ${order.deliveryMethod}\n\nTrack your order: ${statusLink}\n\nThank you for choosing Manzu!\n\nBest regards,\nManzu Team`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #4caf50;">✓ Payment Confirmed</h2>
              <p>Dear Customer,</p>
              <p>Your payment of <strong>₦${amount}</strong> has been confirmed!</p>
              
              <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Order Details</h3>
                <p><strong>Order ID:</strong> #${trackingCode}</p>
                <p><strong>Amount:</strong> ₦${amount}</p>
                <p><strong>Status:</strong> ${order.status}</p>
                <p><strong>Delivery:</strong> ${order.deliveryMethod}</p>
              </div>
              
              <p>
                <a href="${statusLink}" style="background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Track Your Order</a>
              </p>
              
              <p style="color: #666; margin-top: 30px;">Thank you for choosing Manzu!</p>
              <p><strong>Manzu Team</strong></p>
            </div>
          `
        };

        await sgMail.send(emailMessage);
        console.log('✅ Payment confirmation email sent:', { email, orderId: order.id });
        sendgridFailureCount = 0; // Reset on success
      } catch (emailError) {
        sendgridFailureCount++;
        console.error('❌ Email send failed:', emailError.message);
        
        // 🚨 Alert if SendGrid is down
        if (sendgridFailureCount >= FAILURE_THRESHOLD) {
          alertNotificationServiceDown('SendGrid', emailError, {
            consecutiveFailures: sendgridFailureCount,
            notificationType: 'payment_confirmation'
          });
        }
      }
    }

    // Send SMS notification
    if (phone) {
      try {
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const smsMessage = `Payment confirmed! Order #${trackingCode} (₦${amount}) received. Track: ${statusLink}`;
        
        await twilioClient.messages.create({
          body: smsMessage,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phone,
        });
        
        console.log('✅ Payment confirmation SMS sent:', { phone, orderId: order.id });
        twilioFailureCount = 0; // Reset on success
      } catch (smsError) {
        twilioFailureCount++;
        console.error('❌ SMS send failed:', smsError.message);
        
        // 🚨 Alert if Twilio is down
        if (twilioFailureCount >= FAILURE_THRESHOLD) {
          alertNotificationServiceDown('Twilio', smsError, {
            consecutiveFailures: twilioFailureCount,
            notificationType: 'payment_confirmation'
          });
        }
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Payment confirmation notification error:', { 
      message: error.message, 
      orderId: order.id 
    });
    return false;
  }
}

/**
 * Send refund completion notification
 */
async function sendRefundCompletionNotification(refund, order) {
  try {
    const email = order.email;
    const phone = order.phone;
    
    if (!email && !phone) {
      console.warn('No contact details for refund:', { refundId: refund.id });
      return false;
    }

    const trackingCode = order.trackingCode || order.id;
    const amount = refund.amount.toString();
    const statusLink = `${process.env.FRONTEND_URL}/order-status?trackingCode=${trackingCode}`;

    // Send email notification
    if (email) {
      const emailMessage = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Refund Completed',
        text: `Dear Customer,\n\nYour refund has been completed!\n\nRefund Details:\n- Order ID: #${trackingCode}\n- Amount: ₦${amount}\n- Status: ${refund.status}\n- Reason: ${refund.reason}\n\nThe funds should appear in your account within 5-10 business days.\n\nTrack your order: ${statusLink}\n\nBest regards,\nManzu Team`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4caf50;">Refund Completed</h2>
            <p>Dear Customer,</p>
            <p>Your refund has been completed!</p>
            
            <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Refund Details</h3>
              <p><strong>Order ID:</strong> #${trackingCode}</p>
              <p><strong>Amount:</strong> ₦${amount}</p>
              <p><strong>Status:</strong> ${refund.status}</p>
              <p><strong>Reason:</strong> ${refund.reason}</p>
            </div>
            
            <p>The funds should appear in your account within 5-10 business days.</p>
            
            <p>
              <a href="${statusLink}" style="background: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Order</a>
            </p>
            
            <p style="color: #666; margin-top: 30px;">Best regards,</p>
            <p><strong>Manzu Team</strong></p>
          </div>
        `
      };

      await sgMail.send(emailMessage);
      console.log('✅ Refund completion email sent:', { email, refundId: refund.id });
    }

    // Send SMS notification
    if (phone) {
      const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const smsMessage = `Refund completed! ₦${amount} for order #${trackingCode}. Funds will arrive in 5-10 days. ${statusLink}`;
      
      await twilioClient.messages.create({
        body: smsMessage,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone,
      });
      
      console.log('✅ Refund completion SMS sent:', { phone, refundId: refund.id });
    }

    return true;
  } catch (error) {
    console.error('❌ Refund completion notification error:', { 
      message: error.message, 
      refundId: refund.id 
    });
    return false;
  }
}

module.exports = { 
  sendVerificationNotification, 
  sendPrescriptionExpiryNotification,
  sendOrderRejectionNotification,
  sendPaymentConfirmationNotification,
  sendRefundCompletionNotification
};