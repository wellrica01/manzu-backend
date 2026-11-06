/**
 * PHARMACY PUSH SERVICE (G4)
 *
 * - Device token registry (PushToken table, one row per device).
 * - Sender for the pharmacy mobile app through the Expo Push API.
 *
 * Rules:
 *  - Sending a push must NEVER break payments or order updates. Every public
 *    "notify*" function catches its own errors and never rejects.
 *  - One push per order, even though confirmOrder() and the charge.success
 *    webhook can both mark the same order PAID. The first caller claims the
 *    order by inserting a unique ProcessedWebhook row; later callers skip.
 *  - Device tokens are never logged. Push text has no customer name or phone.
 */

const { Expo } = require('expo-server-sdk');
const prisma = require('../../../core/database/prisma');

const expo = new Expo();
const ORDERS_CHANNEL_ID = 'orders'; // must match the channel the mobile app creates

// Expo error messages can contain the token itself. Strip it before logging.
function safeMessage(err) {
  const msg = err && err.message ? String(err.message) : 'unknown error';
  return msg.replace(/Expo(nent)?PushToken\[[^\]]*\]/g, '[token]');
}

// ---------------------------------------------------------------------------
// Token registry
// ---------------------------------------------------------------------------

async function registerToken({ userId, pharmacyId, token, platform }) {
  if (!Expo.isExpoPushToken(token)) {
    const error = new Error('Invalid Expo push token');
    error.status = 400;
    throw error;
  }

  // token is unique: if the same device is now used by another user (shared
  // phone, new login), the row simply moves to the new user.
  await prisma.pushToken.upsert({
    where: { token },
    create: { userId, pharmacyId, token, platform },
    update: { userId, pharmacyId, platform, lastSeenAt: new Date() },
  });
}

// Only removes the caller's own row, so a late logout can't delete a token
// that has since been taken over by another user.
async function unregisterToken({ userId, pharmacyId, token }) {
  await prisma.pushToken.deleteMany({ where: { token, userId, pharmacyId } });
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

async function sendToPharmacy(pharmacyId, { title, body, data }) {
  const rows = await prisma.pushToken.findMany({
    where: { pharmacyId },
    select: { token: true },
  });
  const tokens = rows.map(r => r.token).filter(t => Expo.isExpoPushToken(t));
  if (tokens.length === 0) return { sent: 0, pruned: 0 };

  const messages = tokens.map(to => ({
    to,
    sound: 'default',
    title,
    body,
    data,
    channelId: ORDERS_CHANNEL_ID,
    priority: 'high',
  }));

  const dead = [];
  let sent = 0;

  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, i) => {
        if (ticket.status === 'ok') {
          sent += 1;
        } else if (ticket.details && ticket.details.error === 'DeviceNotRegistered') {
          dead.push(chunk[i].to);
        } else {
          console.warn('Push ticket error:', ticket.details && ticket.details.error);
        }
      });
    } catch (err) {
      console.error('Push chunk failed:', safeMessage(err));
    }
  }

  if (dead.length > 0) {
    await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
  }
  return { sent, pruned: dead.length };
}

// Claim an order for notification. Returns true only for the first caller.
async function claimOrderPush(orderId) {
  try {
    await prisma.processedWebhook.create({
      data: {
        eventId: `push_order_paid_${orderId}`,
        eventType: 'push.order_paid',
        payload: { orderId },
      },
    });
    return true;
  } catch (err) {
    if (err && err.code === 'P2002') return false; // already notified
    throw err;
  }
}

/**
 * Notify pharmacies about orders that just became PAID + CONFIRMED.
 * Safe to call from several places for the same order: only the first call sends.
 * Never throws.
 */
async function notifyNewPaidOrders(orderIds) {
  try {
    const ids = [...new Set((orderIds || []).map(Number).filter(Number.isInteger))];
    if (ids.length === 0) return;

    const orders = await prisma.order.findMany({
      where: { id: { in: ids }, paymentStatus: 'PAID', status: 'CONFIRMED', pharmacyId: { not: null } },
      select: { id: true, pharmacyId: true },
    });

    for (const order of orders) {
      try {
        if (!(await claimOrderPush(order.id))) continue;
        await sendToPharmacy(order.pharmacyId, {
          title: 'New order',
          body: `Order #${order.id} is paid and waiting for you.`,
          data: { type: 'order', orderId: order.id },
        });
      } catch (err) {
        console.error('Order push failed:', { orderId: order.id, message: safeMessage(err) });
      }
    }
  } catch (err) {
    console.error('notifyNewPaidOrders failed:', safeMessage(err));
  }
}

/**
 * Webhook helper: the charge.success handler only knows payment references.
 * Never throws.
 */
async function notifyPaidOrdersByReferences(paymentReferences) {
  try {
    if (!Array.isArray(paymentReferences) || paymentReferences.length === 0) return;
    const orders = await prisma.order.findMany({
      where: { paymentReference: { in: paymentReferences } },
      select: { id: true },
    });
    await notifyNewPaidOrders(orders.map(o => o.id));
  } catch (err) {
    console.error('notifyPaidOrdersByReferences failed:', safeMessage(err));
  }
}

module.exports = {
  registerToken,
  unregisterToken,
  notifyNewPaidOrders,
  notifyPaidOrdersByReferences,
};
