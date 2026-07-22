function assertTrustedSender(event, trustedWebContents, expectedUrl) {
  const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
  if (!trustedWebContents || event?.sender !== trustedWebContents || senderUrl !== expectedUrl) {
    throw new Error('Untrusted IPC sender');
  }
}

function validateIpcPayload(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return;
  if (typeof value === 'string') {
    if (value.length > 65536) throw new Error('IPC payload string is too long');
    return;
  }
  if (depth >= 8) throw new Error('IPC payload is too deeply nested');
  if (Array.isArray(value)) {
    if (value.length > 1000) throw new Error('IPC payload array is too large');
    value.forEach((item) => validateIpcPayload(item, depth + 1));
    return;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('IPC payload must contain only plain objects');
  }
  const entries = Object.entries(value);
  if (entries.length > 200) throw new Error('IPC payload object is too large');
  entries.forEach(([key, item]) => {
    if (key.length > 128) throw new Error('IPC payload key is too long');
    validateIpcPayload(item, depth + 1);
  });
}

module.exports = { assertTrustedSender, validateIpcPayload };
