// src/core/authz/shapers/dashboard.js
// Field-level shaping for the pharmacy dashboard (Doc 1 S4.4).
//
// The dashboard service returns money and operations fields in one object.
// STAFF and TECHNICIAN and PHARMACIST must not see money, so shape() strips
// those fields unless the actor holds `dashboard.revenue`.
//
// The capability check goes through can() (FND-04a), not a role check. Today
// `dashboard.revenue` is granted only to MANAGER; Doc 2 (P-01) may change
// that, and this shaper follows.
//
// Fields stripped when the capability is absent:
//   - revenueToday
//   - revenueTrend
//   - posRevenueToday
//   - posRevenueTrend
//   - topSellingMeds[].revenue
//   - recentActivity[].amount    (Doc 1 S4.4 does not name this one, but an
//                                 activity feed that shows money amounts is
//                                 the same leak; this is a deliberate addition)
//
// Input is never mutated. The strip path returns a shallow copy with new
// arrays for topSellingMeds and recentActivity.

const { can } = require('../can');
const { actorFromRequest } = require('../require-capability');

function stripDashboardMoney(data) {
  if (!data || typeof data !== 'object') return data;
  const {
    revenueToday,
    revenueTrend,
    posRevenueToday,
    posRevenueTrend,
    topSellingMeds,
    recentActivity,
    ...rest
  } = data;

  if (Array.isArray(topSellingMeds)) {
    rest.topSellingMeds = topSellingMeds.map(({ revenue, ...med }) => med);
  } else if (topSellingMeds !== undefined) {
    rest.topSellingMeds = topSellingMeds;
  }

  if (Array.isArray(recentActivity)) {
    rest.recentActivity = recentActivity.map(({ amount, ...activity }) => activity);
  } else if (recentActivity !== undefined) {
    rest.recentActivity = recentActivity;
  }

  return rest;
}

const VIEWS = {
  dashboard: stripDashboardMoney,
};

// shape(req, viewName, data) - viewName selects a transformation; unknown
// viewName returns data unchanged (which is safe: no shape() callsite exists
// for an unknown view yet; when one does, it must be added here first).
function shape(req, viewName, data) {
  const transform = VIEWS[viewName];
  if (!transform) return data;

  const actor = actorFromRequest(req);
  if (can(actor, 'dashboard.revenue')) return data;
  return transform(data);
}

module.exports = { shape, VIEWS, stripDashboardMoney };