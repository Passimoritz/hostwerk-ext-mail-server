'use strict';
/*
 * Mail server without real engines: zone file parsing (records, purposes, required), engine descriptions, creating and
 * removing instances with ports that never clash, German messages. The real engines are tested by Hostwerk's
 * scripts/mailserver-test.js (needs Stalwart/James binaries).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MailServerService, parseZone, ENGINES } = require('../server/mailserver');
const de = require('../locales/de.json');

const fill = (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)) : s);

function fakeHost(lang = 'en') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-mail-'));
  const S = { general: { language: lang } };
  const registry = new Map();
  class ManagedProcess { constructor(id, name) { this.id = id; this.name = name; this.state = 'stopped'; registry.set(id, this); } info() { return { id: this.id, state: this.state }; } isRunning() { return this.state === 'running'; } }
  const core = {
    proc: { ManagedProcess, registry },
    download: { fetchJson: async () => [], downloadFile: async () => {}, extractZip: async () => {}, jobProgress: () => () => {}, cmpVersion: (a, b) => String(a).localeCompare(String(b)) },
    jobs: { runJob: () => ({ id: 'j' }), registerResumer: () => {} },
    sac: { probe: async () => ({ ok: true, output: '' }), BLOCK_HINT: '' },
    ports: { isPortFree: async (p) => p !== 2525, findFreePort: async (start, used) => { let p = start; while (used.includes(p) || p === 2525) p++; return p; }, waitForPort: async () => {} },
    platform: { IS_WIN: true, exe: (x) => `${x}.exe`, elevated: async () => 0 },
    secrets: { seal: (x) => x, open: (x) => x },
    'smtp-client': { sendRaw: async () => {} },
  };
  return { S, ctx: { settings: { get: () => S, save: () => {} }, paths: { data: dir, logs: dir, bin: dir, cache: dir } }, core: (n) => core[n], t: (s, v) => fill(lang === 'de' && de[s] ? de[s] : s, v) };
}

test('zone file → records with purposes and required ones', () => {
  const zone = [
    'example.com. IN MX 10 mail.example.com.',
    'example.com. IN TXT "v=spf1 mx -all"',
    'hostwerk._domainkey.example.com. IN TXT ( "v=DKIM1; k=rsa; "',
    '  "p=ABC" )',
    '_dmarc.example.com. IN TXT "v=DMARC1; p=quarantine"',
    'autoconfig.example.com. IN CNAME mail.example.com.',
  ].join('\n');
  const r = parseZone(zone);
  assert.strictEqual(r.length, 5);
  assert.deepStrictEqual(r.filter((x) => x.required).map((x) => x.purpose).sort(), ['Policy (DMARC)', 'Receiving (MX)', 'Sender (SPF)', 'Signature (DKIM)']);
  assert.strictEqual(r.find((x) => x.type === 'TXT' && /DKIM1/.test(x.value)).value, 'v=DKIM1; k=rsa; p=ABC', 'multi-line TXT joined');
  assert.strictEqual(r.find((x) => x.type === 'CNAME').purpose, 'Automatic setup');
  for (const x of r) if (x.purpose) assert.ok(de[x.purpose], `German for ${x.purpose}`);
});

test('engines: texts have German', () => {
  for (const e of Object.values(ENGINES)) {
    for (const s of [e.text, ...e.pros, ...e.cons]) assert.ok(de[s], `German missing: ${s}`);
  }
});

test('instances: create, unique ids, ports never clash, remove', async () => {
  const h = fakeHost('en');
  const svc = new MailServerService(h);
  assert.deepStrictEqual(svc.list(), []);
  const a = svc.create({ engine: 'stalwart', name: '' });
  assert.strictEqual(a.id, 'mailserver');
  assert.strictEqual(a.name, 'Mail server');
  const b = svc.create({ engine: 'james', name: 'Club' });
  assert.strictEqual(b.id, 'club');
  assert.throws(() => svc.create({ engine: 'exim' }), /Unknown mail server software/);
  const logs = [];
  const job = { log: (l) => logs.push(l) };
  svc.list()[0].ports = await svc.allocPorts('mailserver', { smtp: { label: 'SMTP (receiving)', std: 25, alt: 2525 } }, false, job);
  assert.notStrictEqual(svc.list()[0].ports.smtp, 2525, 'taken port avoided');
  assert.match(logs[0], /Port 2525 \(SMTP \(receiving\)\) is taken/);
  const second = await svc.allocPorts('club', { smtp: { label: 'SMTP (receiving)', std: 25, alt: 2525 } }, false, job);
  assert.notStrictEqual(second.smtp, svc.list()[0].ports.smtp, 'other instance keeps its port');
  await svc.remove('club');
  assert.strictEqual(svc.list().length, 1);
  assert.strictEqual(h.S.mailservers.instances.length, 1, 'data in settings.mailservers as before');
});

test('older single setting is taken over, messages in German', () => {
  const h = fakeHost('de');
  h.S.mailserver = { configured: true, domain: 'example.com', ports: { http: 8095 } };
  const svc = new MailServerService(h);
  assert.strictEqual(svc.list()[0].id, 'mailserver');
  assert.strictEqual(svc.list()[0].name, 'Mailserver');
  assert.ok(!h.S.mailserver);
  assert.throws(() => svc.setup('mailserver', { domain: 'x' }), /gültige Domain/);
  assert.throws(() => svc.get('nope'), /Mailserver nicht gefunden/);
});

test('every German text has a value', () => {
  for (const [k, v] of Object.entries(de)) if (k !== '$patterns') assert.ok(typeof v === 'string' && v.trim(), k);
});

test('Stalwart registers with Hostwerk security updates: same series only, trial run, fallback', async () => {
  const { patchSource, IMPL } = require('../server/mailserver');
  const h = fakeHost();
  const svc = new MailServerService(h);
  svc.create({ engine: 'stalwart', name: 'Mail' });
  const root = path.join(h.ctx.paths.bin, 'stalwart');
  const put = (v) => { fs.mkdirSync(path.join(root, v), { recursive: true }); fs.writeFileSync(path.join(root, v, 'stalwart.exe'), ''); };
  put('0.13.4');
  const st = IMPL.stalwart;
  const orig = { releases: st.releases, download: st.download, probeSetup: st.probeSetup };
  const keeper = { good: null, data: {}, entry(k) { return this.data[k] || (this.data[k] = { bad: [] }); }, setGood(k, v) { this.good = v; }, save() {} };
  h.ctx.keeper = keeper;
  try {
    st.releases = async () => [{ version: '0.14.0' }, { version: '0.13.5', name: 'x.zip', size: 1 }, { version: '0.13.4' }];
    st.download = async (s, rel) => { put(rel.version); return path.join(root, rel.version); };
    const src = patchSource(svc);
    assert.deepStrictEqual(src.items(), [{ key: 'stalwart', label: 'Stalwart', version: '0.13.4' }]);
    const [u] = await src.updates();
    assert.strictEqual(u.latest, '0.13.5', 'no jump to 0.14');
    // trial run passes → older folder removed, version remembered as good
    st.probeSetup = async () => {};
    let p = src.plan(u);
    await p.install(); await p.probe(); await p.activate();
    assert.ok(!fs.existsSync(path.join(root, '0.13.4')) && fs.existsSync(path.join(root, '0.13.5')));
    assert.strictEqual(keeper.good, '0.13.5');
    // trial run fails → new folder goes, version skipped for new setups too
    st.releases = async () => [{ version: '0.13.6', name: 'x.zip', size: 1 }];
    const [u2] = await src.updates();
    st.probeSetup = async () => { throw new Error('bootstrap refused'); };
    p = src.plan(u2);
    await p.install();
    await assert.rejects(p.probe(), /bootstrap refused/);
    await p.discard();
    assert.ok(!fs.existsSync(path.join(root, '0.13.6')));
    assert.deepStrictEqual(keeper.data.stalwart.bad, ['0.13.6']);
  } finally { Object.assign(st, orig); }
});

test('activate registers the update source and removes it on shutdown', () => {
  const h = fakeHost();
  const hooks = {}; const reg = [];
  const host = { ...h, provide: () => {}, router: { get() {}, post() {}, put() {}, delete() {}, use() {} }, on: (ev, fn) => { (hooks[ev] = hooks[ev] || []).push(fn); } };
  host.ctx.patchUpdates = { register: (id, def) => { reg.push(id); assert.strictEqual(typeof def.updates, 'function'); assert.strictEqual(typeof def.plan, 'function'); return () => reg.splice(reg.indexOf(id), 1); } };
  require('../server/index').activate(host);
  assert.deepStrictEqual(reg, ['mail-server']);
  for (const fn of hooks.shutdown) fn();
  assert.deepStrictEqual(reg, []);
});
