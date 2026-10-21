'use strict';
/*
 * Sicherungen der Postfächer – in Hostwerks Sicherungs-Zentrale, in der externen Sicherung und zum Umziehen auf einen
 * anderen Rechner. Ein Stand ist ein ZIP des Datenordners eines Mailservers (Stalwart: Datenbank mit allen Postfächern
 * und Mails, DKIM-Schlüssel, Einstellungen; Apache James: conf/ und var/) plus hostwerk-mailserver.json mit der Einrichtung
 * (Software, Domain, Host-Name, Ports, Admin-Zugang – nur verschlüsselt mit dem Schlüssel DIESES Hostwerk).
 *
 *   data/mailserver-backups/<server-id>/<server-id>-<zeit>.zip
 *
 * Zum Packen wird ein laufender Mailserver kurz gestoppt (die Datenbank ist dann in sich stimmig) und gleich wieder
 * gestartet – andere Mailserver liefern in der Zeit zu, die Absender versuchen es von selbst erneut.
 *
 * Sicherungs-Zentrale (SDK 2.10, ctx.backupCenter.register): list / restore / remove / offsite.
 * Umziehen: Hostwerks Umzug („Mehrere Rechner“) kennt Projekte, Datenbanken, Minecraft und Apps – Erweiterungs-Daten nimmt
 * er nicht mit. Deshalb: Stand aus der Liste (oder aus der externen Sicherung, mail-<id>.zip) auf den neuen Rechner
 * kopieren und dort „Von einem anderen Rechner übernehmen“ – importPackage().
 */
const fs = require('fs');
const path = require('path');

const SEP = '~';
const META = 'hostwerk-mailserver.json';
const KEEP = 10;
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/**
 * svc = MailServerService, deps = { t, runJob, zipDir, unzipTo, secrets: { seal, open } } – in Tests nachgebildet.
 */
