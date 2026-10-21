import { useState } from 'react';
import { Server, Download, Globe, Laptop, Users, Globe2, Plug, Send, Plus, Trash2, KeyRound, Copy, ExternalLink, CheckCircle2, XCircle, RefreshCw, Eye, Wand2, AlertTriangle, Check, X, Pencil, Coffee, Feather } from 'lucide-react';
import { get, post, put, del, useApi, useStore, waitJob, openExternal } from '@hostwerk/api';
import { Btn, Tabs, Field, Seg, Callout, Empty, Loading, Modal, Progress, StatusPill, toast, confirmDialog, promptDialog, InfoTip } from '@hostwerk/ui';
import { useNew, ServiceButtons, ProcStats, AddTile, SvcImage, CompareButton, NotesButton } from '@hostwerk/kit';
import { t } from '@hostwerk/i18n';
import './style.css';

/*
 * Real mail servers (Stalwart or Apache James): pick the software, set it up, mailboxes, domains with the DNS records to copy,
 * settings for mail programs and a test mail. Shown in Hostwerk's mail area (tab "Mail server") and on the extension page.
 */
const copy = (x) => navigator.clipboard.writeText(x).then(() => toast.success('Copied'));
const genPw = () => Array.from(crypto.getRandomValues(new Uint8Array(14)), (b) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('') + '-' + (Math.floor(Math.random() * 90) + 10);
// Farben aus Hostwerks Akzent-Palette statt fester Markenfarben – lesbar in Hell und Dunkel, folgt der Wahl des Nutzers
const ENGINE_STYLE = { stalwart: { color: 'var(--accent)', color2: 'var(--accent-2, var(--accent))', icon: Feather }, james: { color: 'var(--accent-2, var(--accent))', color2: 'var(--accent)', icon: Coffee } };

/* ------------------------------------------------------------------ pick the software */
function EnginePicker({ engines, first, onClose, go }) {
  const [engine, setEngine] = useState((engines.find((e) => e.supported) || {}).id);
  const [name, setName] = useState(first ? t('Mail server') : '');
  const create = async () => {
    try { const r = await post('/mailservers', { engine, name }); if (onClose) onClose(); go(r.id); } catch (e) { toast.error(e); }
  };
  const body = (
    <div className="stack">
      <div className="engine-grid">
        {engines.map((e, i) => {
          const st = ENGINE_STYLE[e.id] || {};
          const I = st.icon || Server;
          return (
            <button key={e.id} type="button" disabled={!e.supported} className={`engine-card ${engine === e.id ? 'active' : ''}`} style={{ '--c': st.color, '--i': i }} onClick={() => setEngine(e.id)} aria-pressed={engine === e.id}>
              <div className="row-tight" style={{ gap: 10 }}>
                <span className="engine-ico"><I /></span>
                <div className="grow" style={{ textAlign: 'left' }}><b>{e.label}</b><div className="tiny muted">{[e.lang, e.installed && t('{v} installed', { v: e.installed.version }), !e.supported && t('not for this system')].filter(Boolean).join(' · ')}</div></div>
                {engine === e.id && <CheckCircle2 size={18} style={{ color: st.color }} />}
              </div>
              <div className="small muted" style={{ textAlign: 'left' }}>{e.text}</div>
              <ul className="compare-list pros">{e.pros.map((p) => <li key={p}><Check />{p}</li>)}</ul>
              <ul className="compare-list cons">{e.cons.map((p) => <li key={p}><X />{p}</li>)}</ul>
            </button>
          );
        })}
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <Field label="Name in Hostwerk" className="grow"><input className="input" placeholder="e.g. company or club" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <CompareButton kind="mail" current={engine} label={t('Compare all mail options')} />
      </div>
    </div>
  );
  if (first) {
    return (
      <div className="card fade-in"><div className="card-head"><Server size={16} /><h3>Which mail server should it be?</h3></div>
        <div className="card-body stack">{body}<div><Btn className="grad" icon={Wand2} disabled={!engine} onClick={create}>Continue to setup</Btn></div></div></div>
    );
  }
  return (
    <Modal title="Another mail server" subtitle="Several mail servers run independently of each other – e.g. for different companies or to compare." size="wide" onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn className="grad" icon={Wand2} disabled={!engine} onClick={create}>Create &amp; set up</Btn></>}>
      {body}
    </Modal>
  );
}

