'use strict';
/*
 * Postfach-Sicherungen ohne echten Mailserver: Sicherungs-Zentrale (Liste, Zurückspielen mit Sicherung vorher, Löschen,
 * externe Sicherung), „Jetzt sichern“ und das Übernehmen auf einem anderen Rechner (Pfade, Admin-Zugang, Ports).
 * ZIP wird durch eine JSON-Datei mit allen Dateien nachgebildet.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mailBackups, registerBackups, META } = require('../server/backups');

const walk = (d, base = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name))]));
const zipDir = async (src, dest) => { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, JSON.stringify(Object.fromEntries(walk(src).map((f) => [f, fs.readFileSync(path.join(src, f), 'utf8')])))); return dest; };
const unzipTo = async (zip, dir) => { for (const [f, text] of Object.entries(JSON.parse(fs.readFileSync(zip, 'utf8')))) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); } };
const job = () => ({ log() {}, progress() {}, status() {} });
const runJob = (title, fn) => ({ id: 'j', title, promise: fn(job()) });

function machine(name, secretKey) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), `mail-${name}-`));
  const settings = { mailservers: { instances: [] } };
  const items = new Map();
  const calls = [];
  const secrets = { seal: (t) => `enc:${secretKey}:${t}`, open: (v) => (String(v).startsWith(`enc:${secretKey}:`) ? String(v).slice(`enc:${secretKey}:`.length) : '') };
  const svc = {
    ctx: { paths: { data }, settings: { get: () => settings, save: () => calls.push('save') } },
    list: () => settings.mailservers.instances,
    configured: () => [...items.values()].filter((i) => i.cfg.configured),
    get: (id) => { const i = items.get(id); if (!i) throw Object.assign(new Error('Mail server not found'), { status: 404 }); return i; },
    reserved: (except) => settings.mailservers.instances.filter((c) => c.id !== except && c.ports).flatMap((c) => Object.values(c.ports)),
    create({ engine, name }) {
      let id = items.size ? 'mail' : 'mailserver';
      for (let n = 2; items.has(id); n++) id = `mail-${n}`;
      const cfg = { id, engine, name, configured: false, autostart: false };
      settings.mailservers.instances.push(cfg);
      let running = false;
      const inst = {
        id, svc, get cfg() { return settings.mailservers.instances.find((c) => c.id === id); },
        dataDir: () => path.join(data, id === 'mailserver' ? 'mailserver' : `mailserver-${id}`),
        logDir: () => path.join(data, 'logs', id),
        proc: { isRunning: () => running },
        stop: async () => { calls.push(`stop:${id}`); running = false; },
        start: async () => { calls.push(`start:${id}`); running = true; },
        impl: { installed: () => ({ version: '1' }), install: async () => calls.push('install') },
      };
      items.set(id, inst);
      return { id };
    },
  };
  const bk = mailBackups(svc, { t: (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => v[k]) : s), runJob, zipDir, unzipTo, secrets });
  /** Eingerichteter Stalwart-Server mit Datenbank und absolutem Pfad in config.json, läuft */
  const setUp = () => {
    const { id } = svc.create({ engine: 'stalwart', name: 'Mail' });
    const i = svc.get(id);
    Object.assign(i.cfg, { configured: true, domain: 'example.com', hostname: 'mail.example.com', ports: { smtp: 25, http: 8095 }, admin: { user: 'admin', secret: secrets.seal('pw1') } });
    fs.mkdirSync(path.join(i.dataDir(), 'data'), { recursive: true });
    fs.writeFileSync(path.join(i.dataDir(), 'data', 'mails.db'), 'inbox v1');
    fs.writeFileSync(path.join(i.dataDir(), 'config.json'), JSON.stringify({ dataStore: { path: path.join(i.dataDir(), 'data') }, tracer: { path: i.logDir() } }));
    i.start();
    calls.length = 0;
    return i;
  };
  return { svc, bk, calls, setUp, secrets, data };
}

test('back up now: stops the running server briefly, packs data and setup, starts again', async () => {
  const m = machine('a', 'k1');
  const i = m.setUp();
  const r = await m.bk.backupNow(i.id).promise;
  assert.match(r.file, /^mailserver-\d{8}-\d{6}\.zip$/);
  assert.deepStrictEqual(m.calls, ['stop:mailserver', 'start:mailserver']);
  const z = JSON.parse(fs.readFileSync(path.join(m.bk.dir(i.id), r.file), 'utf8'));
  assert.strictEqual(z[path.join('data', 'mails.db')], 'inbox v1');
  const meta = JSON.parse(z[META]);
  assert.strictEqual(meta.cfg.domain, 'example.com'); assert.match(meta.cfg.admin.secret, /^enc:k1:/, 'admin access stays encrypted');
});

