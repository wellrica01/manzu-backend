// tests/dashboard-shaper.test.js
// Proves the dashboard shaper (FND-04c) strips money fields for actors
// without `dashboard.revenue`. Pure Node, no DB, no Express.

const { shape, stripDashboardMoney } = require('../src/core/authz/shapers/dashboard');

function makeDashboard() {
  return {
    ordersToday: 12,
    revenueToday: 45000,
    revenueTrend: 5.5,
    posRevenueToday: 12000,
    posRevenueTrend: -2.0,
    topSellingMeds: [
      { name: 'Paracetamol', quantity: 20, revenue: 5000, orders: 3 },
      { name: 'Ibuprofen', quantity: 15, revenue: 3000, orders: 2 },
    ],
    recentActivity: [
      { type: 'order', description: 'Order #1 accepted', amount: 5000 },
      { type: 'order', description: 'Order #2 fulfilled', amount: 7500 },
    ],
    lowStockMeds: [
      { name: 'Amoxicillin', form: 'capsule', stock: 2, price: 800 },
    ],
  };
}

function req(actor) {
  // The shaper reads actor via actorFromRequest, which checks currentActor()
  // (empty here) then req.user. Supply req.user in the legacy JWT shape so the
  // transitional glue produces the actor we want.
  if (!actor) return {};
  if (actor.type === 'pharmacy_user') {
    return { user: { userId: actor.id, pharmacyId: actor.pharmacyId, role: actor.role } };
  }
  if (actor.type === 'admin') {
    return { user: { adminId: actor.id, role: actor.role } };
  }
  return {};
}

describe('dashboard shaper', () => {
  it('STAFF loses all money fields', () => {
    const staff = { type: 'pharmacy_user', id: 1, pharmacyId: 3, role: 'STAFF' };
    const data = makeDashboard();
    const shaped = shape(req(staff), 'dashboard', data);

    expect(shaped.ordersToday).toBe(12);
    expect(shaped.revenueToday).toBeUndefined();
    expect(shaped.revenueTrend).toBeUndefined();
    expect(shaped.posRevenueToday).toBeUndefined();
    expect(shaped.posRevenueTrend).toBeUndefined();
    expect(shaped.topSellingMeds).toEqual([
      { name: 'Paracetamol', quantity: 20, orders: 3 },
      { name: 'Ibuprofen', quantity: 15, orders: 2 },
    ]);
    expect(shaped.recentActivity).toEqual([
      { type: 'order', description: 'Order #1 accepted' },
      { type: 'order', description: 'Order #2 fulfilled' },
    ]);
    expect(shaped.lowStockMeds).toEqual([
      { name: 'Amoxicillin', form: 'capsule', stock: 2, price: 800 },
    ]);
  });

  it('MANAGER keeps all money fields', () => {
    const mgr = { type: 'pharmacy_user', id: 2, pharmacyId: 3, role: 'MANAGER' };
    const data = makeDashboard();
    const shaped = shape(req(mgr), 'dashboard', data);

    expect(shaped.revenueToday).toBe(45000);
    expect(shaped.revenueTrend).toBe(5.5);
    expect(shaped.posRevenueToday).toBe(12000);
    expect(shaped.posRevenueTrend).toBe(-2.0);
    expect(shaped.topSellingMeds[0].revenue).toBe(5000);
    expect(shaped.recentActivity[0].amount).toBe(5000);
  });

  it('missing actor -> treated as no capability -> stripped', () => {
    const data = makeDashboard();
    const shaped = shape({}, 'dashboard', data);
    expect(shaped.revenueToday).toBeUndefined();
    expect(shaped.topSellingMeds[0].revenue).toBeUndefined();
  });

  it('does not mutate the input on the strip path', () => {
    const staff = { type: 'pharmacy_user', id: 1, pharmacyId: 3, role: 'STAFF' };
    const data = makeDashboard();
    shape(req(staff), 'dashboard', data);
    // Original still has all fields
    expect(data.revenueToday).toBe(45000);
    expect(data.topSellingMeds[0].revenue).toBe(5000);
  });

  it('returns the same object unchanged for MANAGER (fast path)', () => {
    const mgr = { type: 'pharmacy_user', id: 2, pharmacyId: 3, role: 'MANAGER' };
    const data = makeDashboard();
    const shaped = shape(req(mgr), 'dashboard', data);
    // Same reference - no copy on the allow path
    expect(shaped).toBe(data);
  });

  it('unknown view name returns data unchanged', () => {
    const data = { x: 1 };
    expect(shape({}, 'not_a_view', data)).toBe(data);
  });

  it('stripDashboardMoney handles missing arrays gracefully', () => {
    const shaped = stripDashboardMoney({ ordersToday: 1, revenueToday: 100 });
    expect(shaped.ordersToday).toBe(1);
    expect(shaped.revenueToday).toBeUndefined();
    expect(shaped.topSellingMeds).toBeUndefined();
    expect(shaped.recentActivity).toBeUndefined();
  });
});