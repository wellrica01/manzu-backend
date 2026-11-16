// src/core/authz/capabilities.js
// Role -> capability map. Doc 1 S4.1. Deny by default: a role with no entry
// has no capabilities. Unknown roles (OWNER, ADMIN in PharmacyUserRole) are
// deliberately absent - those are frozen and rejected by validation per the
// doc; if any row still carries them, they resolve to zero capabilities.
//
// This is the v1 pharmacy map. Doc 2 (P-01 capability matrix) will refine it;
// D-2 (TECHNICIAN semantics) and D-3 (managers per pharmacy) are still open.
// The admin map belongs to Doc 3 and is not seeded here.
//
// Naming: <domain>.<verb>[.<sub>]. Never a route name; always an ability.

const ROLES = Object.freeze({
  STAFF: 'STAFF',
  TECHNICIAN: 'TECHNICIAN',
  PHARMACIST: 'PHARMACIST',
  MANAGER: 'MANAGER',
});

// Every capability the pharmacy domain recognises. Anything not here is
// unknown and will be denied - that is intentional, so a typo in a route
// declaration fails closed rather than opening up.
const CAPABILITIES = Object.freeze([
  // Dashboard and analytics
  'dashboard.view',
  'dashboard.revenue',
  'analytics.view',

  // Orders
  'orders.view',
  'orders.accept',
  'orders.reject',
  'orders.cancel',
  'orders.bulk',

  // Inventory
  'inventory.view',
  'inventory.edit',
  'inventory.delete',
  'inventory.price.edit',
  'inventory.stock.adjust',

  // Sales and earnings
  'sales.view',
  'sales.export',
  'earnings.view',
  'payout.view',
  'payout.history',
  'payouts.view',
  'sales.view.own',
  'sales.view.all',

  // Banking
  'banking.view',
  'banking.manage',
  'banking.verify',

  // Prescriptions
  'prescription.view',
  'prescription.verify',

  // Team
  'team.view',
  'team.manage',
  'team.invite',
  'team.role.change',
  'team.suspend',
  'team.pin.reset',

  // Operating hours
  'hours.view',
  'hours.edit',

  // Profile
  'profile.view',
  'profile.logo',

  // Self
  'self.prefs',
  'self.pin.change',
]);

const ROLE_CAPABILITIES = Object.freeze({
  [ROLES.STAFF]: Object.freeze(new Set([
    'dashboard.view',
    'orders.view',
    'inventory.view',
    'sales.view',
    'sales.view.own',
    'sales.export',
    'profile.view',
    'profile.logo',
    'hours.view',
    'self.prefs',
    'self.pin.change',
  ])),
  [ROLES.TECHNICIAN]: Object.freeze(new Set([
    // STAFF
    'dashboard.view',
    'orders.view',
    'inventory.view',
    'sales.view',
    'sales.view.own',
    'sales.export',
    'profile.view',
    'profile.logo',
    'hours.view',
    'self.prefs',
    'self.pin.change',
    // + receiving and counting stock (D-2 pending)
    'inventory.edit',
    'inventory.stock.adjust',
  ])),
  [ROLES.PHARMACIST]: Object.freeze(new Set([
    // TECHNICIAN
    'dashboard.view',
    'orders.view',
    'inventory.view',
    'sales.view',
    'sales.view.own',
    'sales.export',
    'profile.view',
    'profile.logo',
    'hours.view',
    'self.prefs',
    'self.pin.change',
    'inventory.edit',
    'inventory.stock.adjust',
    // + clinical
    'inventory.delete',
    'prescription.view',
    'prescription.verify',
  ])),
  [ROLES.MANAGER]: Object.freeze(new Set([
    // Full pharmacy set
    'dashboard.view',
    'dashboard.revenue',
    'analytics.view',
    'orders.view',
    'orders.accept',
    'orders.reject',
    'orders.cancel',
    'orders.bulk',
    'inventory.view',
    'inventory.edit',
    'inventory.delete',
    'inventory.price.edit',
    'inventory.stock.adjust',
    'sales.view',
    'sales.view.own',
    'sales.export',
    'earnings.view',
    'payout.view',
    'payout.history',
    'payouts.view',
    'sales.view.all',
    'banking.view',
    'banking.manage',
    'banking.verify',
    'prescription.view',
    'prescription.verify',
    'team.view',
    'team.manage',
    'team.invite',
    'team.role.change',
    'team.suspend',
    'team.pin.reset',
    'profile.view',
    'profile.logo',
    'hours.view',
    'self.prefs',
    'self.pin.change',
    'hours.edit',
  ])),
});

function knownCapability(capability) {
  return CAPABILITIES.includes(capability);
}

function roleHasCapability(role, capability) {
  const set = ROLE_CAPABILITIES[role];
  return Boolean(set && set.has(capability));
}

module.exports = {
  ROLES,
  CAPABILITIES,
  ROLE_CAPABILITIES,
  knownCapability,
  roleHasCapability,
};