'use strict';
/*
 * Native part of the mail server extension (SDK 2.7). Provides "mailserver" (the AI helper and self-healing use it when it is
 * there), starts servers marked "start with Hostwerk", same API as when it was built in: /api/mailservers …
 * Processes run in Hostwerk's process registry – stopping Hostwerk stops them like every other service.
 */
const { MailServerService } = require('./mailserver');

function activate(host) {
  const svc = new MailServerService(host);
  host.provide('mailserver', svc);
  svc.routes(host.router);
  // Autostart: after the databases, before the web servers (Hostwerk runs extension tasks in that group)
  host.on('autostart', (want) => svc.configured().filter((i) => want(i.cfg.autostart, i.proc.id)).map((i) => () => i.start()));
}

module.exports = { activate };
