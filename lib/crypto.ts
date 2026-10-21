// ABOUTME: AES-256-GCM encryption/decryption for credential storage.
// ABOUTME: Uses Web Crypto API — compatible with Node.js 18+ and Cloudflare Workers.

function getKey(): Promise<CryptoKey> {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!hex || !/^[a-f0-9]{64}$/i.test(hex)) throw new Error('CREDENTIALS_ENCRYPTION_KEY must be a 32-byte hex string (64 chars)');
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(encoded: string): Promise<string> {
  const key = await getKey();
  const combined = new Uint8Array(atob(encoded).split('').map(c => c.charCodeAt(0)));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
