const test = require('node:test');
const assert = require('node:assert/strict');
const { assertTrustedSender, validateIpcPayload } = require('../electron/ipc-security');

test('IPC rejects senders outside the application renderer', () => {
  const trusted = {};
  assert.throws(() => assertTrustedSender({ sender: {}, senderFrame: { url: 'https://evil.test/' } }, trusted, 'file:///app/renderer.html'), /Untrusted IPC sender/);
  assert.doesNotThrow(() => assertTrustedSender({ sender: trusted, senderFrame: { url: 'file:///app/renderer.html' } }, trusted, 'file:///app/renderer.html'));
});

test('IPC payload validation rejects oversized or non-plain values', () => {
  assert.throws(() => validateIpcPayload({ token: 'x'.repeat(65537) }), /too long/);
  assert.throws(() => validateIpcPayload(new Date()), /plain object/);
  assert.doesNotThrow(() => validateIpcPayload({ faction: 'MUD', filters: ['', 'Fuel'] }));
});
