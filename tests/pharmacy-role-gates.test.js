const fs = require('fs');
const path = require('path');
const { authorizeRoles } = require('../src/middleware/auth');

const pharmacyRoutes = fs.readFileSync(
  path.join(__dirname, '../src/routes/pharmacy.js'),
  'utf8'
);

const managerOnlyRoutes = [
  '/earnings/analytics',
  '/payouts/summary',
  '/payouts/history',
  '/orders/pending-payout',
  '/sales/export',
  '/analytics',
  '/analytics/weekly',
  '/banking/status',
  '/banking/banks',
];

describe('Pharmacy manager-only routes', () => {
  test.each(managerOnlyRoutes)(
    'GET %s requires MANAGER authorization',
    (route) => {
      expect(pharmacyRoutes).toContain(
        `router.get('${route}', authenticatePharmacy, authorizeRoles('MANAGER')`
      );
    }
  );
});

describe('Pharmacy role authorization', () => {
  const response = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  };

  test('rejects STAFF with 403', () => {
    const req = {
      user: { userId: 10, pharmacyId: 20, role: 'STAFF' },
    };
    const res = response();
    const next = jest.fn();

    authorizeRoles('MANAGER')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'FORBIDDEN',
      message: 'You do not have permission to perform this action',
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('allows a pharmacy MANAGER', () => {
    const req = {
      user: { userId: 10, pharmacyId: 20, role: 'MANAGER' },
    };
    const res = response();
    const next = jest.fn();

    authorizeRoles('MANAGER')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects a MANAGER role without a pharmacy token', () => {
    const req = {
      user: { adminId: 10, role: 'MANAGER' },
    };
    const res = response();
    const next = jest.fn();

    authorizeRoles('MANAGER')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('Medication write permissions', () => {
  test('POST /medications requires MANAGER', () => {
    expect(pharmacyRoutes).toContain(
      "router.post('/medications', authenticatePharmacy, authorizeRoles('MANAGER')"
    );
  });

  test('PATCH /medications/:medicationId requires MANAGER', () => {
    expect(pharmacyRoutes).toContain(
      "router.patch('/medications/:medicationId', authenticatePharmacy, authorizeRoles('MANAGER')"
    );
  });

  test('DELETE /medications/:medicationId allows MANAGER and PHARMACIST', () => {
    expect(pharmacyRoutes).toContain(
      "router.delete('/medications/:medicationId', authenticatePharmacy, authorizeRoles('MANAGER', 'PHARMACIST')"
    );
  });

  const runAuthorization = (role, allowedRoles) => {
    const req = {
      user: { userId: 10, pharmacyId: 20, role },
    };
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    const next = jest.fn();

    authorizeRoles(...allowedRoles)(req, res, next);

    return { res, next };
  };

  test('PHARMACIST is denied medication creation and update', () => {
    for (const allowedRoles of [['MANAGER']]) {
      const { res, next } = runAuthorization('PHARMACIST', allowedRoles);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
  });

  test('PHARMACIST is allowed medication deletion', () => {
    const { res, next } = runAuthorization(
      'PHARMACIST',
      ['MANAGER', 'PHARMACIST']
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('STAFF is denied medication deletion', () => {
    const { res, next } = runAuthorization(
      'STAFF',
      ['MANAGER', 'PHARMACIST']
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
