## 1.4.0

- Works with current Stalwart versions (1.x) again; if Smart App Control blocks the newest build, the next older one is tried; receiving on another port than 25 no longer asks outside senders to sign in. / Läuft wieder mit aktuellen Stalwart-Versionen (1.x); blockiert Smart App Control die neueste Fassung, wird die nächstältere versucht; Empfang auf einem anderen Port als 25 verlangt von Absendern draußen keine Anmeldung mehr.
- Safer Apache James: no open relay through this computer any more (sending only after sign-in), 100 MB size limit, and each server keeps its own database inside its folder (so it is in backups and removed with it). / Sichereres Apache James: kein offenes Relay über diesen Rechner mehr (Senden nur nach Anmeldung), 100 MB Größengrenze, und jeder Server hat seine eigene Datenbank in seinem Ordner (damit in Sicherungen und wird mit entfernt).
- New: domains with umlauts (müller.de), “Copy all values” for the DNS records, “Also delete its logs and backups” when removing, test mail with a choice of sender mailbox. / Neu: Domains mit Umlauten (müller.de), „Alle Werte kopieren“ bei den DNS-Einträgen, „Auch seine Protokolle und Sicherungen löschen“ beim Entfernen, Testmail mit Auswahl des Absender-Postfachs.
- Fixes: clearer messages (weak password, existing domain, too long addresses), no empty password in the vault, DNS table and long names fit at 1024 px, errors when renaming or removing are shown. / Behoben: klarere Meldungen (schwaches Passwort, vorhandene Domain, zu lange Adressen), kein leeres Passwort im Tresor, DNS-Tabelle und lange Namen passen bei 1024 px, Fehler beim Umbenennen oder Entfernen werden angezeigt.

## 1.3.2

- New animated icon and banner in the common Hostwerk style (isometric block). / Neues animiertes Symbol und Banner im gemeinsamen Hostwerk-Stil (isometrischer Block).

## 1.3.1

- Lives where it belongs: E-mail → Mail server – no own sidebar entry any more (Hostwerk 3.0+); the full page stays under Extensions → Open and can be pinned in the sidebar settings. / Steckt jetzt dort, wo sie hingehört: E-Mail → Mailserver – kein eigener Seitenleisten-Eintrag mehr (Hostwerk 3.0+); die ganze Seite bleibt unter Erweiterungen → Öffnen und lässt sich in den Seitenleisten-Einstellungen anheften.

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
