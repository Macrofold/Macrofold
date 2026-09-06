import { createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { v7 } from 'uuid';
import { config } from './config';
export const id = () => v7();
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const token = (prefix = 'sk') => `${prefix}_${randomBytes(32).toString('base64url')}`;
export class Vault {
  constructor(
    private legacyKey: string,
    private keys: Record<string, string> = {},
    private active?: string,
  ) {
    for (const [name, key] of Object.entries(keys))
      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name) || typeof key !== 'string' || key.length < 32)
        throw new Error('Invalid vault keyring configuration');
    if (active && !keys[active]) throw new Error('The active vault key is missing');
  }
  seal(value: unknown) {
    const header = this.active ? `v2.${this.active}` : 'v1',
      nonce = randomBytes(12);
    const key = createHash('sha256')
      .update(this.active ? this.keys[this.active] : this.legacyKey)
      .digest();
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    if (this.active) cipher.setAAD(Buffer.from(header));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return `${header}.${nonce.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  }
  unseal<T>(value: string): T {
    const parts = value.split('.'),
      version = parts.shift();
    if (version !== 'v1' && version !== 'v2') throw new Error('Unsupported encrypted value version');
    const kid = version === 'v2' ? parts.shift() : undefined;
    if (parts.length !== 3) throw new Error('Invalid encrypted value');
    const secret = version === 'v2' ? this.keys[kid!] : this.legacyKey;
    if (!secret) throw new Error('An encryption key required for this value is unavailable');
    const [nonce, tag, data] = parts;
    const cipher = createDecipheriv(
      'aes-256-gcm',
      createHash('sha256').update(secret).digest(),
      Buffer.from(nonce, 'base64url'),
    );
    if (version === 'v2') cipher.setAAD(Buffer.from(`v2.${kid}`));
    cipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(
      Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString(),
    );
  }
}
function vault() {
  return new Vault(
    config.vaultKey,
    JSON.parse(process.env.VAULT_KEYRING_JSON || '{}'),
    process.env.VAULT_ACTIVE_KEY_ID || undefined,
  );
}
export function seal(value: unknown) {
  return vault().seal(value);
}
export function unseal<T>(value: string): T {
  return vault().unseal<T>(value);
}
export function sameSecret(a: string, b: string) {
  const aa = Buffer.from(sha256(a)),
    bb = Buffer.from(sha256(b));
  return timingSafeEqual(aa, bb);
}