/* ------------------------------------------------------------------ setup */
function Setup({ info, onDone, onCancel }) {
  const [f, setF] = useState({ domain: '', hostname: '', public: false, letsEncrypt: false });
  const [job, setJob] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const jobState = useStore((s) => (job && s.jobs ? s.jobs[job] : null));
  const host = f.hostname || (f.domain ? `mail.${f.domain}` : '');
  const james = info.engine === 'james';
  const run = async () => {
    setError(null);
    try {
      const r = await post(`/mailservers/${info.id}/setup`, { ...f, hostname: host });
      setJob(r.job);
      const j = await waitJob(r.job);
      setResult(j.result);
    } catch (e) { setError(e.message); }
    setJob(null);
  };
  if (result) {
    return (
      <div className="card pop-in"><div className="card-body stack">
        <InfoTip title={t('{name} is set up and running', { name: info.name })} icon={CheckCircle2}>{james ? t('You only need the administration password if you want to use the James REST interface yourself – Hostwerk remembers it.') : t('Note down the admin access – it is only shown now (later under “Admin access”).')}</InfoTip>
        <div className="kv"><span>{james ? t('Administration') : t('Admin')}</span><code>{result.admin}</code><span>{t('Password')}</span><code>{result.adminPassword} <button type="button" className="btn ghost xs icon" title="Copy" aria-label="Copy" onClick={() => copy(result.adminPassword)}><Copy /></button></code></div>
        <div><Btn className="primary" onClick={onDone}>Continue to mailboxes &amp; DNS</Btn></div>
      </div></div>
    );
  }
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><Wand2 size={16} /><h3>{t('{name}: setup', { name: info.name })}</h3><span className="badge" style={{ marginLeft: 6 }}>{info.engineLabel}</span></div>
        <div className="card-body stack" style={{ gap: 12 }}>
          <div className="small muted">{james
            ? t('Hostwerk sets up Apache James – with SMTP, IMAP, POP3, TLS (self-signed) and a DKIM signature per domain. Java is downloaded automatically when needed.')
            : t('Hostwerk sets up Stalwart – a complete mail server with SMTP, IMAP, POP3, spam filter, DKIM signature, SPF/DMARC checks and TLS.')} {t('You get real mailboxes (e.g. info@yourdomain.com) for Outlook, Thunderbird or your phone.')}</div>
          <Field label="Domain" hint="The part after the @ – e.g. mycompany.com">
            <input className="input" placeholder="mycompany.com" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value.trim().toLowerCase() })} />
          </Field>
          <Field label="Host name of the mail server" hint="The server can be reached under this name (A record in the DNS).">
            <input className="input" placeholder={f.domain ? `mail.${f.domain}` : 'mail.mycompany.com'} value={f.hostname} onChange={(e) => setF({ ...f, hostname: e.target.value.trim().toLowerCase() })} />
          </Field>
          <Field label="Mode">
            <Seg value={f.public ? 'public' : 'local'} onChange={(v) => setF({ ...f, public: v === 'public' })} options={[{ id: 'local', label: 'Try it out (this PC only)', icon: Laptop }, { id: 'public', label: 'Real operation (internet)', icon: Globe }]} />
          </Field>
          {f.public && !james && <label className="check small"><input type="checkbox" checked={f.letsEncrypt} onChange={(e) => setF({ ...f, letsEncrypt: e.target.checked })} />{t('Get a free TLS certificate from Let’s Encrypt (port 443 must be reachable from the internet)')}</label>}
          {f.public && james && <Callout kind="warn">Apache James uses a self-signed certificate. For real operation Stalwart with Let’s Encrypt is the more comfortable choice.</Callout>}
          {jobState && <div className="fade-in"><div className="small muted" style={{ marginBottom: 6 }}>{jobState.text}</div><Progress value={jobState.progress} indeterminate={!jobState.progress} /></div>}
          {error && <Callout kind="err" title="That did not work">{error}</Callout>}
          <div className="row">
            <Btn className="grad" icon={info.installed ? Wand2 : Download} busy={!!job} disabled={!f.domain || !!job} onClick={run}>{info.installed ? t('Set up') : t('Install & set up')}</Btn>
            {onCancel && <Btn className="ghost" disabled={!!job} onClick={onCancel}>Cancel</Btn>}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><AlertTriangle size={16} /><h3>What a real mail server needs</h3></div>
        <div className="card-body small stack" style={{ gap: 8 }}>
          <div>{t('Try it out: runs on this PC only (ports 2525, 5587, 9993 …). Ideal to test mailboxes, DKIM and mail programs – without risk. Several mail servers get different ports automatically.')}</div>
          <div>{t('Real operation – needed so mails from the internet arrive and yours do not end up in spam:')}</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>{t('An own domain with access to its DNS settings (Hostwerk shows every record to copy).')}</li>
            <li>{t('A fixed public IP address and open ports 25, 465, 587, 993 (router forwarding / firewall).')}</li>
            <li>{t('Many internet providers block port 25 for private connections – then a server/VPS or a business connection is needed.')}</li>
            <li>{t('A reverse DNS record (PTR) for the IP that points to the host name – your provider sets it.')}</li>
            <li>{t('In real operation only one mail server at a time can use the standard ports.')}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ mailboxes */
