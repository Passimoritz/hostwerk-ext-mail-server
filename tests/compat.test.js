'use strict';
// Found in the end-to-end test with real Stalwart 1.1 and Apache James 3.9.1: property names of newer
// Stalwart versions, its password check, and James' database outside the server folder.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { IMPL } = require('../server/mailserver');

const { stalwart, james } = IMPL;

test('stalwart: an unknown property name is recognised, other refusals are not', () => {
  assert.equal(stalwart.unknownKey({ notCreated: { a: { type: 'invalidPatch', description: 'Invalid key for object', properties: [''] } } }), true);
  assert.equal(stalwart.unknownKey({ notCreated: { a: { type: 'invalidProperties', description: 'Invalid server hostname' } } }), false);
  assert.equal(stalwart.unknownKey({ created: { a: { id: 'x' } } }), false);
});

test('stalwart: bootstrap tries "defaultHostname" (1.x) first and falls back to "serverHostname" (0.16)', async () => {
  const sent = [];
  const orig = stalwart.jmap;
  stalwart.jmap = async (base, auth, calls) => {
    const single = calls[0][1].update.singleton;
    sent.push(Object.keys(single)[0]);
    if ('defaultHostname' in single) return [['x:Bootstrap/set', { notUpdated: { singleton: { type: 'invalidProperties', properties: ['defaultHostname'] } } }, '0']];
    return [['x:Bootstrap/set', { updated: { singleton: { username: 'admin@a.test', secret: 's' } } }, '0']];
  };
  try {
    const body = await stalwart.bootstrap('http://x', 'Basic y', { hostname: 'mail.a.test', defaultDomain: 'a.test' });
    assert.deepEqual(sent, ['defaultHostname', 'serverHostname']);
    assert.equal(body.updated.singleton.secret, 's');
    // A real validation error (with description) is not retried under the other name
    sent.length = 0;
    stalwart.jmap = async (base, auth, calls) => { sent.push(Object.keys(calls[0][1].update.singleton)[0]); return [['x', { notUpdated: { singleton: { type: 'invalidProperties', description: 'Invalid server hostname', properties: ['defaultHostname'] } } }, '0']]; };
    await stalwart.bootstrap('http://x', 'Basic y', { hostname: 'bad', defaultDomain: 'a.test' });
    assert.deepEqual(sent, ['defaultHostname']);
  } finally { stalwart.jmap = orig; }
});

test('stalwart: "password is too weak" is said in the person\'s words, other errors stay', () => {
  assert.doesNotMatch(stalwart.weak('Password is too weak. This is a very common password.'), /too weak\. This/);
  assert.equal(stalwart.weak('primaryKeyViolation (name)'), 'primaryKeyViolation (name)');
});

test('james: database moves into the server folder (copied once for older setups, not for a new setup)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-james-'));
  try {
    const dataDir = path.join(root, 'data', 'mailserver-j');
    fs.mkdirSync(path.join(dataDir, 'conf'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data', 'var', 'store', 'derby'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'var', 'store', 'derby', 'service.properties'), 'x');
    const props = path.join(dataDir, 'conf', 'james-database.properties');
    const legacy = 'database.url=jdbc:derby:../var/store/derby;create=true\n';
    const inst = { dataDir: () => dataDir, svc: { configured: () => [] } };
    fs.writeFileSync(props, legacy);
    james.ownDatabase(inst, { copy: false });
    assert.match(fs.readFileSync(props, 'utf8'), /jdbc:derby:var\/store\/derby;/);
    assert.equal(fs.existsSync(path.join(dataDir, 'var', 'store', 'derby')), false, 'new setup: empty database of its own');
    fs.writeFileSync(props, legacy);
    james.ownDatabase(inst);
    assert.equal(fs.existsSync(path.join(dataDir, 'var', 'store', 'derby', 'service.properties')), true, 'older setup: mailboxes come along');
    assert.match(fs.readFileSync(props, 'utf8'), /jdbc:derby:var\/store\/derby;/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
