const isValidEmail = require('./validation').isValidEmail;
const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendVerificationNotification(prescription, status, order) {
  const { email, phone } = prescription;
  if (!email && !phone) {
    console.warn('No contact information provided for notification', { prescriptionId: prescription.id });
    return;
  }

  const message = status === 'verified'
    ? `Your order #${order.id} has been confirmed! Track it with code: ${order.trackingCode}. Visit ${process.env.NEXT_PUBLIC_API_URL}/track?trackingCode=${encodeURIComponent(order.trackingCode)}`
    : `Your prescription for order #${order.id} was rejected. Reason: ${prescription.rejectReason || 'Invalid prescription'}. Please re-upload at ${process.env.NEXT_PUBLIC_API_URL}/status-check`;

  try {
    if (email && isValidEmail(email)) {
      const msg = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL || 'no-reply@manzu.example.com',
        subject: status === 'verified' ? 'Order Confirmation' : 'Prescription Verification Update',
        text: message,
        html: `
          <div style="font-family: Arial, sans-serif; color: #225F91; padding: 20px;">
            <h2>${status === 'verified' ? 'Order Confirmed!' : 'Prescription Update'}</h2>
            <p>${message}</p>
            <a href="${process.env.NEXT_PUBLIC_API_URL}/track?trackingCode=${encodeURIComponent(order.trackingCode)}" style="background: #225F91; color: white; padding: 10px 20px; text-decoration: none; border-radius: 9999px;">Track Order</a>
          </div>
        `,
      };
      await sgMail.send(msg);
      console.log('Email sent:', { to: email, orderId: order.id });
    }

    if (phone) {
      await client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone,
      });
      console.log('SMS sent:', { to: phone, orderId: order.id });
    }
  } catch (error) {
    console.error('Notification error:', { error: error.message, prescriptionId: prescription.id });
    throw new Error('Failed to send notification');
  }
}

module.exports = { sendVerificationNotification };