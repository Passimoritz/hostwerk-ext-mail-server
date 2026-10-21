'use strict';
/*
 * Real mail servers – several in parallel if wanted, each with its own software ("engine"):
 *
 *   stalwart – Stalwart (Rust, one program): SMTP, IMAP, POP3, JMAP, spam filter, DKIM/SPF/DMARC, Let's Encrypt, web admin.
 *              Set up through Stalwart's own flow (bootstrap → recovery mode → normal operation, JMAP administration).
 *   james    – Apache James (Java): SMTP, IMAP, POP3, forwarding/Sieve, administration over REST ("WebAdmin").
 *              The configuration is written by this extension (ports, key store, DKIM signature per domain); Java comes from Hostwerk.
 *
 * Stored in settings.mailservers.instances[] (as before) – the older single setting settings.mailserver is taken over.
 * Hostwerk's mail catcher (development) stays in the core, independent of this.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const { execFile } = require('child_process');
// Hostwerk's core helpers – bound once at start by bindCore(host) (see server/index.js)
let ManagedProcess; let registry; let fetchJson; let downloadFile; let extractZip; let jobProgress; let cmpVersion; let runJob;
let probe; let BLOCK_HINT; let isPortFree; let findFreePort; let waitForPort; let IS_WIN; let X; let elevated; let secrets; let sendRaw;
let T = (text, vars) => (vars ? String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)) : text);
function bindCore(host) {
  ({ ManagedProcess, registry } = host.core('proc'));
  ({ fetchJson, downloadFile, extractZip, jobProgress, cmpVersion } = host.core('download'));
  ({ runJob } = host.core('jobs'));
  ({ probe, BLOCK_HINT } = host.core('sac'));
  ({ isPortFree, findFreePort, waitForPort } = host.core('ports'));
  ({ IS_WIN, exe: X, elevated } = host.core('platform'));
  secrets = host.core('secrets');
  ({ sendRaw } = host.core('smtp-client'));
  if (host.t) T = host.t;
}

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const NAME_RE = /^[a-z0-9._+-]{1,64}$/;
const pwCheck = (pw) => { if (!pw || String(pw).length < 8) throw new Error(T('The password needs at least 8 characters.')); };
const randomPw = () => crypto.randomBytes(18).toString('base64url');

/** Ports: real standard ports (live operation) or alternative ports (testing on the development PC). */
const STALWART_PORTS = {
  smtp: { label: 'SMTP (receiving)', std: 25, alt: 2525, protocol: 'smtp', implicit: false },
  submission: { label: 'Sending (STARTTLS)', std: 587, alt: 5587, protocol: 'smtp', implicit: false },
  submissions: { label: 'Sending (SSL/TLS)', std: 465, alt: 4465, protocol: 'smtp', implicit: true },
  imap: { label: 'IMAP (STARTTLS)', std: 143, alt: 1143, protocol: 'imap', implicit: false },
  imaps: { label: 'IMAP (SSL/TLS)', std: 993, alt: 9993, protocol: 'imap', implicit: true },
  pop3s: { label: 'POP3 (SSL/TLS)', std: 995, alt: 9995, protocol: 'pop3', implicit: true },
  https: { label: 'Webmail/JMAP/Autoconfig (HTTPS)', std: 443, alt: 8443, protocol: 'http', implicit: true },
  http: { label: 'Administration (HTTP, local only)', std: 8095, alt: 8095, protocol: 'http', implicit: false, local: true },
};
const JAMES_PORTS = {
  smtp: { label: 'SMTP (receiving)', std: 25, alt: 2525 },
  submissions: { label: 'Sending (SSL/TLS)', std: 465, alt: 4465 },
  submission: { label: 'Sending (STARTTLS)', std: 587, alt: 5587 },
  imap: { label: 'IMAP (STARTTLS)', std: 143, alt: 1143 },
  imaps: { label: 'IMAP (SSL/TLS)', std: 993, alt: 9993 },
  pop3: { label: 'POP3 (STARTTLS)', std: 110, alt: 1110 },
  http: { label: 'Administration (WebAdmin, local only)', std: 8000, alt: 8000, local: true },
};

/** The engines as described in the interface (the interface translates the texts). */
const ENGINES = {
  stalwart: {
    label: 'Stalwart', lang: 'Rust', platforms: ['win32', 'linux'],
    text: 'Modern all-in-one mail server in a single program – Hostwerk sets up everything including DKIM, spam filter and TLS.',
    pros: ['All in one: SMTP, IMAP, POP3, JMAP, webmail interfaces', 'Spam filter, DKIM, SPF, DMARC and MTA-STS built in', 'Free Let\'s Encrypt certificate at the push of a button', 'Web admin for forwarding, out-of-office, filters', 'Very frugal (Rust, ~50 MB RAM)'],
    cons: ['Younger project – the configuration changes between major versions', 'On Windows, Smart App Control can block new versions'],
    features: { webAdmin: true, letsEncrypt: true, dkim: true, spam: true, jmap: true },
  },
  james: {
    label: 'Apache James', lang: 'Java', platforms: ['win32', 'linux'],
    text: 'Proven mail server of the Apache Software Foundation – runs with Java from Hostwerk, easy to extend with "mailets".',
    pros: ['Developed for over 20 years (Apache Software Foundation)', 'Runs wherever Java runs – no trouble with Smart App Control', 'Very flexible: mailets, Sieve filters, forwarding over a REST API', 'Hostwerk sets up a DKIM signature per domain automatically'],
    cons: ['Needs more memory (Java, ~400–700 MB)', 'No web interface – administration through Hostwerk', 'No built-in spam filter and no Let\'s Encrypt (self-signed certificate)', 'Starts slower (5–15 seconds)'],
    features: { webAdmin: false, letsEncrypt: false, dkim: true, spam: false, jmap: false },
  },
};

/* ====================================================================================== Stalwart */
/*
 * Up to date without breaking: Stalwart is managed through its setup interface (x:Bootstrap, recovery mode). If a new major
 * version changes it, the setup would break. That is why every new version first has to pass a trial run in a test folder
 * (bootstrap with domain and DKIM). If it fails, the next older version is taken and the broken one skipped until a newer one
 * appears (Hostwerk's self-maintenance, key "stalwart").
 */
