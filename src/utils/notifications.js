const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');

// Configure SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendVerificationNotification(prescription, status, order) {
  try {
    const email = prescription.email || order?.email;
    const phone = prescription.phone || order?.phone;
    if (!email && !phone) {
      console.warn('No contact details for prescription:', { prescriptionId: prescription.id });
      return;
    }
    let guestLink = `${process.env.FRONTEND_URL}/status-check?patientIdentifier=${prescription.patientIdentifier}`;
    if (order && order.totalPrice > 0) {
      guestLink += `&orderId=${order.id}`;
    }
    let msg = {};
    if (status === 'verified') {
      msg = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Your Prescription is Ready',
        text: `Your prescription #${prescription.id} has been verified. ${order && order.totalPrice > 0 ? 'Complete your order payment' : 'View your medications and select pharmacies'}: ${guestLink}`,
      };
    } else {
      msg = {
        to: email,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Prescription Rejected',
        text: `Your prescription #${prescription.id} was rejected. Please upload a clearer image or contact support.`,
      };
    }
    if (email) {
      await sgMail.send(msg);
      console.log('Email sent:', { email, status, prescriptionId: prescription.id });
    }

    if (phone) {
      const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilioClient.messages.create({
        body: status === 'verified'
          ? `Prescription #${prescription.id} verified. ${order && order.totalPrice > 0 ? 'Pay for your order' : 'Select pharmacies'}: ${guestLink}`
          : `Prescription #${prescription.id} rejected. Upload again or contact support.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone,
      });
      console.log('SMS sent:', { phone, status, prescriptionId: prescription.id });
    }
  } catch (error) {
    console.error('Notification error:', { message: error.message, prescriptionId: prescription.id });
  }
}

module.exports = { sendVerificationNotification };