## 1.3.0

- DNS records with one click: with the extension “DNS management” the page “Domains & DNS” shows which MX, SPF, DKIM and DMARC records are already at the provider, sets the ticked ones (missing required ones are preselected, with a confirmation) and checks whether they arrive outside (Cloudflare, Google, Quad9). Without the extension there is a hint instead. / DNS-Einträge per Klick: Mit der Erweiterung „DNS-Verwaltung“ zeigt „Domains & DNS“, welche MX-, SPF-, DKIM- und DMARC-Einträge beim Anbieter schon stehen, setzt die angehakten (fehlende Pflicht-Einträge sind vorausgewählt, mit Rückfrage) und prüft, ob sie draußen ankommen (Cloudflare, Google, Quad9). Ohne die Erweiterung steht dort ein Hinweis.
- Backups of the mailboxes: new tab “Backups” (back up now, restore, delete – also while the server is stopped). Restoring backs up the current state first. The mail server stops for a moment while packing and starts again. / Sicherungen der Postfächer: neuer Reiter „Sicherungen“ (jetzt sichern, zurückspielen, löschen – auch bei gestopptem Server). Zurückspielen sichert vorher den aktuellen Stand. Zum Packen hält der Mailserver kurz an und startet wieder.
- The backups appear in Hostwerk's backup centre and go along with the off-site backup (“Data from extensions”) – Hostwerk 2.12 or newer. / Die Sicherungen stehen in Hostwerks Sicherungs-Zentrale und gehen mit der externen Sicherung mit („Daten aus Erweiterungen“) – ab Hostwerk 2.12.
- Moving to another computer: “Take over from another computer” turns a backup (or mail-<name>.zip from the off-site backup) into a mail server there – mailboxes, DKIM keys, setup; paths are rewritten, Stalwart asks for the admin password of the old computer. / Umziehen: „Von einem anderen Rechner übernehmen“ macht aus einer Sicherung (oder mail-<name>.zip aus der externen Sicherung) dort einen Mailserver – Postfächer, DKIM-Schlüssel, Einrichtung; Pfade werden umgeschrieben, Stalwart fragt nach dem Admin-Passwort vom alten Rechner.

## 1.2.0

- "Will your mail arrive?" under Domains & DNS: outgoing port 25 (with a hint to a relay/smarthost when it is blocked), reverse DNS of the public address, DNS blacklists (Spamhaus, SpamCop, Barracuda, PSBL). / Port-25-, Reverse-DNS- und Blacklist-Prüfung.
- Mailbox passwords into the password vault (extension "Passwords") – when creating a mailbox or setting a new password. / Postfach-Passwörter in den Tresor.
- No fixed brand colours any more – the engines use Hostwerk's accent colours. / Keine festen Markenfarben.
- More tests (delivery checks, vault, routes). / Mehr Tests.
- Place in the sidebar (Server), other extensions may add tabs. / Seitenleiste, Reiter für Zusätze.

## 1.1.0

- Stalwart registers with Hostwerk's security updates (System → Updates): patch versions of the same series are installed with a trial run and a restart of running servers; if that fails, the previous version stays and the new one is skipped. / Stalwart meldet sich bei Hostwerks Sicherheits-Updates an (System → Updates): Patch-Versionen derselben Reihe kommen mit Probelauf und Neustart laufender Server; scheitert das, bleibt die vorige Version und die neue wird übersprungen.

## 1.0.1

- Same symbol in the sidebar and in the page header (with Hostwerk 2.11 or newer). / Gleiches Symbol in der Seitenleiste und im Seitenkopf (ab Hostwerk 2.11).

## 1.0.0

- First release as its own extension (before: built into Hostwerk). Data stays where it was. / Erste Fassung als eigene Erweiterung (vorher fest in Hostwerk). Daten bleiben, wo sie waren.
