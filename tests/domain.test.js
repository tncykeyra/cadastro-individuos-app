import test from 'node:test';
import assert from 'node:assert/strict';
import { isUsefulSearch, normalizePlate, normalizeSearchTerm, isValidPlate } from '../src/domain.js';

test('normalizes search terms and ignores spaces/punctuation', () => {
  assert.equal(normalizeSearchTerm('  João da Silva '), 'JOAODASILVA');
  assert.equal(isUsefulSearch('ab'), false);
  assert.equal(isUsefulSearch(' a b '), false);
  assert.equal(isUsefulSearch('Ana'), true);
});

test('accepts old and Mercosul plate formats only', () => {
  assert.equal(normalizePlate('abc-1234'), 'ABC1234');
  assert.equal(normalizePlate('abc 1d23'), 'ABC1D23');
  assert.equal(isValidPlate('ABC1234'), true);
  assert.equal(isValidPlate('ABC1D23'), true);
  assert.equal(isValidPlate('AB12345'), false);
  assert.equal(isValidPlate('ABC12D3'), false);
});

test('compara hashes visuais de fotos com tolerância pequena', async () => { const { arePhotoHashesSimilar } = await import('../src/domain.js'); assert.equal(arePhotoHashesSimilar('0000000000000000','0000000000000001'), true); assert.equal(arePhotoHashesSimilar('0000000000000000','000000000000001f'), false); assert.equal(arePhotoHashesSimilar('not-a-hash','0000000000000000'), false); });
test('remove duplicatas visuais sem misturar fotos de pessoas associadas', async () => { const { dedupePhotoSources } = await import('../src/domain.js'); const photo = (group, suffix='0000000000000000') => ({ dedupe_group: group, difference_hash: suffix, average_hash: 'ffffffffffffffff' }); const unique = dedupePhotoSources([photo('record'), photo('record','0000000000000001'), photo('person:1'), photo('person:2')]); assert.deepEqual(unique.map(item=>item.dedupe_group), ['record','person:1','person:2']); });
