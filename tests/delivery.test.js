'use strict';
/* Will mail arrive? Port 25 out, reverse DNS, blacklists – with a fake DNS and fake connections (nothing goes out). */
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const D = require('../server/delivery');

/** A fake socket that answers like an SMTP server (or not). */
const fakeConnect = (behaviour) => ({ host }) => {
  const s = new EventEmitter();
  s.setTimeout = (ms, fn) => { if (behaviour[host] === 'timeout') setImmediate(fn); };
  s.write = () => {}; s.destroy = () => {};
  setImmediate(() => {
    const b = behaviour[host];
    if (b === 'open') s.emit('data', '220 mx.example ESMTP ready\r\n');
    else if (b === 'refused') s.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
    else if (b === 'busy') s.emit('data', '554 no service\r\n');
  });
  return s;
};

test('port 25: open as soon as one provider greets with 220, blocked when none does', async () => {
  const open = await D.port25({ hosts: ['a', 'b'], connect: fakeConnect({ a: 'refused', b: 'open' }) });
  assert.deepStrictEqual(open, { open: true, host: 'b' });
  const blocked = await D.port25({ hosts: ['a', 'b'], connect: fakeConnect({ a: 'timeout', b: 'busy' }) });
  assert.strictEqual(blocked.open, false);
  assert.match(blocked.error, /554/);
});

const fakeDns = (map) => ({
  resolve4: async (n) => { if (map[n]) return map[n]; throw Object.assign(new Error('nf'), { code: 'ENOTFOUND' }); },
  reverse: async (ip) => { if (map[`ptr:${ip}`]) return map[`ptr:${ip}`]; throw Object.assign(new Error('nf'), { code: 'ENOTFOUND' }); },
});

test('reverse DNS: PTR must name the mail host and the host must point back', async () => {
  const dns = fakeDns({ 'mail.example.com': ['203.0.113.5'], 'ptr:203.0.113.5': ['mail.example.com.'] });
  assert.deepStrictEqual(await D.reverseDns('203.0.113.5', 'mail.example.com', { dns }), { ok: true, ptr: ['mail.example.com'], matches: true, forward: true });
  const wrong = await D.reverseDns('203.0.113.5', 'mail.other.org', { dns });
  assert.strictEqual(wrong.ok, false); assert.strictEqual(wrong.matches, false);
  const none = await D.reverseDns('198.51.100.1', 'mail.example.com', { dns });
  assert.deepStrictEqual([none.ok, none.ptr], [false, []]);
  assert.strictEqual((await D.reverseDns(null, 'x', { dns })).error, 'no-address');
});

test('blacklists: listed, clean and "no answer" (public resolver) are told apart', async () => {
  const dns = fakeDns({ '5.113.0.203.zen.spamhaus.org': ['127.0.0.2'], '5.113.0.203.bl.spamcop.net': ['127.255.255.254'] });
  const r = await D.blacklists('203.0.113.5', { dns, lists: D.BLACKLISTS.slice(0, 3) });
  assert.deepStrictEqual(r.map((x) => [x.name, x.listed]), [['Spamhaus ZEN', true], ['SpamCop', null], ['Barracuda', false]]);
  assert.deepStrictEqual(await D.blacklists('not-an-ip', { dns }), []);
});

test('everything together: address from the A record of the host name', async () => {
  const dns = fakeDns({ 'mail.example.com': ['203.0.113.5'], 'ptr:203.0.113.5': ['mail.example.com'] });
  const r = await D.check('mail.example.com', { dns, hosts: ['a'], connect: fakeConnect({ a: 'open' }), lists: [] });
  assert.deepStrictEqual([r.ip, r.port25.open, r.reverseDns.ok], ['203.0.113.5', true, true]);
});
