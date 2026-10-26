const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}
export async function encryptAesGcm(
  plaintext: Uint8Array,
  rawKey: Uint8Array,
  additionalData: string,
  prefix: string,
) {
  if (rawKey.length !== 32) throw new Error('AES-256 key must be 32 bytes');
  const key = await crypto.subtle.importKey('raw', buffer(rawKey), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM', iv, additionalData: encoder.encode(additionalData),
  }, key, buffer(plaintext)));
  return concat([encoder.encode(prefix), iv, cipher]);
}
export async function decryptAesGcm(
  envelope: Uint8Array,
  rawKey: Uint8Array,
  additionalData: string,
  prefix: string,
) {
  if (rawKey.length !== 32) throw new Error('AES-256 key must be 32 bytes');
  const prefixBytes = encoder.encode(prefix);
  if (envelope.length <= prefixBytes.length + 12 + 16) throw new Error('Encrypted envelope is incomplete');
  for (let index = 0; index < prefixBytes.length; index++) {
    if (envelope[index] !== prefixBytes[index]) throw new Error('Encrypted envelope version is unsupported');
  }
  const iv = envelope.slice(prefixBytes.length, prefixBytes.length + 12);
  const cipher = envelope.slice(prefixBytes.length + 12);
  const key = await crypto.subtle.importKey('raw', buffer(rawKey), { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv, additionalData: encoder.encode(additionalData),
  }, key, buffer(cipher));
  return new Uint8Array(plaintext);
}
export async function contentHmacTag(masterKey: Uint8Array, bytes: Uint8Array) {
  if (masterKey.length !== 32) throw new Error('AES-256 key must be 32 bytes');
  const material = await crypto.subtle.importKey('raw', buffer(masterKey), 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('cadastro-criminal'),
    info: encoder.encode('media-deduplication-v1'),
  }, material, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  const tag = new Uint8Array(await crypto.subtle.sign('HMAC', key, buffer(bytes)));
  return [...tag].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a[index] ^ b[index];
  return diff === 0;
}
export function decodeUtf8(bytes: Uint8Array) { return decoder.decode(bytes); }
