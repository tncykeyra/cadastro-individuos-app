import test from 'node:test';
import assert from 'node:assert/strict';
import { isUsefulSearch, normalizePlate, normalizeSearchTerm, isValidPlate, formatPersonName, normalizeRecordPhotos } from '../src/domain.js';

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

test('formats person names consistently in Brazilian Portuguese while preserving accents and particles', () => {
  assert.equal(formatPersonName('  JOÃO   CARLOS DA SILVA '), 'João Carlos da Silva');
  assert.equal(formatPersonName('luAN d’ávila'), 'Luan D’Ávila');
  assert.equal(formatPersonName('mARIA-CLARA de souza'), 'Maria-Clara de Souza');
  assert.equal(formatPersonName(''), '');
});

test('consolida caminhos repetidos e mantém uma única capa preferindo a capa do cadastro', () => {
  const photos = normalizeRecordPhotos([
    { id: 'old-cover', photo_path: 'people/1/cover.jpg', is_cover: false, crop_position: '25% 35%' },
    { id: 'duplicate-cover', photo_path: 'people/1/cover.jpg', is_cover: true },
    { id: 'extra', photo_path: 'people/1/extra.jpg', is_cover: true },
  ], 'people/1/cover.jpg');
  assert.equal(photos.length, 2);
  assert.equal(photos[0].photo_path, 'people/1/cover.jpg');
  assert.equal(photos[0].is_cover, true);
  assert.equal(photos[0].crop_position, '25% 35%');
  assert.equal(photos.filter(photo => photo.is_cover).length, 1);
});

test('reconhece a mesma foto Supabase apesar de URLs assinadas diferentes', () => {
  const photos = normalizeRecordPhotos([
    { id: 'one', photo_path: 'https://project.supabase.co/storage/v1/object/sign/people-photos/people/1/cover.jpg?token=one' },
    { id: 'two', photo_path: 'https://project.supabase.co/storage/v1/object/public/people-photos/people/1/cover.jpg' },
    { id: 'other', photo_path: 'people/1/other.jpg' },
  ], 'people/1/cover.jpg');
  assert.equal(photos.length, 2);
  assert.equal(photos.filter(photo => photo.is_cover).length, 1);
  assert.equal(photos[0].photo_path.includes('cover.jpg'), true);
});

test('escolhe uma capa estável quando não há marcação explícita', () => {
  const photos = normalizeRecordPhotos([
    { photo_path: 'people/2/a.jpg' },
    { photo_path: 'people/2/b.jpg' },
  ]);
  assert.equal(photos[0].photo_path, 'people/2/a.jpg');
  assert.equal(photos.filter(photo => photo.is_cover).length, 1);
});
