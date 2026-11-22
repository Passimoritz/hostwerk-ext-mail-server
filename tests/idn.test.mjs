/* Umlaut domains: stored as Punycode, shown as typed (ui/src/idn.js). */
import test from 'node:test';
import assert from 'node:assert';
import url from 'node:url';
import { showDomain } from '../ui/src/idn.js';

test('Punycode domains and addresses are shown in Unicode, others stay', () => {
  for (const d of ['müller.de', 'bücher.example.com', '例え.テスト', 'mail.straße.de']) assert.strictEqual(showDomain(url.domainToASCII(d)), d);
  assert.strictEqual(showDomain('info@xn--mller-kva.de'), 'info@müller.de');
  assert.strictEqual(showDomain('plain.example.com'), 'plain.example.com');
  assert.strictEqual(showDomain(''), '');
  assert.strictEqual(showDomain(null), '');
  assert.strictEqual(showDomain('xn--'), 'xn--', 'broken labels stay as they are');
});
