'use strict';
/* Mailbox passwords into the password vault (extension "Passwords") and the new routes. */
const test = require('node:test');
const assert = require('node:assert');
const { MailServerService } = require('../server/mailserver');

test('mailbox password goes into the vault with a stable key; without the extension a clear message', async () => {
  const saved = [];
  const self = { ctx: { passwordVault: { save: async (x) => { saved.push(x); return { id: 'v1', updated: false }; }, status: () => ({ available: true }) } } };
  const inst = { cfg: { hostname: 'mail.example.com', ports: { submission: 587 } } };
  await MailServerService.prototype.toVault.call(self, inst, 'anna@example.com', 'geheim-123');
  assert.deepStrictEqual([saved[0].source, saved[0].key, saved[0].username, saved[0].password, saved[0].url], ['mail-server', 'mailbox:anna@example.com', 'anna@example.com', 'geheim-123', 'imaps://mail.example.com']);
  await assert.rejects(MailServerService.prototype.toVault.call({ ctx: {} }, inst, 'a@b.de', 'x'), (e) => e.status === 409 && /Passwords/.test(e.message));
  assert.deepStrictEqual(MailServerService.prototype.vaultStatus.call(self), { available: true });
  assert.strictEqual(MailServerService.prototype.vaultStatus.call({ ctx: {} }), null);
});

test('routes: delivery check and vault are offered', () => {
  const seen = [];
  const r = new Proxy({}, { get: (_, m) => (p) => seen.push(`${String(m).toUpperCase()} ${p}`) });
  MailServerService.prototype.routes.call({}, r);
  for (const x of ['GET /mailservers/:id/delivery-check', 'POST /mailservers/:id/accounts/:a/vault', 'PUT /mailservers/:id/accounts/:a/password']) assert.ok(seen.includes(x), x);
});
