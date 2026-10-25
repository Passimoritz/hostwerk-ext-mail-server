'use strict';
/* Versionshinweise für Stalwart (GitHub-Releases) und Apache James (Link) – über contribute('releaseNotes'). Bis Hostwerk 3.1 im Kern. */
const sources = {
  stalwart: { label: 'Stalwart', link: (v) => `https://github.com/stalwartlabs/stalwart/releases/tag/v${v}`, fetch: (v, { github }) => github('stalwartlabs/stalwart', v) },
  james: { label: 'Apache James', link: () => 'https://james.apache.org/server/release-notes.html' },
};

module.exports = { sources };
