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