test('backup centre: list, restore with a backup of the current state first, remove', async () => {
  const m = machine('b', 'k1');
  const i = m.setUp();
  const first = (await m.bk.backupNow(i.id).promise).file;
  fs.writeFileSync(path.join(i.dataDir(), 'data', 'mails.db'), 'inbox v2');
  const items = m.bk.source.list();
  assert.deepStrictEqual(items.map((x) => [x.id, x.svc, x.svcName, x.stopsService]), [[`mailserver~${first}`, 'mailserver', 'Mail', true]]);
  m.calls.length = 0;
  const r = await m.bk.source.restore(`mailserver~${first}`).promise;
  assert.strictEqual(r.ok, true);
  assert.strictEqual(fs.readFileSync(path.join(i.dataDir(), 'data', 'mails.db'), 'utf8'), 'inbox v1');
  assert.strictEqual(i.proc.isRunning(), true, 'running again afterwards');
  const before = m.bk.list(i.id).find((b) => /before-restore/.test(b.file));
  assert.ok(before, 'the state before is its own backup');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(m.bk.dir(i.id), before.file), 'utf8'))[path.join('data', 'mails.db')], 'inbox v2');
  assert.strictEqual(fs.existsSync(`${i.dataDir()}.restore-old`), false);
  m.bk.source.remove(`mailserver~${first}`);
  assert.strictEqual(m.bk.list(i.id).some((b) => b.file === first), false);
  for (const bad of ['mailserver~../x.zip', 'mailserver~nope.zip', 'other~a.zip', 'mailserver']) assert.throws(() => m.bk.source.remove(bad), (e) => e.status === 404, bad);
});

test('restore: a broken package leaves the old data in place', async () => {
  const m = machine('c', 'k1');
  const i = m.setUp();
  fs.mkdirSync(m.bk.dir(i.id), { recursive: true });
  fs.writeFileSync(path.join(m.bk.dir(i.id), 'mailserver-broken.zip'), 'not json');
  await assert.rejects(m.bk.source.restore('mailserver~mailserver-broken.zip').promise);
  assert.strictEqual(fs.readFileSync(path.join(i.dataDir(), 'data', 'mails.db'), 'utf8'), 'inbox v1');
});

test('off-site: one package per set-up server', async () => {
  const m = machine('d', 'k1');
  m.setUp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-off-'));
  const files = await m.bk.source.offsite({ dir, job: job() });
  assert.deepStrictEqual(files.map((f) => path.basename(f)), ['mail-mailserver.zip']);
});

test('move: package from another computer becomes a new mail server, paths rewritten, admin password asked for', async () => {
  const a = machine('old', 'k1');
  const i = a.setUp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-move-'));
  const [pkg] = await a.bk.source.offsite({ dir, job: job() });
  const b = machine('new', 'k2'); // anderer Schlüssel: der Admin-Zugang lässt sich dort nicht öffnen
  await assert.rejects(b.bk.importPackage({ file: pkg }).promise, /admin password of the old computer/);
  assert.strictEqual(b.svc.list().length, 0, 'nothing half created');
  const r = await b.bk.importPackage({ file: pkg, adminPassword: 'pw1' }).promise;
  const n = b.svc.get(r.id);
  assert.strictEqual(n.cfg.configured, true); assert.strictEqual(n.cfg.domain, 'example.com'); assert.strictEqual(n.cfg.autostart, false);
  assert.strictEqual(b.secrets.open(n.cfg.admin.secret), 'pw1');
  assert.strictEqual(fs.readFileSync(path.join(n.dataDir(), 'data', 'mails.db'), 'utf8'), 'inbox v1');
  const conf = JSON.parse(fs.readFileSync(path.join(n.dataDir(), 'config.json'), 'utf8'));
  assert.strictEqual(conf.dataStore.path, path.join(n.dataDir(), 'data')); assert.strictEqual(conf.tracer.path, n.logDir());
  assert.notStrictEqual(conf.dataStore.path, path.join(i.dataDir(), 'data'));
  assert.deepStrictEqual(r.clash, []);
  assert.throws(() => b.bk.importPackage({ file: path.join(dir, 'missing.zip') }), (e) => e.status === 404);
  assert.throws(() => b.bk.importPackage({ file: 'x.txt' }), (e) => e.status === 400);
});

test('register: host.backups (Hostwerk 2.12+), else ctx.backupCenter, else nothing', () => {
  const off = () => {};
  assert.strictEqual(registerBackups({ backups: { register: () => off } }, {}), off);
  let seen = null;
  registerBackups({ id: 'mail-server', ctx: { backupCenter: { register: (id) => { seen = id; return off; } } } }, {});
  assert.strictEqual(seen, 'mail-server');
  assert.strictEqual(registerBackups({ ctx: {} }, {}), null);
});
