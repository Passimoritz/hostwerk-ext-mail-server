![Mail server](banner.svg)

# Mail server

Real mailboxes with your own domain: Stalwart or Apache James – setup, mailboxes, DKIM/SPF/DMARC with every DNS record to copy. The mail catcher for development stays in Hostwerk.

[Deutsch](README.de.md) · An official [Hostwerk](https://github.com/Passimoritz/hostwerk-public) extension (SDK 2.7, native extension)

![Screenshot](docs/screenshot.png)

## What it does

- **Where:** E-mail → Mail server – no own sidebar entry since 1.3.1; the full page stays under Extensions → Open
- Two engines to choose from, with pros and cons
- Mailboxes, aliases and a test mail
- Every DNS record (MX, SPF, DKIM, DMARC, autoconfig) ready to copy, with what it is for
- With the extension “DNS management”: set the records at your DNS provider with one click – with a preview of what is already there and a check whether they arrive outside
- Backups of the mailboxes (back up now, restore – the current state is backed up first), also in Hostwerk’s backup centre and the off-site backup (Hostwerk 2.12 or newer)
- Moving to another computer: take a backup over there with “Take over from another computer”
- “Will your mail arrive?”: outgoing port 25, reverse DNS of the public address and common DNS blacklists – with what to do if something is wrong
- Mailbox passwords straight into the password vault (with the extension “Passwords”)
- Settings for the mail program
- Ports that never clash, start with Hostwerk
- Security updates for Stalwart: patch versions arrive with Hostwerk's security updates – tried out first, the previous version stays if the new one fails (Hostwerk 2.11 or newer)

## Install

In Hostwerk: **Extensions → Discover** and click “Install”. If you already used this feature in Hostwerk 2.8, the update installs the extension by itself – with all your data.

Native extensions run as part of Hostwerk (own server and interface part). That is why Hostwerk only installs them from the official catalogue (with checksum) or in developer mode.

## Data

`settings.mailservers, data/mailserver`, backups in `data/mailserver-backups/<server>/` – exactly where Hostwerk always kept it. Removing the extension deletes nothing.

## Develop

```bash
node --test tests/*.test.js          # tests
node build-native.js .               # build the interface (sdk/build-native.js from hostwerk-public)
node check.js . --strict             # same check as the catalogue (sdk/check.js)
```

Interface source in `ui/src`, server part in `server/`. Texts in the code are English, German is in `locales/de.json`.

## License

MIT
