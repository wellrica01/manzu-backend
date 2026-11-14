// tests/audit-redaction.test.js
// Proves the security guarantee: the audit row never carries a secret.
// Pure Node, no database.

const { redactFor, scrubSecrets } = require('../src/core/audit/redact');
const { REDACT } = require('../src/core/audit/catalogue');

describe('audit redaction', () => {
  describe('accountNumber is derived to last-4, never stored raw', () => {
    it('BANKING_UPDATED drops the raw number and keeps last 4', () => {
      const r = redactFor(
        'BANKING_UPDATED',
        { accountNumber: '1234567890' },
        { accountNumber: '9876543210', bankCode: '058', accountName: 'A B C' }
      );
      expect(r.before).toEqual({ accountNumberLast4: '7890' });
      expect(r.after).toEqual({
        bankCode: '058',
        accountName: 'A B C',
        accountNumberLast4: '3210',
      });
      expect(JSON.stringify(r)).not.toMatch(/1234567890/);
      expect(JSON.stringify(r)).not.toMatch(/9876543210/);
    });

    it('short accountNumber does not crash and is not stored', () => {
      const r = redactFor('BANKING_VERIFIED', null, { accountNumber: '123', verified: true });
      // last4() returns null when length < 4, so only verified survives
      expect(r.after).toEqual({ verified: true });
      expect(JSON.stringify(r)).not.toMatch(/123/);
    });
  });

  describe('secrets are dropped at any depth', () => {
    it('scrubSecrets removes pin/password/token/mfaSecret recursively', () => {
      const input = {
        pin: '9999',
        nested: {
          password: 'hunter2',
          deeper: { token: 'abc.def.ghi', mfaSecret: 'JBSWY3DPEHPK3PXP' },
        },
        keep: 'ok',
      };
      const out = scrubSecrets(input, 0);
      expect(out.keep).toBe('ok');
      expect(out.pin).toBeUndefined();
      expect(out.nested.password).toBeUndefined();
      expect(out.nested.deeper.token).toBeUndefined();
      expect(out.nested.deeper.mfaSecret).toBeUndefined();
      expect(JSON.stringify(out)).not.toMatch(/9999|hunter2|abc\.def\.ghi|JBSWY3DPEHPK3PXP/);
    });
  });

  describe('allow-list filters what is not named', () => {
    it('ORDER_UPDATED only keeps status', () => {
      const r = redactFor(
        'ORDER_UPDATED',
        { status: 'PENDING', secretField: 'x' },
        { status: 'ACCEPTED', totalPrice: 5000, customerEmail: 'a@b.c' }
      );
      expect(r.before).toEqual({ status: 'PENDING' });
      expect(r.after).toEqual({ status: 'ACCEPTED' });
      expect(JSON.stringify(r)).not.toMatch(/totalPrice|customerEmail|secretField/);
    });
  });

  describe('unknown actions get the safe default', () => {
    it('an action with no REDACT entry still drops secrets', () => {
      expect(REDACT['SOMETHING_NEW']).toBeUndefined();
      const r = redactFor('SOMETHING_NEW', null, { status: 'ok', pin: '1111', token: 't' });
      // No allow-list -> both sides undefined; the raw input never leaves.
      expect(r.before).toBeUndefined();
      expect(r.after).toBeUndefined();
    });

    it('allow-listed fields are scrubbed even when a secret key sneaks in', () => {
      // Simulate a route passing the wrong field name; still safe.
      const r = redactFor('ADMIN_ACTION', null, { targetType: 'PharmacyUser', targetId: '7', password: 'x' });
      expect(r.after).toEqual({ targetType: 'PharmacyUser', targetId: '7' });
    });
  });
});