function Accounts({ info, vault }) {
  const B = `/mailservers/${info.id}`;
  const canVault = !!(vault && vault.available && !vault.locked && !vault.readonly);
  const acc = useApi(`${B}/accounts`);
  const doms = useApi(`${B}/domains`);
  const [f, setF] = useState(null);
  const [q, setQ] = useState('');
  const add = async () => {
    try { acc.setData(await post(`${B}/accounts`, f)); toast.success(t('Mailbox {name}@… created', { name: f.name })); setF(null); } catch (e) { toast.error(e); }
  };
  if (!acc.data || !doms.data) return <Loading />;
  const domName = (id) => (doms.data.find((d) => d.id === id) || {}).name;
  const list = acc.data.filter((a) => !q || a.email.includes(q.toLowerCase()));
  return (
    <div className="card">
      <div className="card-head"><Users size={16} /><h3>Mailboxes</h3><span className="badge">{acc.data.length}</span>
        <div className="right row-tight">
          {acc.data.length > 6 && <input className="input sm mail-search" placeholder="Search …" aria-label="Search mailboxes" value={q} onChange={(e) => setQ(e.target.value)} />}
          <Btn className="sm primary" icon={Plus} disabled={!doms.data.length} onClick={() => setF({ name: '', domainId: doms.data[0] && doms.data[0].id, password: genPw(), vault: canVault })}>Add mailbox</Btn>
        </div></div>
      {acc.data.length === 0 && <Empty icon={Users} title="No mailboxes yet" text="Create the first mailbox, e.g. info@ or your name." />}
      {list.map((a) => (
        <div key={a.id} className="list-item">
          <div className="ico"><Users /></div>
          <div className="grow mail-min"><div className="bold ellipsis">{a.email}</div><div className="small muted">{a.admin ? t('Administrator') : t('Mailbox')}{a.description ? ` · ${a.description}` : ''}</div></div>
          <button type="button" className="btn ghost xs icon" title="Copy address" aria-label="Copy address" onClick={() => copy(a.email)}><Copy /></button>
          <Btn className="xs ghost" icon={KeyRound} onClick={async () => { const pw = await promptDialog({ title: t('New password for {email}', { email: a.email }), label: 'Password (at least 8 characters)', value: genPw() }); if (pw) { try { await put(`${B}/accounts/${encodeURIComponent(a.id)}/password`, { password: pw, vault: canVault }); toast.success(canVault ? 'Password changed and kept in the vault' : 'Password changed'); } catch (e) { toast.error(e); } } }}>Password</Btn>
          {!a.admin && <button type="button" className="btn ghost xs icon" title="Delete" aria-label="Delete" onClick={async () => { if (await confirmDialog({ title: t('Delete {email}?', { email: a.email }), text: 'The mailbox and every mail in it are deleted for good.', confirm: 'Delete', danger: true })) { try { acc.setData(await del(`${B}/accounts/${encodeURIComponent(a.id)}`)); } catch (e) { toast.error(e); } } }}><Trash2 /></button>}
        </div>
      ))}
      {f && (
        <Modal title="Add mailbox" onClose={() => setF(null)} footer={<><Btn onClick={() => setF(null)}>Cancel</Btn><Btn className="primary" disabled={!f.name || !f.password} onClick={add}>Create</Btn></>}>
          <div className="form-grid">
            <Field label="Address" className="span-2">
              <div className="row-tight"><input className="input" autoFocus placeholder="info" aria-label="Name before the @" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.trim().toLowerCase() })} onKeyDown={(e) => e.key === 'Enter' && f.name && add()} /><span>@</span>
                <select className="select" aria-label="Domain" value={f.domainId} onChange={(e) => setF({ ...f, domainId: e.target.value })}>{doms.data.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            </Field>
            <Field label="Password" className="span-2" hint="For signing in from the mail program – at least 8 characters.">
              <div className="row-tight"><input className="input mono" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><button type="button" className="btn ghost sm icon" title="Create a new one" aria-label="Create a new one" onClick={() => setF({ ...f, password: genPw() })}><RefreshCw /></button><button type="button" className="btn ghost sm icon" title="Copy" aria-label="Copy" onClick={() => copy(f.password)}><Copy /></button></div>
            </Field>
            {info.engine === 'stalwart' && <Field label="Description (optional)" className="span-2"><input className="input" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>}
          </div>
          <div className="small muted mt">{t('Sign-in name in the mail program:')} <code>{f.name || 'name'}@{domName(f.domainId)}</code></div>
          {vault && vault.available ? (
            <label className="check small mt"><input type="checkbox" checked={!!f.vault} disabled={!canVault} onChange={(e) => setF({ ...f, vault: e.target.checked })} />{canVault ? t('Keep the password in the vault “{name}”', { name: vault.vault.name }) : t('The vault is locked – unlock it under Passwords to keep the password there.')}</label>
          ) : <div className="tiny muted mt">{t('With the extension “Passwords” Hostwerk keeps mailbox passwords in your vault.')}</div>}
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ will mail arrive? */
function Delivery({ info }) {
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { setR(await get(`/mailservers/${info.id}/delivery-check`)); } catch (e) { toast.error(e); } setBusy(false); };
  const Mark = ({ ok }) => (ok == null ? <span className="badge">{t('no answer')}</span> : ok ? <CheckCircle2 size={15} className="c-ok" aria-label={t('fine')} /> : <XCircle size={15} className="c-err" aria-label={t('problem')} />);
  return (
    <div className="card">
      <div className="card-head"><Send size={16} /><h3>Will your mail arrive?</h3>
        <InfoTip title="Will your mail arrive?">Three things decide whether other servers accept your mail: outgoing port 25 must be open, the public address must point back to your mail host name (reverse DNS, set at your provider) and the address must not be on a blacklist.</InfoTip>
        <div className="right"><Btn className="xs" icon={RefreshCw} busy={busy} onClick={run}>Check</Btn></div>
      </div>
      {!r ? <div className="card-body small muted">{t('Checks port 25, reverse DNS and common blacklists for {host}.', { host: info.hostname || '–' })}</div> : (
        <div className="card-body stack mail-delivery">
          <div className="row-tight"><Mark ok={r.port25.open} /><b className="small grow">{t('Outgoing port 25')}</b><span className="small muted">{r.port25.open ? t('open') : t('blocked')}</span></div>
          {!r.port25.open && <Callout kind="warn">Your connection blocks outgoing port 25 (common for home connections). Mail then only leaves through a relay: the sending server of your internet provider or a mail service (port 587 with sign-in) – set it as “smarthost” in the mail server's administration.</Callout>}
          <div className="row-tight"><Mark ok={r.ip ? r.reverseDns.ok : false} /><b className="small grow">{t('Reverse DNS')}</b><span className="small muted mono">{r.ip || t('no A record')}{r.reverseDns.ptr && r.reverseDns.ptr.length ? ` → ${r.reverseDns.ptr[0]}` : ''}</span></div>
          {r.ip && !r.reverseDns.ok && <Callout kind="warn">{t('The address {ip} should point back to {host}. Your internet or server provider sets this “PTR record” – often in the customer area under reverse DNS.', { ip: r.ip, host: r.hostname })}</Callout>}
          {!r.ip && <Callout kind="warn">{t('{host} has no A record yet – add it at your domain provider.', { host: r.hostname })}</Callout>}
          {r.blacklists.map((b) => (
            <div key={b.zone} className="row-tight"><Mark ok={b.listed == null ? null : !b.listed} /><span className="small grow">{b.name}</span><span className="small muted">{b.listed == null ? t('no clear answer') : b.listed ? t('listed') : t('not listed')}</span>{b.listed && <button type="button" className="link-btn small" onClick={() => openExternal(b.info)}>{t('Details')}</button>}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ domains & DNS */
function Domains({ info }) {
  const B = `/mailservers/${info.id}`;
  const doms = useApi(`${B}/domains`);
  const [check, setCheck] = useState({});
  const [busy, setBusy] = useState(null);
  if (!doms.data) return <Loading />;
  const runCheck = async (d) => {
    setBusy(d.id);
    try { const r = await get(`${B}/domains/${encodeURIComponent(d.id)}/dns-check`); setCheck({ ...check, [d.id]: Object.fromEntries(r.map((x) => [`${x.type}|${x.name}|${x.value}`, x.ok])) }); } catch (e) { toast.error(e); }
    setBusy(null);
  };
  return (
    <div className="stack">
      <InfoTip title="How your mails arrive (and not in spam)">{t('Enter the records below in the DNS settings of your domain provider.')} {info.engine === 'stalwart' ? t('MX, SPF, DKIM and DMARC are required – the others help mail programs set themselves up.') : t('MX, SPF, DKIM and DMARC are required.')} {t('The host name {host} also needs an A record pointing to the IP of your server.', { host: info.hostname })} {t('DNS changes can take up to a few hours.')}</InfoTip>
      {info.engine === 'james' && <Callout kind="warn">With Apache James the mail server restarts briefly after adding or removing a domain, so the DKIM signature takes effect.</Callout>}
      {doms.data.map((d) => {
        const c = check[d.id];
        return (
          <div key={d.id} className="card">
            <div className="card-head"><Globe2 size={16} /><h3>{d.name}</h3>
              {c && <span className={`badge ${Object.values(c).every(Boolean) ? 'ok' : 'warn'}`}>{t('{n}/{all} found', { n: Object.values(c).filter(Boolean).length, all: Object.keys(c).length })}</span>}
              <div className="right row-tight">
                <Btn className="xs" icon={RefreshCw} busy={busy === d.id} onClick={() => runCheck(d)}>Check DNS</Btn>
                <Btn className="xs ghost" icon={Copy} onClick={() => copy(d.zone)}>Copy as zone file</Btn>
                {doms.data.length > 1 && <Btn className="ghost xs icon" icon={Trash2} title="Remove domain" aria-label="Remove domain" onClick={async () => { if (await confirmDialog({ title: t('Remove {name}?', { name: d.name }), text: 'The domain is removed from the mail server.', confirm: 'Remove', danger: true })) { try { doms.setData(await del(`${B}/domains/${encodeURIComponent(d.id)}`)); } catch (e) { toast.error(e); } } }} />}
              </div>
            </div>
            <table className="table">
              <thead><tr><th style={{ width: 28 }} /><th>Purpose</th><th>Type</th><th>Name</th><th>Value</th><th /></tr></thead>
              <tbody>
                {d.records.map((r) => {
                  const ok = c ? c[`${r.type}|${r.name}|${r.value}`] : null;
                  return (
                    <tr key={r.type + r.name + r.value}>
                      <td>{ok == null ? null : ok ? <CheckCircle2 size={15} className="c-ok" aria-label="found" /> : <XCircle size={15} className={r.required ? 'c-err' : 'muted'} aria-label="missing" />}</td>
                      <td className="small">{r.purpose}{r.required && <span className="badge mail-gap">Required</span>}</td>
                      <td className="mono small">{r.type}</td>
                      <td className="mono small ellipsis" style={{ maxWidth: 220 }} title={r.name}>{r.name}</td>
                      <td className="mono small ellipsis" style={{ maxWidth: 360 }} title={r.value}>{r.value}</td>
                      <td><button type="button" className="btn ghost xs icon" title="Copy value" aria-label="Copy value" onClick={() => copy(r.value)}><Copy /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      <Delivery info={info} />
      <div><Btn icon={Plus} onClick={async () => { const n = await promptDialog({ title: 'Another domain', label: 'Domain (e.g. seconddomain.com)' }); if (n) { try { doms.setData(await post(`${B}/domains`, { name: n })); toast.success(t('{name} added – a DKIM key was created', { name: n })); } catch (e) { toast.error(e); } } }}>Another domain</Btn></div>
    </div>
  );
}

/* ------------------------------------------------------------------ connection & test */
function Connect({ info }) {
  const host = info.public ? info.hostname : '127.0.0.1';
  const p = info.ports;
  const [m, setM] = useState({ from: '', password: '', to: '' });
  const [busy, setBusy] = useState(false);
  const rows = [
    ['Inbox (IMAP)', host, p.imaps, 'SSL/TLS'], ['Inbox (IMAP, alternative)', host, p.imap, 'STARTTLS'],
    ['Outgoing (SMTP)', host, p.submissions, 'SSL/TLS'], ['Outgoing (SMTP, alternative)', host, p.submission, 'STARTTLS'],
    p.pop3s ? ['POP3', host, p.pop3s, 'SSL/TLS'] : ['POP3', host, p.pop3, 'STARTTLS'],
  ];
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><Plug size={16} /><h3>Settings for the mail program</h3></div>
        <table className="table">
          <thead><tr><th>Service</th><th>Server</th><th>Port</th><th>Security</th></tr></thead>
          <tbody>{rows.map(([l, h, port, sec]) => <tr key={l}><td className="small">{l}</td><td className="mono small">{h}</td><td className="mono small">{port} <button type="button" className="btn ghost xs icon" title="Copy" aria-label="Copy" onClick={() => copy(String(port))}><Copy /></button></td><td className="small">{sec}</td></tr>)}</tbody>
        </table>
        <div className="card-body small muted">{t('The user name is always the complete e-mail address.')} {info.public && info.engine === 'stalwart' ? t('Mail programs like Thunderbird and Outlook find these settings on their own thanks to the autoconfig records.') : t('The server uses a self-signed certificate – the mail program asks once whether you trust it.')}</div>
      </div>
      <div className="card">
        <div className="card-head"><Send size={16} /><h3>Send a test mail</h3></div>
        <div className="card-body stack" style={{ gap: 10 }}>
          <Field label="Sender mailbox"><input className="input" placeholder={`info@${info.domain}`} value={m.from} onChange={(e) => setM({ ...m, from: e.target.value.trim() })} /></Field>
          <Field label="Password of the sender"><input className="input" type="password" value={m.password} onChange={(e) => setM({ ...m, password: e.target.value })} /></Field>
          <Field label="Recipient" hint="An own mailbox or – in real operation – an outside address (e.g. Gmail) to check delivery and spam rating."><input className="input" value={m.to} onChange={(e) => setM({ ...m, to: e.target.value.trim() })} /></Field>
          <div><Btn className="primary" icon={Send} busy={busy} disabled={!m.from || !m.password || !m.to} onClick={async () => { setBusy(true); try { await post(`/mailservers/${info.id}/test`, m); toast.success('The test mail was accepted and is being delivered'); } catch (e) { toast.error(e); } setBusy(false); }}>Send</Btn></div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ one mail server */
function Detail({ info, reload, multi, go, vault }) {
  const [tab, setTab] = useState('accounts');
  const [setupAgain, setSetupAgain] = useState(false);
  const st = ENGINE_STYLE[info.engine] || {};
  const I = st.icon || Server;
  const B = `/mailservers/${info.id}`;
  if (!info.configured || setupAgain) {
    return <Setup info={info} onDone={() => { setSetupAgain(false); reload(); }} onCancel={info.configured ? () => setSetupAgain(false) : multi ? async () => { await del(B); go(null); reload(); } : null} />;
  }
  const running = info.proc.state === 'running';
  return (
    <div className="fade-in">
      <div className={`card svc-card ${info.proc.state}`} style={{ marginBottom: 14 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <SvcImage kind="mail" id={info.id} name={info.name} fallback={<div className="svc-icon" style={{ background: `linear-gradient(135deg, ${st.color}, ${st.color2})` }}><I /></div>} />
          <div className="grow" style={{ minWidth: 200 }}>
            <div className="bold row-tight">{info.name} <StatusPill state={info.proc.state} /></div>
            <div className="small muted">{[info.hostname, info.domain, info.public ? t('Real operation (reachable from the internet)') : t('Test operation (this PC only)'), `${info.engineLabel} ${(info.installed && info.installed.version) || ''}`.trim()].join(' · ')}</div>
            <div className="row-tight info-row">{info.engine === 'stalwart' && info.installed && <NotesButton product="stalwart" version={info.installed.version} />}<CompareButton kind="mail" current={info.engine} label={t('Compare options')} /></div>
          </div>
          <ServiceButtons base={B} state={info.proc.state} size="sm" />
          {info.adminUrl && <Btn className="sm ghost" icon={ExternalLink} disabled={!running} onClick={() => openExternal(info.adminUrl)} title="Stalwart administration: spam filter, forwarding, out-of-office, logs …">Administration</Btn>}
          <Btn className="sm ghost" icon={Eye} onClick={async () => { const r = await get(`${B}/admin-password`); await confirmDialog({ title: r.engine === 'james' ? 'Access to the administration (WebAdmin)' : 'Admin access', text: r.engine === 'james' ? t('REST interface: {url}\nHeader “Password”: {pw}', { url: r.url, pw: r.password }) : `${r.user}\n${r.password}`, confirm: 'OK' }); }}>Admin access</Btn>
          <label className="check small"><input type="checkbox" checked={info.autostart} onChange={async (e) => { await put(B, { autostart: e.target.checked }); reload(); }} />Start with Hostwerk</label>
        </div>
        <ProcStats proc={info.proc} svc={info.proc.id} compact />
      </div>
      {!running ? <div className="card"><Empty icon={Server} title="The mail server is stopped" text={info.engine === 'james' ? t('Start it to manage mailboxes and domains. Apache James needs about 5–15 seconds to start.') : t('Start it to manage mailboxes and domains.')} /></div> : (
        <>
          <Tabs tabs={[{ id: 'accounts', label: 'Mailboxes', icon: Users }, { id: 'dns', label: 'Domains & DNS', icon: Globe2 }, { id: 'connect', label: 'Connection & test', icon: Plug }]} value={tab} onChange={setTab} />
          {tab === 'accounts' && <Accounts info={info} vault={vault} />}
          {tab === 'dns' && <Domains info={info} />}
          {tab === 'connect' && <Connect info={info} />}
        </>
      )}
      <div className="small muted mt row">
        <button type="button" className="link-btn" onClick={async () => { const n = await promptDialog({ title: 'Rename', label: 'Name in Hostwerk', value: info.name }); if (n) { await put(B, { name: n }); reload(); } }}><Pencil size={12} />{t('Rename')}</button>
        <button type="button" className="link-btn" onClick={async () => { if (await confirmDialog({ title: 'Set up the mail server again?', text: 'Every mailbox, mail and setting of this mail server is deleted and created anew.', confirm: 'Set up again', danger: true, typeToConfirm: t('DELETE') })) setSetupAgain(true); }}><RefreshCw size={12} />{t('Set up again …')}</button>
        <button type="button" className="link-btn" onClick={async () => { if (await confirmDialog({ title: t('Remove {name}?', { name: info.name }), text: 'The mail server is stopped and deleted with every mailbox and mail. The downloaded software stays for other mail servers.', confirm: 'Remove', danger: true, typeToConfirm: t('DELETE') })) { await del(B); go(null); reload(); } }}><Trash2 size={12} />{t('Remove …')}</button>
      </div>
    </div>
  );
}

/** All mail servers. base = address of the surrounding page (#/mail/server or #/ext/mail-server). */
export default function MailServer({ id, base = '/mail/server' }) {
  const st = useApi('/mailservers');
  const [adding, setAdding] = useState(false);
  useNew('mailserver', () => setAdding(true));
  const go = (x) => { location.hash = x ? `${base}/${encodeURIComponent(x)}` : base; };
  if (!st.data) return <Loading />;
  const { instances, engines } = st.data;
  const reload = () => st.reload({ silent: true });
  if (!instances.length) return <div className="fade-in" style={{ paddingTop: 16 }}><EnginePicker engines={engines} first onClose={reload} go={go} /></div>;
  const cur = instances.find((i) => i.id === id) || instances[0];
  const multi = instances.length > 1;
  return (
    <div className="fade-in" style={{ paddingTop: 16 }}>
      <div className="mail-servers">
        {instances.map((i) => {
          const s = ENGINE_STYLE[i.engine] || {};
          return (
            <button key={i.id} type="button" className={`mail-server-chip ${i.id === cur.id ? 'active' : ''}`} style={{ '--c': s.color }} onClick={() => go(i.id)} aria-pressed={i.id === cur.id}>
              <span className={`dot-state ${i.configured ? i.proc.state : 'missing'}`} />
              <span className="grow" style={{ textAlign: 'left', minWidth: 0 }}><b className="ellipsis">{i.name}</b><span className="tiny muted ellipsis">{i.configured ? `${i.domain} · ${i.engineLabel}` : t('{engine} · not set up yet', { engine: i.engineLabel })}</span></span>
            </button>
          );
        })}
        <AddTile onClick={() => setAdding(true)} title={t('Another mail server')} chips={engines.filter((e) => e.supported).map((e) => ({ label: e.label, color: (ENGINE_STYLE[e.id] || {}).color }))} />
      </div>
      <Detail key={cur.id} info={cur} reload={reload} multi={multi || !cur.configured} go={go} vault={st.data.vault} />
      {adding && <EnginePicker engines={engines} onClose={() => { setAdding(false); reload(); }} go={go} />}
    </div>
  );
}
