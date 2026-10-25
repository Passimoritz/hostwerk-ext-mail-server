'use strict';
/*
 * Native part of the mail server extension (SDK 2.7). Provides "mailserver" (the AI helper and self-healing use it when it is
 * there), starts servers marked "start with Hostwerk", same API as when it was built in: /api/mailservers …
 * Processes run in Hostwerk's process registry – stopping Hostwerk stops them like every other service.
 *
 * Also (1.3.0):
 *   GET    /api/mailservers/:id/backups                 → [{ file, size, time }]   (data/mailserver-backups/<id>/)
 *   POST   /api/mailservers/:id/backups                 → { job }  back up now (stops the server briefly)
 *   POST   /api/mailservers/:id/backups/:file/restore   → { job }  the current state is backed up first
 *   DELETE /api/mailservers/:id/backups/:file
 *   POST   /api/mailservers/import                      → { job }  { file, adminPassword } – take over from another computer
 *   GET    /api/mailservers/:id/dns-auto                → { available, domains: [{ name, zone, records: [{ key, present … }] }] }
 *   POST   /api/mailservers/:id/dns-auto                → { keys } – set these records through the extension "DNS management"
 *   POST   /api/mailservers/:id/dns-auto/verify         → { keys? } – do they arrive outside?
 * Backups also appear in Hostwerk's backup centre and go along with the off-site backup (Hostwerk 2.12+, SDK 2.10).
 */
const { MailServerService, patchSource } = require('./mailserver');
const { mailBackups, registerBackups } = require('./backups');
const { dnsAuto } = require('./dnsauto');

function activate(host) {
  const svc = new MailServerService(host);
  host.provide('mailserver', svc);
  svc.routes(host.router);
  // Logo der Software und Änderungsprotokoll (SDK 3.5) – bis Hostwerk 3.1 im Kern
  if (typeof host.contribute === 'function') {
    const PAGE = { stalwart: 'https://stalw.art', james: 'https://james.apache.org' };
    host.contribute('releaseNotes', { sources: require('./releasenotes').sources });
    host.contribute('advisor', { kind: 'mail', label: 'Mailserver', start: /postfach|postfächer|imap|e-?mail-adresse|eigene mail|mailserver/i, open: { id: 'mailserver', route: '/mail/server' } }); // Berater
    host.contribute('clickguard', { block: [/^\/mailservers\/[^/]+\/test/] }); // Klick-Test: Mail nach außen
    host.contribute('icons', { kind: 'mail', sources: (id) => { try { const m = svc.get(id); const engine = (m && (m.engine || (m.cfg && m.cfg.engine))) || 'stalwart'; return PAGE[engine] ? [{ url: PAGE[engine] }] : []; } catch { return []; } } });
    host.contribute('audit', { routes: [[/^\/mailservers\/([^/]+)\/(start|stop|restart)$/, (m) => ({ kind: 'Mailserver', target: m[1], action: { start: 'gestartet', stop: 'gestoppt', restart: 'neu gestartet' }[m[2]] })]] });
  }
  // Public mail servers: their ports go into Hostwerk's firewall and router automation (until 3.1 the core read them itself)
  const sec = host.ctx.security;
  if (sec && typeof sec.addPortProvider === 'function') {
    sec.addPortProvider('mail-server', () => svc.configured().filter((i) => i.cfg.public && i.cfg.ports).flatMap((i) => ['smtp', 'submission', 'submissions', 'imaps', 'pop3s'].filter((k) => Number.isInteger(i.cfg.ports[k])).map((k) => ({ port: i.cfg.ports[k], label: `Mailserver (${k})` }))));
    host.on('shutdown', () => { if (sec.removePortProvider) sec.removePortProvider('mail-server'); });
  }
  // Autostart: after the databases, before the web servers (Hostwerk runs extension tasks in that group)
  host.on('autostart', (want) => svc.configured().filter((i) => want(i.cfg.autostart, i.proc.id)).map((i) => () => i.start()));
  // Security updates for Stalwart (patch versions with trial run and fallback) – Hostwerk 2.11+ offers patchUpdates.register()
  const pu = host.ctx.patchUpdates;
  if (pu && typeof pu.register === 'function') {
    const off = pu.register('mail-server', patchSource(svc));
    host.on('shutdown', () => off());
  }

  // Backups: own page, backup centre, off-site backup, moving to another computer
  const util = host.core('util');
  const bk = mailBackups(svc, { t: (s, v) => host.t(s, v), runJob: host.core('jobs').runJob, zipDir: (src, dest) => util.zipDir(src, dest), unzipTo: (src, dest) => util.unzipTo(src, dest), secrets: host.core('secrets') });
  const offBackups = registerBackups(host, bk.source);
  if (offBackups) host.on('shutdown', () => offBackups());
  const r = host.router;
  const file = (req) => `${req.params.id}~${req.params.file}`;
  r.get('/mailservers/:id/backups', (req, res) => { svc.get(req.params.id); res.json({ items: bk.list(req.params.id), dir: bk.dir(req.params.id), center: !!offBackups }); });
  r.post('/mailservers/import', (req, res) => res.json({ job: bk.importPackage(req.body || {}).id }));
  r.post('/mailservers/:id/backups', (req, res) => res.json({ job: bk.backupNow(req.params.id).id }));
  r.post('/mailservers/:id/backups/:file/restore', (req, res) => res.json({ job: bk.restore(file(req)).id }));
  r.delete('/mailservers/:id/backups/:file', (req, res) => { bk.source.remove(file(req)); res.json({ items: bk.list(req.params.id) }); });

  // DNS records with one click through the extension "DNS management" (service "dns") – without it a friendly hint
  const auto = dnsAuto(svc, async () => (typeof host.use === 'function' ? host.use('dns') : host.ctx.dns));
  r.get('/mailservers/:id/dns-auto', async (req, res) => res.json(await auto.preview(req.params.id)));
  r.post('/mailservers/:id/dns-auto', async (req, res) => res.json(await auto.apply(req.params.id, (req.body || {}).keys)));
  r.post('/mailservers/:id/dns-auto/verify', async (req, res) => res.json(await auto.verify(req.params.id, (req.body || {}).keys)));
}

module.exports = { activate };