function mailBackups(svc, deps) {
  const T = deps.t || ((s) => s);
  const err = (status, text, vars) => Object.assign(new Error(T(text, vars)), { status });
  const root = () => path.join(svc.ctx.paths.data, 'mailserver-backups');
  const dirOf = (id) => path.join(root(), id);
  const files = (id) => {
    const d = dirOf(id);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((f) => /\.zip$/.test(f)).map((file) => { const st = fs.statSync(path.join(d, file)); return { file, size: st.size, time: st.mtimeMs }; })
      .sort((a, b) => b.time - a.time || b.file.localeCompare(a.file));
  };
  const parse = (itemId) => {
    const s = String(itemId || '');
    const i = s.indexOf(SEP);
    const id = i > 0 ? s.slice(0, i) : '';
    const file = i > 0 ? s.slice(i + 1) : '';
    if (!/^[\w-]{1,64}$/.test(id) || !file || path.basename(file) !== file || !/\.zip$/.test(file)) throw err(404, 'Backup not found');
    const inst = svc.get(id);
    const full = path.join(dirOf(id), file);
    if (!fs.existsSync(full)) throw err(404, 'Backup not found');
    return { inst, file, full };
  };

  /** Einrichtung, wie sie ins Paket kommt – Admin-Zugang bleibt verschlüsselt (öffnet nur auf diesem Rechner). */
  const metaOf = (inst, c) => ({ hostwerkMailserver: 1, at: Date.now(), dataDir: inst.dataDir(), logDir: inst.logDir(), cfg: { engine: c.engine, name: c.name, domain: c.domain || null, hostname: c.hostname || null, public: !!c.public, autostart: !!c.autostart, ports: c.ports || null, jamesDomains: c.jamesDomains || [], admin: c.admin || null } });

  /** Datenordner packen – ein laufender Server wird dafür kurz gestoppt und danach wieder gestartet. */
  async function pack(inst, dest, job) {
    if (!inst.cfg.configured) throw err(409, 'The mail server is not set up yet.');
    const was = inst.proc.isRunning();
    if (was) { if (job) job.progress(10, T('Stopping {name} briefly …', { name: inst.cfg.name })); await inst.stop(); }
    try {
      fs.mkdirSync(inst.dataDir(), { recursive: true });
      fs.writeFileSync(path.join(inst.dataDir(), META), JSON.stringify(metaOf(inst, inst.cfg), null, 1));
      if (job) job.progress(30, T('Packing the mailboxes …'));
      await deps.zipDir(inst.dataDir(), dest);
      return dest;
    } finally {
      if (was) { if (job) job.progress(85, T('Starting {name} again …', { name: inst.cfg.name })); await inst.start().catch(() => {}); }
    }
  }

  /** Jetzt sichern (Knopf auf der Seite, Aufgaben) – behält die neuesten KEEP Stände. */
  function backupNow(id) {
    const inst = svc.get(id);
    return deps.runJob(T('Back up mail server “{name}”', { name: inst.cfg.name }), async (job) => {
      fs.mkdirSync(dirOf(id), { recursive: true });
      const dest = await pack(inst, path.join(dirOf(id), `${id}-${stamp()}.zip`), job);
      for (const old of files(id).slice(KEEP)) fs.rmSync(path.join(dirOf(id), old.file), { force: true });
      return { ok: true, file: path.basename(dest), text: T('Backup saved: {file}', { file: path.basename(dest) }) };
    }, { key: `mailserver-backup-${id}` });
  }

  /** Zurückspielen: aktuellen Stand vorher sichern, Daten tauschen (der alte Ordner bleibt bis zum Erfolg), Einrichtung übernehmen. */
  function restore(itemId) {
    const { inst, file, full } = parse(itemId);
    const id = inst.id;
    return deps.runJob(T('Restore mail server “{name}”', { name: inst.cfg.name }), async (job) => {
      const was = inst.proc.isRunning();
      if (inst.cfg.configured) {
        job.progress(5, T('Backing up the current state first …'));
        await pack(inst, path.join(dirOf(id), `${id}-${stamp()}-before-restore.zip`), null);
      }
      if (inst.proc.isRunning()) await inst.stop();
      const data = inst.dataDir();
      const old = `${data}.restore-old`;
      fs.rmSync(old, { recursive: true, force: true });
      if (fs.existsSync(data)) fs.renameSync(data, old);
      try {
        job.progress(40, T('Restoring {file} …', { file }));
        await deps.unzipTo(full, data);
        const meta = readMeta(data);
        if (meta) { adoptCfg(inst.cfg, meta.cfg, { keepName: true }); relocate(inst, meta); }
        svc.ctx.settings.save();
      } catch (e) {
        fs.rmSync(data, { recursive: true, force: true });
        if (fs.existsSync(old)) fs.renameSync(old, data);
        throw e;
      }
      fs.rmSync(old, { recursive: true, force: true });
      if (was) { job.progress(85, T('Starting {name} again …', { name: inst.cfg.name })); await inst.start(); }
      return { ok: true, text: T('Restored – the state before is kept as its own backup.') };
    }, { key: `mailserver-restore-${id}` });
  }

  /** Einrichtung aus einem Paket übernehmen (ohne id; Name nur auf Wunsch). */
  function adoptCfg(cfg, from, { keepName = false } = {}) {
    if (!from) return cfg;
    for (const k of ['domain', 'hostname', 'public', 'ports', 'jamesDomains']) if (from[k] !== undefined) cfg[k] = from[k];
    if (!keepName && from.name) cfg.name = from.name;
    if (from.admin && from.admin.secret && deps.secrets.open(from.admin.secret)) cfg.admin = from.admin;
    cfg.configured = true;
    return cfg;
  }
  /**
   * Stalwart (config.json: Datenbank- und Protokoll-Ordner) und James (conf/logback.xml) merken sich absolute Pfade.
   * Auf einem anderen Rechner oder unter anderer Kennung liegen die Ordner woanders – die Pfade werden umgeschrieben.
   */
  function relocate(inst, meta) {
    const pairs = [[meta.dataDir, inst.dataDir()], [meta.logDir, inst.logDir()]].filter(([a, b]) => a && b && a !== b);
    if (!pairs.length) return 0;
    let n = 0;
    for (const rel of ['config.json', path.join('conf', 'logback.xml')]) {
      const f = path.join(inst.dataDir(), rel);
      if (!fs.existsSync(f)) continue;
      let text = fs.readFileSync(f, 'utf8');
      const before = text;
      for (const [from, to] of pairs) {
        for (const [a, b] of [[JSON.stringify(from).slice(1, -1), JSON.stringify(to).slice(1, -1)], [from.replace(/\\/g, '/'), to.replace(/\\/g, '/')], [from, to]]) text = text.split(a).join(b);
      }
      if (text !== before) { fs.writeFileSync(f, text); n++; }
    }
    fs.mkdirSync(inst.logDir(), { recursive: true });
    return n;
  }
  function readMeta(dir) {
    try { const m = JSON.parse(fs.readFileSync(path.join(dir, META), 'utf8')); return m && m.hostwerkMailserver && m.cfg ? m : null; } catch { return null; }
  }

  /**
   * Umziehen: Paket eines anderen Rechners als NEUEN Mailserver übernehmen. file = Pfad zum ZIP auf diesem Rechner.
   * Der Admin-Zugang ist mit dem Schlüssel des alten Rechners verschlüsselt – Apache James hat ihn auch in conf/,
   * bei Stalwart gibt man das Admin-Passwort vom alten Rechner ein (dort: „Admin-Zugang“).
   */
  function importPackage({ file, adminPassword } = {}) {
    const f = String(file || '').trim().replace(/^"|"$/g, '');
    if (!f || !/\.zip$/i.test(f)) throw err(400, 'Choose the ZIP file of the mail server (e.g. mail-mailserver.zip from the off-site backup).');
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw err(404, 'The file does not exist: {file}', { file: f });
    return deps.runJob(T('Take over mail server from another computer'), async (job) => {
      const tmp = path.join(root(), `import-${Date.now()}`);
      fs.rmSync(tmp, { recursive: true, force: true });
      try {
        job.progress(10, T('Unpacking …'));
        await deps.unzipTo(f, tmp);
        const meta = readMeta(tmp);
        if (!meta) throw err(400, 'This ZIP is not a mail server backup from Hostwerk.');
        const c = meta.cfg;
        let secret = c.admin && c.admin.secret && deps.secrets.open(c.admin.secret) ? c.admin.secret : null;
        if (!secret && c.engine === 'james') {
          const m = /^password=(.+)$/m.exec((() => { try { return fs.readFileSync(path.join(tmp, 'conf', 'webadmin.properties'), 'utf8'); } catch { return ''; } })());
          if (m) secret = deps.secrets.seal(m[1].trim());
        }
        if (!secret && adminPassword) secret = deps.secrets.seal(String(adminPassword));
        if (!secret) throw err(400, 'Enter the admin password of the old computer (there: mail server → Admin access).');
        const info = svc.create({ engine: c.engine, name: c.name });
        const inst = svc.get(info.id);
        const used = svc.reserved(inst.id);
        const clash = Object.values(c.ports || {}).filter((p) => used.includes(p));
        job.progress(50, T('Moving the mailboxes into place …'));
        fs.rmSync(inst.dataDir(), { recursive: true, force: true });
        fs.mkdirSync(path.dirname(inst.dataDir()), { recursive: true });
        fs.renameSync(tmp, inst.dataDir());
        adoptCfg(inst.cfg, { ...c, admin: { user: (c.admin && c.admin.user) || 'admin', secret } });
        inst.cfg.autostart = false;
        relocate(inst, meta);
        svc.ctx.settings.save();
        if (!inst.impl.installed(svc)) { job.progress(60, T('Installing {engine} …', { engine: c.engine === 'james' ? 'Apache James' : 'Stalwart' })); await inst.impl.install(svc, job); }
        return { ok: true, id: inst.id, clash, text: clash.length ? T('Taken over as “{name}” – ports {ports} are also used by another mail server here; stop that one first.', { name: inst.cfg.name, ports: clash.join(', ') }) : T('Taken over as “{name}” – start it when the old computer no longer receives mail.', { name: inst.cfg.name }) };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }, { key: 'mailserver-import' });
  }

  const source = {
    label: { de: 'Postfächer', en: 'Mailboxes' },
    list() {
      const out = [];
      for (const c of svc.list()) {
        for (const b of files(c.id)) out.push({ id: `${c.id}${SEP}${b.file}`, label: b.file.replace(/\.zip$/, ''), t: b.time, size: b.size, auto: false, svc: c.id, svcName: c.name, stopsService: true });
      }
      return out;
    },
    restore,
    remove(itemId) { fs.rmSync(parse(itemId).full, { force: true }); },
    async offsite({ dir, job }) {
      const out = [];
      for (const inst of svc.configured()) {
        try { out.push(await pack(inst, path.join(dir, `mail-${inst.id}.zip`), null)); } catch (e) { if (job && job.log) job.log(`${inst.cfg.name}: ${e.message}`); }
      }
      return out;
    },
  };

  return { source, backupNow, restore, importPackage, list: (id) => files(id), dir: dirOf, pack, relocate };
}

/** Bei Hostwerk anmelden (ab 2.12) – Abmelde-Funktion oder null, wenn Hostwerk es noch nicht kann. */
function registerBackups(host, source) {
  if (host.backups && typeof host.backups.register === 'function') return host.backups.register(source);
  const bc = host.ctx && host.ctx.backupCenter;
  if (bc && typeof bc.register === 'function') return bc.register(host.id, source);
  return null;
}

module.exports = { mailBackups, registerBackups, META };
