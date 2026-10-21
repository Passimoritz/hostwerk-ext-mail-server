'use strict';
/*
 * Will mail from this server arrive? Three checks that decide it in practice – without Hostwerk, so the tests can run them:
 *   port 25 out   – many home connections block outgoing port 25; then mail only leaves through a relay ("smarthost")
 *                   of the provider or a mail service (sending port 587 with sign-in).
 *   reverse DNS   – the public address must point back to the mail host name (PTR), and that name to the address.
 *   blacklists    – is the address listed on common DNS blacklists (Spamhaus, Spamcop, Barracuda …)?
 * The public address is taken from the A record of the mail host name – no outside service is asked for it.
 */
const net = require('net');
const dnsDefault = require('dns').promises;

const MX_PROBES = ['gmail-smtp-in.l.google.com', 'mx1.mail.icloud.com', 'mx00.gmx.net'];
/** Blacklists that answer for everyone (Spamhaus needs a direct query – public resolvers get 127.255.255.x = "unknown"). */
const BLACKLISTS = [
  { zone: 'zen.spamhaus.org', name: 'Spamhaus ZEN', info: 'https://check.spamhaus.org/' },
  { zone: 'bl.spamcop.net', name: 'SpamCop', info: 'https://www.spamcop.net/bl.shtml' },
  { zone: 'b.barracudacentral.org', name: 'Barracuda', info: 'https://www.barracudacentral.org/lookups' },
  { zone: 'psbl.surriel.com', name: 'PSBL', info: 'https://psbl.org/' },
];

/** Outgoing port 25: connect to big mail providers and wait for the "220" greeting. → { open, host, error } */
async function port25({ hosts = MX_PROBES, port = 25, timeout = 6000, connect = net.connect } = {}) {
  let last = null;
  for (const host of hosts) {
    const r = await new Promise((resolve) => {
      let buf = ''; let done = false;
      const end = (v) => { if (done) return; done = true; try { sock.destroy(); } catch { /* zu */ } resolve(v); };
      const sock = connect({ host, port });
      sock.setTimeout(timeout, () => end({ open: false, host, error: 'timeout' }));
      sock.on('data', (d) => { buf += d; if (/^220[ -]/m.test(buf)) { try { sock.write('QUIT\r\n'); } catch { /* egal */ } end({ open: true, host }); } else if (/^\d{3}/.test(buf)) end({ open: false, host, error: buf.slice(0, 80).trim() }); });
      sock.on('error', (e) => end({ open: false, host, error: e.code || e.message }));
      sock.on('close', () => end({ open: false, host, error: 'closed' }));
    });
    if (r.open) return r;
    last = r;
  }
  return last || { open: false, host: null, error: 'no host' };
}

/** IPv4 address of the mail host name (= the address other servers see). */
async function publicAddress(hostname, { dns = dnsDefault } = {}) {
  try { return (await dns.resolve4(hostname))[0] || null; } catch { return null; }
}

/** Reverse DNS: PTR of the address points to the host name, and the host name back to the address. */
async function reverseDns(ip, hostname, { dns = dnsDefault } = {}) {
  if (!ip) return { ok: false, ptr: [], error: 'no-address' };
  let ptr = [];
  try { ptr = (await dns.reverse(ip)).map((x) => x.replace(/\.$/, '').toLowerCase()); } catch { ptr = []; }
  const want = String(hostname || '').replace(/\.$/, '').toLowerCase();
  const matches = ptr.includes(want);
  let forward = false;
  if (ptr.length) { try { forward = (await dns.resolve4(ptr[0])).includes(ip); } catch { forward = false; } }
  return { ok: matches && forward, ptr, matches, forward };
}

/** DNS blacklists for an IPv4 address → [{ name, zone, listed: true|false|null, codes, info }] (null = no clear answer). */
async function blacklists(ip, { dns = dnsDefault, lists = BLACKLISTS } = {}) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip || '')) return [];
  const rev = ip.split('.').reverse().join('.');
  return Promise.all(lists.map(async (l) => {
    try {
      const codes = await dns.resolve4(`${rev}.${l.zone}`);
      // 127.255.255.x: die Liste antwortet nicht (z. B. über öffentliche Resolver) – kein Urteil
      if (codes.every((c) => c.startsWith('127.255.255.'))) return { ...l, listed: null, codes };
      return { ...l, listed: codes.some((c) => c.startsWith('127.')), codes };
    } catch (e) {
      return { ...l, listed: e.code === 'ENOTFOUND' || e.code === 'ENODATA' ? false : null, codes: [] };
    }
  }));
}

/** Everything together for the interface. */
async function check(hostname, opts = {}) {
  const ip = await publicAddress(hostname, opts);
  const [p25, rdns, bl] = await Promise.all([port25(opts), reverseDns(ip, hostname, opts), blacklists(ip, opts)]);
  return { hostname, ip, port25: p25, reverseDns: rdns, blacklists: bl, at: Date.now() };
}

module.exports = { port25, publicAddress, reverseDns, blacklists, check, BLACKLISTS, MX_PROBES };
