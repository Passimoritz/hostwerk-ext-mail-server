'use strict';
/*
 * DNS-Einträge per Klick: Umwandlung in die Form der DNS-Erweiterung, Vorschau mit „steht schon da“, nur Gewähltes setzen,
 * Prüfen – und ohne DNS-Erweiterung ein klarer Hinweis statt eines Fehlers.
 */
const test = require('node:test');
const assert = require('node:assert');
const { dnsAuto, toDns, same } = require('../server/dnsauto');

const RECORDS = [
  { name: 'example.com', type: 'MX', value: '10 mail.example.com.', purpose: 'Receiving (MX)', required: true },
  { name: 'example.com', type: 'TXT', value: 'v=spf1 mx -all', purpose: 'Sender (SPF)', required: true },
  { name: 'hostwerk._domainkey.example.com', type: 'TXT', value: '"v=DKIM1; k=rsa; " "p=ABC"', purpose: 'Signature (DKIM)', required: true },
  { name: '_dmarc.example.com', type: 'TXT', value: 'v=DMARC1; p=quarantine', purpose: 'Policy (DMARC)', required: true },
  { name: '_imaps._tcp.example.com.', type: 'SRV', value: '0 1 993 mail.example.com.', purpose: 'Service (SRV)', required: false },
  { name: 'example.com', type: 'TLSA', value: '3 1 1 abc', purpose: '', required: false },
];
const svc = { domains: async () => [{ id: 'example.com', name: 'example.com', records: RECORDS }, { id: 'other.org', name: 'other.org', records: [{ name: 'other.org', type: 'TXT', value: 'v=spf1 mx -all' }] }] };

function fakeDns() {
  const zone = [
    { id: '1', name: 'example.com', type: 'MX', content: 'mail.example.com', priority: 10 },
    { id: '2', name: 'example.com', type: 'TXT', content: 'v=spf1 a -all' },
  ];
  const applied = [];
  return {
    applied,
    records: async (name) => { if (name === 'other.org') throw new Error('No DNS account has the zone other.org'); return zone; },
    apply: async (list) => { applied.push(...list); return list.map(() => ({ action: 'created' })); },
    verify: async (r) => ({ ok: r.type === 'MX', some: r.type !== 'TXT' }),
  };
}

test('toDns: MX/SRV priority apart, TXT without quotes, unknown types left out', () => {
  assert.deepStrictEqual(toDns(RECORDS[0]), { name: 'example.com', type: 'MX', purpose: 'Receiving (MX)', required: true, ttl: 3600, content: 'mail.example.com', priority: 10 });
  assert.strictEqual(toDns(RECORDS[2]).content, 'v=DKIM1; k=rsa; p=ABC');
  assert.deepStrictEqual([toDns(RECORDS[4]).content, toDns(RECORDS[4]).priority, toDns(RECORDS[4]).name], ['1 993 mail.example.com', 0, '_imaps._tcp.example.com']);
  assert.strictEqual(toDns(RECORDS[5]), null);
  assert.ok(same({ name: 'Example.com.', type: 'txt', content: '"v=spf1  mx -all"' }, toDns(RECORDS[1])));
  assert.ok(!same({ name: 'example.com', type: 'MX', content: 'mail.example.com', priority: 20 }, toDns(RECORDS[0])));
});

test('preview: what is already there, domains without a DNS account marked', async () => {
  const dns = fakeDns();
  const p = await dnsAuto(svc, async () => dns).preview('mailserver');
  assert.strictEqual(p.available, true);
  const ex = p.domains[0];
  assert.deepStrictEqual(ex.records.map((r) => [r.type, r.present]), [['MX', true], ['TXT', false], ['TXT', false], ['TXT', false], ['SRV', false]]);
  assert.strictEqual(p.domains[1].zone, false); assert.match(p.domains[1].error, /No DNS account/);
  assert.strictEqual(p.domains[1].records[0].present, null);
});

test('apply: only the chosen records of domains with a DNS account', async () => {
  const dns = fakeDns();
  const a = dnsAuto(svc, async () => dns);
  const p = await a.preview('mailserver');
  const spf = p.domains[0].records[1].key;
  const other = p.domains[1].records[0].key;
  const r = await a.apply('mailserver', [spf, other, 'TXT|evil.com|v=spf1 +all']);
  assert.deepStrictEqual(dns.applied, [{ name: 'example.com', type: 'TXT', content: 'v=spf1 mx -all', ttl: 3600 }]);
  assert.deepStrictEqual(r.results, [{ key: spf, action: 'created', error: null }]);
  await assert.rejects(a.apply('mailserver', []), (e) => e.status === 400);
});

test('verify: per record, all or the chosen', async () => {
  const a = dnsAuto(svc, async () => fakeDns());
  const r = await a.verify('mailserver');
  assert.strictEqual(r.results.length, 6);
  assert.deepStrictEqual(r.results.slice(0, 2).map((x) => [x.ok, x.some]), [[true, true], [false, false]]);
});

test('without the DNS extension: a hint, no error on preview; apply/verify say what to install', async () => {
  for (const getDns of [async () => null, async () => { throw Object.assign(new Error('No extension offers "dns"'), { status: 404 }); }]) {
    const a = dnsAuto(svc, getDns);
    assert.deepStrictEqual(await a.preview('x'), { available: false, domains: [] });
    await assert.rejects(a.apply('x', ['k']), (e) => e.status === 409 && /DNS management/.test(e.message));
    await assert.rejects(a.verify('x'), (e) => e.status === 409);
  }
});
