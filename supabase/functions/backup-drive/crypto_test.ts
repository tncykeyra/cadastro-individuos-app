import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { contentHmacTag, decryptAesGcm, encryptAesGcm, equalBytes } from './crypto.ts';

Deno.test('AES-256-GCM restores only with the matching key and context', async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const data = new TextEncoder().encode('synthetic backup test data');
  const encrypted = await encryptAesGcm(data, key, 'test-context', 'CCBK1');
  const decrypted = await decryptAesGcm(encrypted, key, 'test-context', 'CCBK1');
  assertEquals(equalBytes(decrypted, data), true);
  let wrongKeyRejected = false;
  try { await decryptAesGcm(encrypted, crypto.getRandomValues(new Uint8Array(32)), 'test-context', 'CCBK1'); }
  catch { wrongKeyRejected = true; }
  assertEquals(wrongKeyRejected, true);
});

Deno.test('AES-256-GCM detects tampering and context changes', async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const data = new TextEncoder().encode('synthetic backup test data');
  const encrypted = await encryptAesGcm(data, key, 'test-context', 'CCBK1');
  const altered = encrypted.slice();
  altered[altered.length - 1] ^= 1;
  let tamperingRejected = false;
  try { await decryptAesGcm(altered, key, 'test-context', 'CCBK1'); }
  catch { tamperingRejected = true; }
  assertEquals(tamperingRejected, true);
  let contextRejected = false;
  try { await decryptAesGcm(encrypted, key, 'other-context', 'CCBK1'); }
  catch { contextRejected = true; }
  assertEquals(contextRejected, true);
});

Deno.test('photo deduplication tag is deterministic and content-sensitive', async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const first = new TextEncoder().encode('photo-a');
  const same = new TextEncoder().encode('photo-a');
  const other = new TextEncoder().encode('photo-b');
  const a = await contentHmacTag(key, first);
  assertEquals(a, await contentHmacTag(key, same));
  assertNotEquals(a, await contentHmacTag(key, other));
});
