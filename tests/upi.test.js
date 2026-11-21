import test from 'node:test';
import assert from 'node:assert/strict';
import { validUpi, upiLinks, upiCurrency, normalizeUpi } from '../js/upi.js';

test('UPI IDs are validated and normalised', () => {
  for (const ok of ['asha@okhdfcbank', 'raju.k-12@ybl', ' Asha@Paytm ', '9876543210@upi']) assert.ok(validUpi(ok), ok);
  for (const bad of ['', 'asha', '@ybl', 'a@b', 'asha@', 'as ha@ybl', 'asha@@ybl', 'asha@yb/l', 'upi://pay?pa=x@y']) assert.ok(!validUpi(bad), bad);
  assert.equal(normalizeUpi(' Asha@Paytm '), 'asha@paytm');
});
test('UPI links carry payee, exact amount and an encoded note', () => {
  const l = upiLinks({ vpa: 'Asha@ybl', name: 'Asha K', amount: 12550, note: 'Chaikadi · Chai Gang' });
  assert.equal(l.generic, 'upi://pay?pa=asha@ybl&pn=Asha%20K&am=125.50&cu=INR&tn=Chaikadi%20%C2%B7%20Chai%20Gang');
  assert.deepEqual(l.apps.map(a => a.id), ['gpay', 'phonepe', 'paytm']);
  assert.ok(l.apps.every(a => a.href.includes('pa=asha@ybl&') && a.href.includes('am=125.50')));
  assert.equal(upiLinks({ vpa: 'asha@ybl', amount: 5 }).generic, 'upi://pay?pa=asha@ybl&am=0.05&cu=INR');
});
test('no link for a bad id or a non-positive amount', () => {
  assert.equal(upiLinks({ vpa: 'nope', amount: 100 }), null);
  assert.equal(upiLinks({ vpa: 'a1@ybl', amount: 0 }), null);
  assert.equal(upiLinks({ vpa: 'a1@ybl', amount: 1.5 }), null);
});
test('UPI is offered only for rupee groups', () => {
  for (const c of ['Rs', '₹', 'INR', 'rs.']) assert.ok(upiCurrency(c), c);
  for (const c of ['$', '€', 'AED']) assert.ok(!upiCurrency(c), c);
});

import { parseUpiQr } from '../js/upi.js';
test('a scanned UPI QR yields the payee ID and name, and nothing else is accepted', () => {
  assert.deepEqual(parseUpiQr('upi://pay?pa=Raju.K@okaxis&pn=Raju%20Kumar&cu=INR'), { upi: 'raju.k@okaxis', name: 'Raju Kumar' });
  assert.deepEqual(parseUpiQr('upi://pay?pa=a1@ybl'), { upi: 'a1@ybl', name: '' });
  assert.deepEqual(parseUpiQr(' UPI://pay?pn=Anu+K&pa=anu@ybl '), { upi: 'anu@ybl', name: 'Anu K' });
  for (const bad of ['', null, 'https://chaikadi.fyi/?room=ABCD', 'raju@okaxis', 'upi://pay?pn=Raju', 'upi://pay?pa=bad', 'upi://pay?pa=a1@ybl&am=50', 'upi://pay?pa=%E0%A4%A@ybl'])
    assert.equal(parseUpiQr(bad), null, String(bad));
});
