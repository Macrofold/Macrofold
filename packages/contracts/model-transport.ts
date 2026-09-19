/** Full serialized provider requests, including replayed image context. Never silently truncate. */
export const modelTransport = {
  inlineBytes: 4 * 1024 * 1024,
  maximumBytes: 8 * 1024 * 1024,
  encryptedOverhead: 28, // 12-byte nonce + 16-byte AES-GCM tag
  uploadHeader: 'x-platform-model-upload',
  uploadPath: '_uploads',
  paths: ['v1/responses', 'v1/chat/completions', 'v1/messages'],
} as const;

/** Web Crypto keeps this wire format shared without exposing the control plane's vault key. */
export async function encryptModelBody(bytes: Uint8Array<ArrayBuffer>, key: Uint8Array<ArrayBuffer>) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const imported = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, imported, bytes),
  );
  const result = new Uint8Array(nonce.length + encrypted.length);
  result.set(nonce);
  result.set(encrypted, nonce.length);
  return result;
}
export async function decryptModelBody(bytes: Uint8Array<ArrayBuffer>, key: Uint8Array<ArrayBuffer>) {
  const imported = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, imported, bytes.slice(12)),
  );
}
