'use strict';
/*
 * DNS-Einträge per Klick über die Erweiterung „DNS-Verwaltung“ (Dienst "dns", siehe hostwerk-ext-dns README):
 *   preview()  alle Einträge der Domains dieses Mailservers in der Form des Dienstes – mit „steht schon beim Anbieter“
 *              und ob die Domain überhaupt in einem DNS-Zugang liegt
 *   apply()    nur die gewählten Einträge setzen (dns.apply – ohne Doppelte, TXT mit gleicher Kennung wird ersetzt)
 *   verify()   kommen sie draußen an? (dns.verify fragt Cloudflare, Google und Quad9 direkt)
 * Ohne DNS-Erweiterung: { available: false } – die Oberfläche zeigt einen freundlichen Hinweis statt Knöpfen.
 * Der Dienst wird hereingereicht (getDns) – die Tests bilden ihn nach.
 */

const strip = (n) => String(n || '').trim().replace(/\.$/, '').toLowerCase();
/** TXT-Werte ohne Anführungszeichen und Stückelung ("a" "b" → ab) */
const unquote = (v) => {
  const s = String(v || '').trim();
  const parts = s.match(/"((?:[^"\\]|\\.)*)"/g);
  return parts ? parts.map((p) => p.slice(1, -1)).join('') : s;
};

/** Eintrag des Mailservers ({ name, type, value, purpose, required }) → Eintrag für den Dienst dns ({ name, type, content, priority }) */
function toDns(r) {
  const type = String(r.type || '').toUpperCase();
  const base = { name: strip(r.name), type, purpose: r.purpose || '', required: !!r.required, ttl: 3600 };
  if (type === 'MX') {
    const m = /^(\d+)\s+(\S+)$/.exec(String(r.value).trim());
    return m ? { ...base, content: strip(m[2]), priority: Number(m[1]) } : { ...base, content: strip(r.value), priority: 10 };
  }
  if (type === 'SRV') {
    // "prio gewicht port ziel" → Priorität getrennt, Inhalt "gewicht port ziel" (wie die DNS-Erweiterung es erwartet)
    const m = /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)$/.exec(String(r.value).trim());
    return m ? { ...base, content: `${m[2]} ${m[3]} ${strip(m[4])}`, priority: Number(m[1]) } : null;
  }
  if (type === 'TXT') return { ...base, content: unquote(r.value) };
  if (type === 'CNAME') return { ...base, content: strip(r.value) };
  if (['A', 'AAAA', 'CAA'].includes(type)) return { ...base, content: String(r.value).trim() };
  return null; // andere Arten setzt die DNS-Erweiterung nicht
}
const keyOf = (r) => `${r.type}|${r.name}|${r.priority != null ? `${r.priority} ` : ''}${r.content}`;
/** Gleicher Eintrag beim Anbieter? (Name, Art, Inhalt – TXT ohne Leerzeichen-Unterschiede, Rest ohne Groß/klein und Punkt am Ende) */
function same(have, want) {
  if (strip(have.name) !== want.name || String(have.type).toUpperCase() !== want.type) return false;
  if (want.priority != null && have.priority != null && Number(have.priority) !== want.priority) return false;
  if (want.type === 'TXT') return unquote(have.content).replace(/\s+/g, '') === want.content.replace(/\s+/g, '');
  return strip(have.content) === strip(want.content);
}

/**
 * svc = MailServerService (domains(id)), getDns = async () => Dienst "dns" oder null.
 */
function dnsAuto(svc, getDns) {
  const dnsOrNull = async () => { try { const d = await getDns(); return d && typeof d.apply === 'function' ? d : null; } catch { return null; } };
  async function preview(id) {
    const dns = await dnsOrNull();
    if (!dns) return { available: false, domains: [] };
    const out = [];
    for (const d of await svc.domains(id)) {
      const records = (d.records || []).map(toDns).filter(Boolean).map((r) => ({ ...r, key: keyOf(r) }));
      let have = null; let error = null;
      try { have = await dns.records(d.name); } catch (e) { error = e.message; }
      out.push({ name: d.name, zone: have !== null, error: have === null ? error : null, records: records.map((r) => ({ ...r, present: have ? have.some((h) => same(h, r)) : null })) });
    }
    return { available: true, domains: out };
  }
  /** keys = gewählte Einträge aus preview() – nichts anderes wird gesetzt. */
  async function apply(id, keys) {
    const dns = await dnsOrNull();
    if (!dns) throw Object.assign(new Error('Install the extension “DNS management” to set the records with one click.'), { status: 409 });
    const p = await preview(id);
    const want = new Set((Array.isArray(keys) ? keys : []).map(String));
    const chosen = p.domains.filter((d) => d.zone).flatMap((d) => d.records).filter((r) => want.has(r.key));
    if (!chosen.length) throw Object.assign(new Error('Choose at least one record.'), { status: 400 });
    const res = await dns.apply(chosen.map(({ name, type, content, priority, ttl }) => ({ name, type, content, ttl, ...(priority != null ? { priority } : {}) })));
    return { results: chosen.map((r, i) => ({ key: r.key, action: (res[i] && res[i].action) || 'error', error: (res[i] && res[i].error) || null })) };
  }
  /** Prüfen, ob die Einträge draußen ankommen (alle oder die gewählten). */
  async function verify(id, keys) {
    const dns = await dnsOrNull();
    if (!dns || typeof dns.verify !== 'function') throw Object.assign(new Error('Install the extension “DNS management” to set the records with one click.'), { status: 409 });
    const want = Array.isArray(keys) && keys.length ? new Set(keys.map(String)) : null;
    const list = (await preview(id)).domains.flatMap((d) => d.records).filter((r) => !want || want.has(r.key));
    const results = [];
    for (const r of list) {
      try { const v = await dns.verify({ name: r.name, type: r.type, content: r.content, ...(r.priority != null ? { priority: r.priority } : {}) }); results.push({ key: r.key, ok: !!v.ok, some: !!(v.some || v.ok) }); } catch (e) { results.push({ key: r.key, ok: false, some: false, error: e.message }); }
    }
    return { results };
  }
  return { preview, apply, verify };
}

module.exports = { dnsAuto, toDns, same, keyOf };