const stalwart = {
  ports: STALWART_PORTS,
  dir: (svc) => path.join(svc.ctx.paths.bin, 'stalwart'),
  installed(svc) {
    const d = this.dir(svc);
    if (!fs.existsSync(d)) return null;
    const v = fs.readdirSync(d).filter((x) => fs.existsSync(path.join(d, x, X('stalwart')))).sort((a, b) => cmpVersion(b, a))[0];
    return v ? { version: v, exe: path.join(d, v, X('stalwart')) } : null;
  },
  /** Published versions (newest first, no pre-releases) with a package for this system. */
  async releases() {
    const list = await fetchJson('https://api.github.com/repos/stalwartlabs/stalwart/releases?per_page=15');
    const re = IS_WIN ? /^stalwart-x86_64-pc-windows-msvc\.zip$/ : /^stalwart-x86_64-unknown-linux-gnu\.tar\.gz$/;
    return list.filter((r) => !r.prerelease && !r.draft).map((rel) => {
      const a = (rel.assets || []).find((x) => re.test(x.name));
      return a ? { version: rel.tag_name.replace(/^v/, ''), url: a.browser_download_url, size: a.size, name: a.name } : null;
    }).filter(Boolean);
  },
  async latest() {
    const list = await this.releases();
    if (!list.length) throw new Error(T('Stalwart was not found in the release for this system.'));
    return list[0];
  },
  /** Download and unpack one release into its own version folder, then check that the program starts (--version). */
  async download(svc, rel, job) {
    const dir = path.join(this.dir(svc), rel.version);
    const file = path.join(svc.ctx.paths.cache, `${rel.version}-${rel.name}`);
    job.log(`Stalwart ${rel.version} – ${Math.round(rel.size / 1048576)} MB`);
    await downloadFile(rel.url, file, { onProgress: jobProgress(job, T('Downloading Stalwart {v}', { v: rel.version }), 0, 75) });
    job.progress(78, T('Unpacking …'));
    await extractZip(file, dir);
    fs.rmSync(file, { force: true });
    const t = await probe(path.join(dir, X('stalwart')), ['--version']);
    if (!t.ok) throw Object.assign(new Error(t.blocked ? BLOCK_HINT : T('Stalwart does not start: {out}', { out: t.output })), { blocked: t.blocked });
    job.log(`Version ${t.output.trim()}`);
    return dir;
  },
  /** Trial run: can this version be set up the way this extension does it? (bootstrap in a test folder) */
  async probeSetup(svc, exe) {
    const tmp = fs.mkdtempSync(path.join(svc.ctx.paths.cache, 'stalwart-probe-'));
    const port = await findFreePort(18980, []);
    const pw = randomPw();
    const { spawn } = require('child_process');
    const p = spawn(exe, ['-c', path.join(tmp, 'config.json')], { cwd: tmp, env: { ...process.env, STALWART_RECOVERY_ADMIN: `admin:${pw}`, STALWART_RECOVERY_MODE_PORT: String(port), STALWART_HOSTNAME: 'mail.probe.test' }, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out = (out + d).slice(-4000); });
    p.stderr.on('data', (d) => { out = (out + d).slice(-4000); });
    try {
      await waitForPort(port, { timeout: 30000, isAlive: () => p.exitCode == null });
      const r = await this.jmap(`http://127.0.0.1:${port}`, this.basic('admin', pw), [['x:Bootstrap/set', { update: { singleton: {
        serverHostname: 'mail.probe.test', defaultDomain: 'probe.test', requestTlsCertificate: false, generateDkimKeys: true,
        dataStore: { '@type': 'RocksDb', path: path.join(tmp, 'data') },
      } } }, '0']]);
      const body = r[0][1];
      const err = this.setError(body);
      if (err) throw new Error(T('Setup refused: {err}', { err }));
      if (!body.updated || !body.updated.singleton || !body.updated.singleton.secret) throw new Error(T('no admin account reported'));
    } catch (e) {
      throw new Error(`${e.message}${out ? ` – ${out.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-2).join(' ')}` : ''}`);
    } finally {
      await this.killTemp(p);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows holds files for a moment */ }
    }
  },
  /**
   * Install with a trial run: newest version that has not failed a trial run before. If it fails now, the next older one –
   * at most three attempts.
   */
  async install(svc, job) {
    const keeper = svc.ctx.keeper;
    const list = (await this.releases()).filter((r) => !(keeper && keeper.isBad('stalwart', r.version)));
    if (!list.length) throw new Error(T('No suitable Stalwart version found.'));
    let lastErr = null;
    for (const rel of list.slice(0, 3)) {
      const dir = path.join(this.dir(svc), rel.version);
      if (fs.existsSync(path.join(dir, X('stalwart'))) && keeper && keeper.lastGood('stalwart') === rel.version) return { version: rel.version };
      const had = fs.existsSync(path.join(dir, X('stalwart')));
      const run = async () => {
        if (had) return dir; // already there (e.g. installed before self-maintenance) – only check it
        return this.download(svc, rel, job);
      };
      const probeIt = async () => { job.progress(85, T('Trial run: testing the setup …')); await this.probeSetup(svc, path.join(dir, X('stalwart'))); job.log(T('Trial run passed ✓')); };
      // Only clean up versions downloaded right now – one already in use stays
      const discard = async () => { if (!had) fs.rmSync(dir, { recursive: true, force: true }); };
      if (!keeper) { await run(); await probeIt(); return { version: rel.version }; }
      const r = await keeper.attempt('stalwart', { label: T('Mail server (Stalwart)'), version: rel.version, install: run, probe: probeIt, discard });
      if (r.ok) return { version: rel.version };
      lastErr = r.error;
      if (/Smart App Control|blockiert/i.test(lastErr || '')) break; // a block hits every version
      job.log(T('Version {v} does not pass the trial run ({err}) – trying the previous one.', { v: rel.version, err: lastErr }));
    }
    throw new Error(T('Stalwart could not be set up: {err}', { err: lastErr }));
  },
  configFile: (inst) => path.join(inst.dataDir(), 'config.json'),
  runTemp(inst, env) {
    const m = this.installed(inst.svc);
    const { spawn } = require('child_process');
    fs.mkdirSync(inst.dataDir(), { recursive: true });
    const p = spawn(m.exe, ['-c', this.configFile(inst)], { cwd: inst.dataDir(), env: { ...process.env, ...env }, windowsHide: true });
    p.out = '';
    const add = (d) => { p.out += String(d).replace(/\x1b\[[0-9;]*m/g, ''); if (p.out.length > 20000) p.out = p.out.slice(-15000); };
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    return p;
  },
  async killTemp(p) {
    if (!p || p.exitCode != null) return;
    await new Promise((r) => { p.once('exit', r); p.kill(); setTimeout(r, 5000); });
  },
  async jmap(base, auth, calls) {
    const res = await fetch(base + '/jmap/', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'], methodCalls: calls }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (res.status === 401) throw new Error(T('Mail server: sign-in refused (admin access is wrong).'));
    let j;
    try { j = JSON.parse(text); } catch { throw new Error(T('The mail server answers unexpectedly (HTTP {status}): {text}', { status: res.status, text: text.slice(0, 160) })); }
    if (!j.methodResponses) throw new Error(T('Mail server: {msg}', { msg: j.detail || j.title || text.slice(0, 160) }));
    for (const [name, body] of j.methodResponses) if (name === 'error') throw new Error(T('Mail server: {msg}', { msg: body.description || body.type }));
    return j.methodResponses;
  },
  basic: (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
  api(inst, calls) {
    inst.requireRunning();
    return this.jmap(`http://127.0.0.1:${inst.cfg.ports.http}`, this.basic(inst.cfg.admin.user, secrets.open(inst.cfg.admin.secret)), calls);
  },
  setError(body) {
    for (const k of ['notCreated', 'notUpdated', 'notDestroyed']) {
      const e = body[k] && Object.values(body[k])[0];
      if (e) return `${e.description || e.type}${e.properties ? ` (${e.properties.join(', ')})` : ''}`;
    }
    return null;
  },
  async setup(inst, { domain, hostname, isPublic, letsEncrypt }, job) {
    if (!this.installed(inst.svc)) { job.log(T('Installing Stalwart first …')); await this.install(inst.svc, job); }
    const ports = await inst.svc.allocPorts(inst.id, STALWART_PORTS, isPublic, job);
    const used = Object.values(ports);
    // 1) Bootstrap
    const recoveryPort = await findFreePort(18780, used);
    const recoveryPw = randomPw();
    const env = { STALWART_RECOVERY_ADMIN: `admin:${recoveryPw}`, STALWART_RECOVERY_MODE_PORT: String(recoveryPort), STALWART_HOSTNAME: hostname };
    job.progress(20, T('Setting up the mail server (domain, admin, DKIM) …'));
    let p = this.runTemp(inst, env);
    const rb = `http://127.0.0.1:${recoveryPort}`;
    let admin;
    try {
      await waitForPort(recoveryPort, { timeout: 30000, isAlive: () => p.exitCode == null });
      const r = await this.jmap(rb, this.basic('admin', recoveryPw), [['x:Bootstrap/set', { update: { singleton: {
        serverHostname: hostname, defaultDomain: domain, requestTlsCertificate: !!(isPublic && letsEncrypt), generateDkimKeys: true,
        dataStore: { '@type': 'RocksDb', path: path.join(inst.dataDir(), 'data') },
        tracer: { '@type': 'Log', path: inst.logDir(), prefix: 'stalwart', rotate: 'daily', ansi: false, level: 'info', enable: true },
      } } }, '0']]);
      const body = r[0][1];
      const err = this.setError(body);
      if (err) throw new Error(T('Setup refused: {err}', { err }));
      admin = body.updated && body.updated.singleton;
      if (!admin || !admin.secret) throw new Error(T('Stalwart did not report an admin account.'));
      job.log(T('Admin account: {name}', { name: admin.username }));
    } catch (e) {
      job.log(p.out.split('\n').slice(-15).join('\n'));
      throw e;
    } finally { await this.killTemp(p); }

    // 2) Recovery mode: create own listeners
    job.progress(55, T('Setting up ports …'));
    p = this.runTemp(inst, { ...env, STALWART_RECOVERY_MODE: '1' });
    try {
      await waitForPort(recoveryPort, { timeout: 30000, isAlive: () => p.exitCode == null });
      const create = {};
      for (const [name, d] of Object.entries(STALWART_PORTS)) {
        const host = d.local || !isPublic ? '127.0.0.1' : '0.0.0.0';
        create[name] = { name, protocol: d.protocol, bind: { [`${host}:${ports[name]}`]: true }, useTls: name !== 'http', tlsImplicit: d.implicit };
      }
      const r = await this.jmap(rb, this.basic('admin', recoveryPw), [['x:NetworkListener/set', { create }, '1']]);
      const err = this.setError(r[0][1]);
      if (err) throw new Error(T('The ports could not be set: {err}', { err }));
    } catch (e) {
      job.log(p.out.split('\n').slice(-15).join('\n'));
      throw e;
    } finally { await this.killTemp(p); }

    // Linux: ports below 1024 (25, 465, 587, 993 …) need the cap_net_bind_service capability
    if (!IS_WIN && isPublic) {
      job.progress(75, T('Granting the right for mail ports (password prompt) …'));
      const exe = this.installed(inst.svc).exe;
      const code = await elevated('setcap', ['cap_net_bind_service=+ep', exe], (l) => job.log(l));
      if (code !== 0) job.log(T('Note: setcap failed – ports below 1024 cannot be opened then. In a terminal: sudo setcap cap_net_bind_service=+ep {exe}', { exe }));
    }
    return { ports, admin: { user: admin.username, secret: secrets.seal(admin.secret) } };
  },
  spawn(inst) {
    const m = this.installed(inst.svc);
    if (!m) throw new Error(T('Stalwart is not installed.'));
    return { cmd: m.exe, args: ['-c', this.configFile(inst)], cwd: inst.dataDir() };
  },
  async domains(inst) {
    const r = await this.api(inst, [
      ['x:Domain/query', {}, 'q'],
      ['x:Domain/get', { '#ids': { resultOf: 'q', name: 'x:Domain/query', path: '/ids' }, properties: ['id', 'name', 'isEnabled', 'aliases', 'catchAllAddress', 'dnsZoneFile'] }, 'g'],
    ]);
    return (r[1][1].list || []).map((d) => ({ id: d.id, name: d.name, enabled: d.isEnabled !== false, aliases: Object.keys(d.aliases || {}), catchAll: d.catchAllAddress || null, zone: d.dnsZoneFile || '', records: parseZone(d.dnsZoneFile || '') }));
  },
  async addDomain(inst, name) {
    const r = await this.api(inst, [['x:Domain/set', { create: { d: { name, isEnabled: true, dkimManagement: { '@type': 'Automatic' } } } }, '0']]);
    const err = this.setError(r[0][1]);
    if (err) throw new Error(err);
  },
  async removeDomain(inst, id) {
    const destroy = () => this.api(inst, [['x:Domain/set', { destroy: [id] }, '0']]);
    let r = await destroy();
    // The automatically created DKIM keys hang on the domain – remove them first, but never mailboxes silently
    const e = r[0][1].notDestroyed && r[0][1].notDestroyed[id];
    if (e && /objectIsLinked|objectInUse/.test(e.type)) {
      const links = e.linkedObjects || [];
      if (!links.length || links.some((l) => l.object !== 'DkimSignature')) throw new Error(T('The domain still has mailboxes – please delete them first.'));
      const d = await this.api(inst, [['x:DkimSignature/set', { destroy: links.map((l) => l.id) }, '0']]);
      const derr = this.setError(d[0][1]);
      if (derr) throw new Error(derr);
      r = await destroy();
    }
    const err = this.setError(r[0][1]);
    if (err) throw new Error(/objectIsLinked|objectInUse/.test(err) ? T('The domain still has mailboxes – please delete them first.') : err);
  },
  async accounts(inst) {
    const r = await this.api(inst, [
      ['x:Account/query', {}, 'q'],
      ['x:Account/get', { '#ids': { resultOf: 'q', name: 'x:Account/query', path: '/ids' } }, 'g'],
    ]);
    const doms = Object.fromEntries((await this.domains(inst)).map((d) => [d.id, d.name]));
    return (r[1][1].list || []).filter((a) => a['@type'] === 'User' || !a['@type']).map((a) => ({
      id: a.id, name: a.name, email: a.emailAddress || (a.name && doms[a.domainId] ? `${a.name}@${doms[a.domainId]}` : a.name),
      domain: doms[a.domainId] || null, description: a.description || '', admin: a.roles && (a.roles['@type'] === 'Admin' || a.roles === 'Admin'),
      quota: a.quota || null, used: a.usedDiskQuota || 0, aliases: Object.keys(a.aliases || {}),
    }));
  },
  async addAccount(inst, { name, domainId, password, description }) {
    const r = await this.api(inst, [['x:Account/set', { create: { a: { '@type': 'User', name, domainId, ...(description ? { description: String(description) } : {}), credentials: { 0: { '@type': 'Password', secret: String(password) } } } } }, '0']]);
    const err = this.setError(r[0][1]);
    if (err) throw new Error(/primaryKey|exists|duplicate/i.test(err) ? T('This mailbox already exists.') : err);
  },
  async setPassword(inst, id, password) {
    const r = await this.api(inst, [['x:Account/set', { update: { [id]: { credentials: { 0: { '@type': 'Password', secret: String(password) } } } } }, '0']]);
    const err = this.setError(r[0][1]);
    if (err) throw new Error(err);
  },
  async removeAccount(inst, id) {
    const r = await this.api(inst, [['x:Account/set', { destroy: [id] }, '0']]);
    const err = this.setError(r[0][1]);
    if (err) throw new Error(err);
  },
  adminUrl: (inst) => (inst.cfg.ports ? `http://127.0.0.1:${inst.cfg.ports.http}/admin` : null),
};

/* ====================================================================================== Apache James */
const JAMES_FALLBACK = '3.9.1';
const DKIM_SELECTOR = 'hostwerk';
const james = {
  ports: JAMES_PORTS,
  dir: (svc) => path.join(svc.ctx.paths.bin, 'james'),
  installed(svc) {
    const d = this.dir(svc);
    if (!fs.existsSync(d)) return null;
    const v = fs.readdirSync(d).filter((x) => fs.existsSync(path.join(d, x, 'james-server-jpa-app.jar'))).sort((a, b) => cmpVersion(b, a))[0];
    return v ? { version: v, dir: path.join(d, v), jar: path.join(d, v, 'james-server-jpa-app.jar') } : null;
  },
  /** Newest version from the Apache directory (it only holds current releases). */
  async latest() {
    let version = JAMES_FALLBACK;
    try {
      const res = await fetch('https://downloads.apache.org/james/server/', { signal: AbortSignal.timeout(15000) });
      const list = [...(await res.text()).matchAll(/href="(\d+\.\d+\.\d+)\/"/g)].map((m) => m[1]).sort((a, b) => cmpVersion(b, a));
      if (list[0]) version = list[0];
    } catch { /* Fallback */ }
    return { version, url: `https://downloads.apache.org/james/server/${version}/james-server-jpa-guice.zip`, name: `james-server-jpa-guice-${version}.zip` };
  },
  /** Java 21 or newer (from Hostwerk) – if missing, Java 25 is downloaded. */
  async java(svc, job) {
    const j = svc.ctx.services.java;
    const have = j.installed().find((m) => m >= 21);
    return have ? j.exe(have) : j.ensure(25, job, [0, 40]);
  },
  async install(svc, job) {
    await this.java(svc, job);
    const rel = await this.latest();
    const dir = path.join(this.dir(svc), rel.version);
    if (fs.existsSync(path.join(dir, 'james-server-jpa-app.jar'))) return { version: rel.version };
    const file = path.join(svc.ctx.paths.cache, rel.name);
    job.log(T('Downloading Apache James {v} (JPA)', { v: rel.version }));
    await downloadFile(rel.url, file, { onProgress: jobProgress(job, T('Downloading Apache James {v}', { v: rel.version }), 40, 90) });
    job.progress(92, T('Unpacking …'));
    await extractZip(file, dir);
    fs.rmSync(file, { force: true });
    if (!fs.existsSync(path.join(dir, 'james-server-jpa-app.jar'))) throw new Error(T('The James archive has an unexpected layout.'));
    return { version: rel.version };
  },
  conf: (inst, f) => path.join(inst.dataDir(), 'conf', f),
  read(inst, f) { return fs.readFileSync(this.conf(inst, f), 'utf8'); },
  write(inst, f, s) { fs.writeFileSync(this.conf(inst, f), s); },
  /** Replaces the n-th <bind> address of a file. */
  setBinds(s, binds) { let i = 0; return s.replace(/<bind>[^<]*<\/bind>/g, (m) => (i < binds.length ? `<bind>${binds[i++]}</bind>` : m)); },
  keytool(java) { return path.join(path.dirname(java), X('keytool')); },
  async setup(inst, { domain, hostname, isPublic }, job) {
    if (!this.installed(inst.svc)) { job.log(T('Installing Apache James first …')); await this.install(inst.svc, job); }
    const java = await this.java(inst.svc, job);
    const m = this.installed(inst.svc);
    job.progress(45, T('Writing the configuration …'));
    fs.cpSync(path.join(m.dir, 'conf'), path.join(inst.dataDir(), 'conf'), { recursive: true });
    const ports = await inst.svc.allocPorts(inst.id, JAMES_PORTS, isPublic, job);
    const host = isPublic ? '0.0.0.0' : '127.0.0.1';
    const ksPw = randomPw();
    const adminPw = randomPw();
    this.write(inst, 'smtpserver.xml', this.setBinds(this.read(inst, 'smtpserver.xml'), [`${host}:${ports.smtp}`, `${host}:${ports.submissions}`, `${host}:${ports.submission}`])
      .replace(/Apache JAMES awesome SMTP Server/g, `${hostname} ESMTP`));
    this.write(inst, 'imapserver.xml', this.setBinds(this.read(inst, 'imapserver.xml'), [`${host}:${ports.imap}`, `${host}:${ports.imaps}`]));
    this.write(inst, 'pop3server.xml', this.setBinds(this.read(inst, 'pop3server.xml'), [`${host}:${ports.pop3}`])
      .replace('<pop3server enabled="false">', '<pop3server enabled="true">').replace(/(<pop3server[\s\S]*?<tls socketTLS="false" startTLS=)"false"/, '$1"true"'));
    for (const f of ['smtpserver.xml', 'imapserver.xml', 'pop3server.xml', 'managesieveserver.xml', 'lmtpserver.xml']) {
      if (fs.existsSync(this.conf(inst, f))) this.write(inst, f, this.read(inst, f).replace(/james72laBalle/g, ksPw));
    }
    this.write(inst, 'domainlist.xml', this.read(inst, 'domainlist.xml').replace(/<defaultDomain>[^<]*<\/defaultDomain>/, `<defaultDomain>${domain}</defaultDomain>`));
    this.write(inst, 'mailetcontainer.xml', this.read(inst, 'mailetcontainer.xml').replace(/<postmaster>[^<]*<\/postmaster>/, `<postmaster>postmaster@${domain}</postmaster>`));
    this.write(inst, 'webadmin.properties', this.read(inst, 'webadmin.properties')
      .replace(/^port=.*$/m, `port=${ports.http}`).replace(/^host=.*$/m, 'host=localhost')
      .replace(/^password\.generate=.*$/m, 'password.generate=false').replace(/^#?password=.*$/m, `password=${adminPw}`));
    // On Windows JMX needs a password file James cannot create there – WebAdmin is used instead
    this.write(inst, 'jmx.properties', this.read(inst, 'jmx.properties').replace(/^jmx\.enabled=.*$/m, 'jmx.enabled=false'));
    this.write(inst, 'jvm.properties', this.read(inst, 'jvm.properties').replace(/^james\.jmx\.credential\.generation=.*$/m, 'james.jmx.credential.generation=false'));
    const logs = inst.logDir().replace(/\\/g, '/');
    fs.mkdirSync(inst.logDir(), { recursive: true });
    this.write(inst, 'logback.xml', this.read(inst, 'logback.xml').replace(/<file>\/logs\/james\.log<\/file>/, `<file>${logs}/james.log</file>`).replace(/\/logs\/james\.%d/g, `${logs}/james.%d`));

    job.progress(55, T('Creating a certificate for TLS …'));
    await new Promise((resolve, reject) => execFile(this.keytool(java), ['-genkeypair', '-alias', 'james', '-keyalg', 'RSA', '-keysize', '2048', '-storetype', 'PKCS12',
      '-keystore', this.conf(inst, 'keystore'), '-storepass', ksPw, '-keypass', ksPw, '-dname', `CN=${hostname}`, '-ext', `SAN=dns:${hostname},dns:localhost,ip:127.0.0.1`, '-validity', '3650'],
    { windowsHide: true, timeout: 60000 }, (e, out, err) => (e ? reject(new Error(T('The certificate could not be created: {err}', { err: err || e.message }))) : resolve())));
    return { ports, admin: { user: 'WebAdmin', secret: secrets.seal(adminPw) }, after: async () => {
      await this.addDomain(inst, domain, { restart: false });
      await this.writeDkim(inst);
      await inst.svc.restart(inst.id);
    } };
  },
  spawn(inst) {
    const m = this.installed(inst.svc);
    if (!m) throw new Error(T('Apache James is not installed.'));
    const j = inst.svc.ctx.services.java;
    const major = j.installed().find((x) => x >= 21);
    if (!major) throw new Error(T('Java 21 or newer is missing – please set up the mail server again.'));
    const lib = path.join(m.dir, 'james-server-jpa-app.lib');
    const agent = fs.readdirSync(lib).find((f) => /^openjpa-.*\.jar$/.test(f));
    return {
      cmd: j.exe(major), cwd: inst.dataDir(),
      args: ['-Xms128m', '-Xmx768m', ...(agent ? [`-javaagent:${path.join(lib, agent)}`] : []), `-Dworking.directory=${inst.dataDir()}`, '-Djdk.tls.ephemeralDHKeySize=2048',
        `-Dlogback.configurationFile=${this.conf(inst, 'logback.xml')}`, '-Dfile.encoding=UTF-8', '-jar', m.jar],
    };
  },
  async api(inst, method, p, body) {
    inst.requireRunning();
    const res = await fetch(`http://127.0.0.1:${inst.cfg.ports.http}${p}`, {
      method, headers: { Password: secrets.open(inst.cfg.admin.secret), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    if (res.status === 401) throw new Error(T('Mail server: sign-in to the administration refused.'));
    if (res.status >= 400) { let msg = text; try { const j = JSON.parse(text); msg = j.message || j.details || text; } catch { /* plain text */ } throw Object.assign(new Error(T('Mail server: {msg}', { msg: String(msg).slice(0, 200) })), { status: res.status }); }
    try { return text ? JSON.parse(text) : null; } catch { return text; }
  },
  keyFile: (inst, d) => path.join(inst.dataDir(), 'conf', 'dkim', d + '.pem'),
  /** Create a key per domain and rewrite the signing steps in mailetcontainer.xml (takes effect after a restart). */
  async writeDkim(inst) {
    const doms = inst.cfg.jamesDomains || [];
    fs.mkdirSync(path.join(inst.dataDir(), 'conf', 'dkim'), { recursive: true });
    const blocks = [];
    for (const d of doms) {
      const f = this.keyFile(inst, d);
      if (!fs.existsSync(f)) {
        const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
        fs.writeFileSync(f, privateKey);
      }
      const pem = fs.readFileSync(f, 'utf8').trim();
      blocks.push(`            <mailet match="SenderHostIs=${d}" class="org.apache.james.jdkim.mailets.DKIMSign">\n                <signatureTemplate>v=1; s=${DKIM_SELECTOR}; d=${d}; h=from:to:subject:date:message-id:mime-version:content-type; a=rsa-sha256; bh=; b=;</signatureTemplate>\n                <privateKey>\n${pem}\n                </privateKey>\n            </mailet>`);
    }
    const marker = /\s*<!-- hostwerk-dkim -->[\s\S]*?<!-- \/hostwerk-dkim -->/;
    let s = this.read(inst, 'mailetcontainer.xml').replace(marker, '');
    const block = `\n            <!-- hostwerk-dkim -->\n${blocks.join('\n')}\n            <!-- /hostwerk-dkim -->`;
    s = s.replace(/(<processor state="relay"[^>]*>)/, `$1${blocks.length ? block : ''}`);
    this.write(inst, 'mailetcontainer.xml', s);
  },
  dkimRecord(inst, d) {
    const f = this.keyFile(inst, d);
    if (!fs.existsSync(f)) return null;
    const pub = crypto.createPublicKey(fs.readFileSync(f, 'utf8')).export({ type: 'spki', format: 'der' }).toString('base64');
    return `v=DKIM1; k=rsa; p=${pub}`;
  },
  async domains(inst) {
    const list = (await this.api(inst, 'GET', '/domains')) || [];
    const own = list.filter((d) => d !== 'localhost' && DOMAIN_RE.test(d));
    return own.map((d) => {
      const h = inst.cfg.hostname;
      const records = [
        { name: d, type: 'MX', value: `10 ${h}.`, purpose: 'Receiving (MX)', required: true },
        { name: d, type: 'TXT', value: 'v=spf1 mx -all', purpose: 'Sender (SPF)', required: true },
        { name: `_dmarc.${d}`, type: 'TXT', value: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${d}`, purpose: 'Policy (DMARC)', required: true },
      ];
      const dk = this.dkimRecord(inst, d);
      if (dk) records.splice(2, 0, { name: `${DKIM_SELECTOR}._domainkey.${d}`, type: 'TXT', value: dk, purpose: 'Signature (DKIM)', required: true });
      const zone = records.map((r) => `${r.name}. IN ${r.type} ${r.type === 'TXT' ? `"${r.value}"` : r.value}`).join('\n');
      return { id: d, name: d, enabled: true, aliases: [], catchAll: null, zone, records };
    });
  },
  async addDomain(inst, name, { restart = true } = {}) {
    await this.api(inst, 'PUT', `/domains/${encodeURIComponent(name)}`);
    inst.cfg.jamesDomains = [...new Set([...(inst.cfg.jamesDomains || []), name])];
    inst.svc.ctx.settings.save();
    if (restart) { await this.writeDkim(inst); await inst.svc.restart(inst.id); }
  },
  async removeDomain(inst, id) {
    const users = await this.accounts(inst);
    if (users.some((u) => u.domain === id)) throw new Error(T('The domain still has mailboxes – please delete them first.'));
    await this.api(inst, 'DELETE', `/domains/${encodeURIComponent(id)}`);
    inst.cfg.jamesDomains = (inst.cfg.jamesDomains || []).filter((d) => d !== id);
    inst.svc.ctx.settings.save();
    fs.rmSync(this.keyFile(inst, id), { force: true });
    await this.writeDkim(inst);
    await inst.svc.restart(inst.id);
  },
  async accounts(inst) {
    const list = (await this.api(inst, 'GET', '/users')) || [];
    return list.map((u) => { const [name, domain] = u.username.split('@'); return { id: u.username, name, email: u.username, domain: domain || null, description: '', admin: false, aliases: [] }; });
  },
  async addAccount(inst, { name, domainId, password }) {
    const u = `${name}@${domainId}`;
    try { await this.api(inst, 'PUT', `/users/${encodeURIComponent(u)}`, { password: String(password) }); } catch (e) { throw e.status === 409 ? new Error(T('This mailbox already exists.')) : e; }
  },
  async setPassword(inst, id, password) { await this.api(inst, 'PUT', `/users/${encodeURIComponent(id)}?force`, { password: String(password) }); },
  async removeAccount(inst, id) { await this.api(inst, 'DELETE', `/users/${encodeURIComponent(id)}`); },
  adminUrl: () => null,
};

const IMPL = { stalwart, james };

/* ====================================================================================== Security updates */
/*
 * Stalwart registers with Hostwerk's security updates (ctx.patchUpdates.register, Hostwerk 2.11+) – the mail server is
 * the service with the most contact to the internet. Patch versions of the same series (0.13.4 → 0.13.5) go in like every
 * other Hostwerk security update: the new version is unpacked next to the running one, then the trial run (setup in a test
 * folder) and a restart of every running Stalwart server on it; only if that works the older folders are removed –
 * otherwise the new folder goes and the servers start on the previous version again. A failed version is skipped (also for
 * new setups) until a newer one appears. Larger jumps stay a decision of the person (“Install” in the extension).
 * Apache James comes as one archive from the Apache directory and is not part of this.
 */
const series = (v) => String(v).split('.').slice(0, 2).join('.');
const quietJob = { log() {}, progress() {}, status() {} };
function patchSource(svc) {
  const usesStalwart = () => svc.list().some((c) => c.engine === 'stalwart');
  const runningStalwart = () => svc.configured().filter((i) => i.cfg.engine === 'stalwart' && i.proc.isRunning());
  return {
    label: 'Mail server (Stalwart)',
    labels: { de: 'Mailserver', en: 'Mail server' },
    items() { const m = stalwart.installed(svc); return m && usesStalwart() ? [{ key: 'stalwart', label: 'Stalwart', version: m.version }] : []; },
    async updates() {
      const m = stalwart.installed(svc);
      if (!m || !usesStalwart()) return [];
      const rel = (await stalwart.releases()).find((r) => series(r.version) === series(m.version) && cmpVersion(r.version, m.version) > 0);
      return rel ? [{ key: 'stalwart', label: 'Stalwart', current: m.version, latest: rel.version, target: rel }] : [];
    },
    plan(u) {
      const dir = path.join(stalwart.dir(svc), u.latest);
      const exe = path.join(dir, X('stalwart'));
      const st = { had: false, restarted: [] };
      const restart = async (list) => { for (const i of list) { await i.stop().catch(() => {}); await i.start(); } };
      return {
        install: async () => { st.had = fs.existsSync(exe); if (!st.had) await stalwart.download(svc, u.target, quietJob); return { dir }; },
        probe: async () => {
          await stalwart.probeSetup(svc, exe);
          // installed() takes the newest folder – running servers move to the new version and have to come up again
          st.restarted = runningStalwart();
          await restart(st.restarted);
          for (const i of st.restarted) if (i.proc.state !== 'running') throw new Error(T('{name} does not run with Stalwart {v}.', { name: i.cfg.name, v: u.latest }));
        },
        activate: async () => {
          const root = stalwart.dir(svc);
          for (const v of fs.readdirSync(root)) if (v !== u.latest && cmpVersion(v, u.latest) < 0) fs.rmSync(path.join(root, v), { recursive: true, force: true });
          if (svc.ctx.keeper) svc.ctx.keeper.setGood('stalwart', u.latest, T('Mail server (Stalwart)'));
        },
        discard: async () => {
          if (!st.had) fs.rmSync(dir, { recursive: true, force: true });
          const k = svc.ctx.keeper;
          if (k) { const e = k.entry('stalwart', T('Mail server (Stalwart)')); if (!e.bad.includes(u.latest)) e.bad = [...e.bad, u.latest].slice(-10); k.save(); }
          await restart(st.restarted).catch(() => {});
        },
      };
    },
  };
}

/* ====================================================================================== Instance */
class MailInstance {
  constructor(svc, id) {
    this.svc = svc;
    this.id = id;
    const c = this.cfg;
    this.proc = new ManagedProcess(id === 'mailserver' ? 'mailserver' : `mailserver-${id}`, `${c.name} (${ENGINES[c.engine].label})`);
    this.proc.restartFn = () => this.start();
    this.proc.healthPort = () => (this.cfg && this.cfg.configured && this.cfg.ports && this.cfg.ports.http) || null;
    this.proc.stopFn = () => this.stop();
  }
  get cfg() { return this.svc.store().instances.find((i) => i.id === this.id); }
  get impl() { return IMPL[this.cfg.engine]; }
  dataDir() { return path.join(this.svc.ctx.paths.data, this.id === 'mailserver' ? 'mailserver' : `mailserver-${this.id}`); }
  logDir() { return path.join(this.svc.ctx.paths.logs, this.id === 'mailserver' ? 'mailserver' : `mailserver-${this.id}`); }
  requireRunning() { if (this.proc.state !== 'running') throw Object.assign(new Error(T('The mail server is not running – please start it first.')), { status: 409, svc: { base: `/mailservers/${this.id}`, action: 'start' } }); }
  async start() {
    if (!this.cfg.configured) throw new Error(T('The mail server is not set up yet.'));
    if (this.proc.isRunning()) return;
    const s = this.impl.spawn(this);
    await this.proc.start({ ...s, ready: () => waitForPort(this.cfg.ports.http, { timeout: this.cfg.engine === 'james' ? 120000 : 60000, isAlive: () => !!this.proc.child }) });
  }
  async stop() { await this.proc.stop({ timeout: 20000 }); }
  info() {
    const c = this.cfg;
    const e = ENGINES[c.engine];
    const ports = c.engine === 'james' ? JAMES_PORTS : STALWART_PORTS;
    return {
      id: this.id, name: c.name, engine: c.engine, engineLabel: e.label, features: e.features,
      installed: this.impl.installed(this.svc), configured: !!c.configured, domain: c.domain || null, hostname: c.hostname || null, public: !!c.public, autostart: !!c.autostart,
      ports: c.ports || null, portLabels: Object.fromEntries(Object.entries(ports).map(([k, v]) => [k, v.label])), admin: c.admin ? c.admin.user : null,
      proc: this.proc.info(), adminUrl: c.configured ? this.impl.adminUrl(this) : null,
    };
  }
}

/* ====================================================================================== Management */
class MailServerService {
  constructor(host) {
    const { ctx } = host;
    bindCore(host);
    host.core('jobs').registerResumer('mail-setup', (p) => this.setup(p.id, p)); // continue after a crash
    this.ctx = ctx;
    const s = ctx.settings.get();
    if (!s.mailservers) {
      // Take over the older single setting (Stalwart only)
      const old = s.mailserver;
      s.mailservers = { instances: old && old.configured ? [{ ...old, id: 'mailserver', engine: 'stalwart', name: T('Mail server') }] : [] };
      delete s.mailserver;
      ctx.settings.save();
    }
    this.items = new Map();
    for (const c of this.store().instances) this.items.set(c.id, new MailInstance(this, c.id));
  }
  store() { return this.ctx.settings.get().mailservers; }
  list() { return this.store().instances; }
  get(id) {
    const i = this.items.get(id);
    if (!i) throw Object.assign(new Error(T('Mail server not found')), { status: 404 });
    return i;
  }
  /** For self-healing, the AI helper and the dashboard: every set-up server. */
  configured() { return [...this.items.values()].filter((i) => i.cfg.configured); }
  available() { return Object.entries(ENGINES).map(([id, e]) => ({ id, ...e, supported: e.platforms.includes(process.platform), installed: IMPL[id].installed(this) })); }

  create({ engine, name }) {
    if (!ENGINES[engine]) throw new Error(T('Unknown mail server software.'));
    if (!ENGINES[engine].platforms.includes(process.platform)) throw new Error(T('{name} does not run on this operating system.', { name: ENGINES[engine].label }));
    name = String(name || '').trim() || (this.list().length ? T('Mail server {n}', { n: this.list().length + 1 }) : T('Mail server'));
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mail';
    let id = this.list().length ? base : 'mailserver';
    for (let n = 2; this.items.has(id) || id === 'mailserver' && this.list().length; n++) id = `${base}-${n}`;
    this.list().push({ id, engine, name, configured: false, autostart: false });
    this.ctx.settings.save();
    this.items.set(id, new MailInstance(this, id));
    return this.get(id).info();
  }
  async remove(id) {
    const i = this.get(id);
    if (i.proc.isRunning()) await i.stop();
    fs.rmSync(i.dataDir(), { recursive: true, force: true });
    this.store().instances = this.list().filter((x) => x.id !== id);
    this.ctx.settings.save();
    this.items.delete(id);
    registry.delete(i.proc.id);
  }

  /** Ports of other mail servers (stopped ones too) must not be given out twice. */
  reserved(exceptId) {
    const out = [];
    for (const c of this.list()) if (c.id !== exceptId && c.ports) out.push(...Object.values(c.ports));
    return out;
  }
  async allocPorts(id, defs, isPublic, job) {
    const ports = {};
    const used = this.reserved(id);
    for (const [k, d] of Object.entries(defs)) {
      let want = isPublic && !d.local ? d.std : d.alt;
      if (used.includes(want) || !(await isPortFree(want))) {
        const alt = await findFreePort(d.alt + 1, used);
        job.log(T('Port {want} ({label}) is taken – using {alt}.', { want, label: T(d.label), alt }));
        want = alt;
      }
      ports[k] = want;
      used.push(want);
    }
    return ports;
  }

  /**
   * Set up with domain, host name and mode.
   * public = true: standard ports on every network address (for a real server with DNS records)
   * public = false: alternative ports on 127.0.0.1 only (to try it out on the development PC)
   */
  setup(id, { domain, hostname, public: isPublic = false, letsEncrypt = false } = {}) {
    const inst = this.get(id);
    domain = String(domain || '').trim().toLowerCase();
    hostname = String(hostname || `mail.${domain}`).trim().toLowerCase();
    if (!DOMAIN_RE.test(domain)) throw new Error(T('Please enter a valid domain (e.g. mycompany.com).'));
    if (!DOMAIN_RE.test(hostname)) throw new Error(T('Please enter a valid host name (e.g. mail.mycompany.com).'));
    return runJob(T('Set up mail server “{name}”', { name: inst.cfg.name }), async (job) => {
      if (inst.proc.isRunning()) await inst.stop();
      // Fresh data (a cancelled setup is cleaned away)
      fs.rmSync(inst.dataDir(), { recursive: true, force: true });
      fs.mkdirSync(inst.dataDir(), { recursive: true });
      Object.assign(inst.cfg, { configured: false, ports: null, jamesDomains: [] });
      const r = await inst.impl.setup(inst, { domain, hostname, isPublic: !!isPublic, letsEncrypt: !!letsEncrypt }, job);
      Object.assign(inst.cfg, { domain, hostname, public: !!isPublic, ports: r.ports, admin: r.admin, configured: true });
      this.ctx.settings.save();
      job.progress(80, T('Starting the mail server …'));
      await inst.start();
      if (r.after) { job.progress(90, T('Setting up domain and DKIM …')); await r.after(); }
      return { domain, hostname, ports: r.ports, admin: r.admin.user, adminPassword: secrets.open(r.admin.secret) };
    }, { key: `mailserver-setup-${id}`, resume: { kind: 'mail-setup', params: { id, domain, hostname, public: isPublic, letsEncrypt } } });
  }
  install(engine) {
    if (!IMPL[engine]) throw new Error(T('Unknown mail server software.'));
    return runJob(T('Install mail server ({name})', { name: ENGINES[engine].label }), (job) => IMPL[engine].install(this, job), { key: `mailserver-install-${engine}` });
  }

  start(id) { return this.get(id).start(); }
  stop(id) { return this.get(id).stop(); }
  async restart(id) { const i = this.get(id); await i.stop(); await i.start(); }

  async domains(id) { const i = this.get(id); return i.impl.domains(i); }
  async addDomain(id, name) {
    const i = this.get(id);
    name = String(name || '').trim().toLowerCase();
    if (!DOMAIN_RE.test(name)) throw new Error(T('Invalid domain.'));
    await i.impl.addDomain(i, name);
    return this.domains(id);
  }
  async removeDomain(id, domainId) { const i = this.get(id); await i.impl.removeDomain(i, domainId); return this.domains(id); }
  async accounts(id) { const i = this.get(id); return i.impl.accounts(i); }
  async addAccount(id, { name, domainId, password, description }) {
    const i = this.get(id);
    name = String(name || '').trim().toLowerCase();
    if (!NAME_RE.test(name)) throw new Error(T('Invalid name before the @ (allowed: a–z, 0–9, . _ + -).'));
    pwCheck(password);
    await i.impl.addAccount(i, { name, domainId, password, description });
    return this.accounts(id);
  }
  async setPassword(id, accId, password) { pwCheck(password); const i = this.get(id); await i.impl.setPassword(i, accId, password); return { ok: true }; }
  async removeAccount(id, accId) { const i = this.get(id); await i.impl.removeAccount(i, accId); return this.accounts(id); }

  /** Check the DNS records of the domain against the real DNS. */
  async checkDns(id, domainId) {
    const d = (await this.domains(id)).find((x) => x.id === domainId);
    if (!d) throw Object.assign(new Error(T('Domain not found')), { status: 404 });
    const out = [];
    for (const rec of d.records) {
      let found = [];
      try {
        if (rec.type === 'TXT') found = (await dns.resolveTxt(rec.name)).map((x) => x.join(''));
        else if (rec.type === 'MX') found = (await dns.resolveMx(rec.name)).map((x) => `${x.priority} ${x.exchange}.`);
        else if (rec.type === 'CNAME') found = (await dns.resolveCname(rec.name)).map((x) => x + '.');
        else if (rec.type === 'SRV') found = (await dns.resolveSrv(rec.name)).map((x) => `${x.priority} ${x.weight} ${x.port} ${x.name}.`);
      } catch { found = []; }
      const norm = (v) => String(v).replace(/\s+/g, ' ').replace(/"/g, '').trim().toLowerCase();
      const ok = found.some((f) => norm(f) === norm(rec.value) || (rec.type === 'TXT' && norm(f).replace(/ /g, '') === norm(rec.value).replace(/ /g, '')));
      out.push({ ...rec, ok, found });
    }
    return out;
  }

  /** Test mail through the sending port (STARTTLS + sign-in) to a mailbox. */
  async testMail(id, { from, password, to }) {
    const c = this.get(id).cfg;
    const raw = [`From: ${from}`, `To: ${to}`, `Subject: ${T('Test from Hostwerk')}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomUUID()}@${c.hostname}>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', T('This message was sent by Hostwerk through your own mail server.'), ''].join('\r\n');
    await sendRaw({ host: '127.0.0.1', port: c.ports.submission, secure: false, user: from, pass: password, from, to: [to], raw, insecure: true, helo: c.hostname });
    return { ok: true };
  }

  overview() { return { instances: [...this.items.values()].map((i) => i.info()), engines: this.available() }; }

  routes(r) {
    const I = (req) => req.params.id;
    r.get('/mailservers', (req, res) => res.json(this.overview()));
    r.post('/mailservers', (req, res) => res.json(this.create(req.body || {})));
    r.post('/mailservers/install/:engine', (req, res) => res.json({ job: this.install(req.params.engine).id }));
    r.get('/mailservers/:id', (req, res) => res.json(this.get(I(req)).info()));
    r.delete('/mailservers/:id', async (req, res) => { await this.remove(I(req)); res.json(this.overview()); });
    r.put('/mailservers/:id', (req, res) => {
      const c = this.get(I(req)).cfg;
      const b = req.body || {};
      if (typeof b.autostart === 'boolean') c.autostart = b.autostart;
      if (typeof b.name === 'string' && b.name.trim()) c.name = b.name.trim().slice(0, 60);
      this.ctx.settings.save();
      res.json(this.get(I(req)).info());
    });
    r.post('/mailservers/:id/setup', (req, res) => res.json({ job: this.setup(I(req), req.body || {}).id }));
    r.post('/mailservers/:id/start', async (req, res) => { await this.start(I(req)); res.json(this.get(I(req)).info()); });
    r.post('/mailservers/:id/stop', async (req, res) => { await this.stop(I(req)); res.json(this.get(I(req)).info()); });
    r.post('/mailservers/:id/kill', async (req, res) => { await this.get(I(req)).proc.kill(); res.json(this.get(I(req)).info()); }); // force
    r.post('/mailservers/:id/restart', async (req, res) => { await this.restart(I(req)); res.json(this.get(I(req)).info()); });
    r.get('/mailservers/:id/admin-password', (req, res) => { const c = this.get(I(req)).cfg; res.json({ user: c.admin && c.admin.user, password: c.admin ? secrets.open(c.admin.secret) : null, engine: c.engine, url: c.ports ? `http://127.0.0.1:${c.ports.http}` : null }); });
    r.get('/mailservers/:id/domains', async (req, res) => res.json(await this.domains(I(req))));
    r.post('/mailservers/:id/domains', async (req, res) => res.json(await this.addDomain(I(req), (req.body || {}).name)));
    r.delete('/mailservers/:id/domains/:d', async (req, res) => res.json(await this.removeDomain(I(req), req.params.d)));
    r.get('/mailservers/:id/domains/:d/dns-check', async (req, res) => res.json(await this.checkDns(I(req), req.params.d)));
    r.get('/mailservers/:id/accounts', async (req, res) => res.json(await this.accounts(I(req))));
    r.post('/mailservers/:id/accounts', async (req, res) => res.json(await this.addAccount(I(req), req.body || {})));
    r.put('/mailservers/:id/accounts/:a/password', async (req, res) => res.json(await this.setPassword(I(req), req.params.a, (req.body || {}).password)));
    r.delete('/mailservers/:id/accounts/:a', async (req, res) => res.json(await this.removeAccount(I(req), req.params.a)));
    r.post('/mailservers/:id/test', async (req, res) => res.json(await this.testMail(I(req), req.body || {})));
  }
}

/** Split a zone file (as Stalwart delivers it) into single records. */
function parseZone(zone) {
  const out = [];
  // Join multi-line TXT records in brackets
  const flat = zone.replace(/\(\s*([\s\S]*?)\s*\)/g, (m, inner) => inner.split(/\n/).map((l) => l.trim()).join(' '));
  for (const line of flat.split(/\n/).map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^(\S+)\s+(?:\d+\s+)?IN\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    let value = m[3].trim();
    if (m[2] === 'TXT') value = (value.match(/"((?:[^"\\]|\\.)*)"/g) || [value]).map((s) => s.replace(/^"|"$/g, '')).join('');
    const purpose = m[2] === 'MX' ? 'Receiving (MX)' : /_domainkey/.test(m[1]) ? 'Signature (DKIM)' : /^_dmarc/.test(m[1]) ? 'Policy (DMARC)' : /v=spf1/.test(value) ? 'Sender (SPF)'
      : /_mta-sts|^mta-sts/.test(m[1]) ? 'MTA-STS' : /_smtp\._tls/.test(m[1]) ? 'TLS reports' : m[2] === 'SRV' ? 'Service (SRV)' : /autoconfig|autodiscover|auto-config/.test(m[1]) ? 'Automatic setup' : '';
    out.push({ name: m[1].replace(/\.$/, ''), type: m[2], value, purpose, required: ['Receiving (MX)', 'Signature (DKIM)', 'Policy (DMARC)', 'Sender (SPF)'].includes(purpose) });
  }
  return out;
}

module.exports = { MailServerService, parseZone, ENGINES, STALWART_PORTS, JAMES_PORTS, bindCore, patchSource, IMPL };
