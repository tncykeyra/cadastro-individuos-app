import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWarrantOcrProgress } from '../src/warrants.js';

test('formats OCR progress objects without producing NaN', () => {
  assert.equal(formatWarrantOcrProgress({ status: 'Reconhecendo texto…', percent: 55 }), 'Leitura local: Reconhecendo texto… 55%');
  assert.equal(formatWarrantOcrProgress({ status: 'Preparando página 1 de 2…', percent: 145 }), 'Leitura local: Preparando página 1 de 2… 100%');
  assert.equal(formatWarrantOcrProgress({ status: 'processando', percent: Number.NaN }), 'Leitura local: processando');
  assert.equal(formatWarrantOcrProgress({ status: 'processando', percent: null }), 'Leitura local: processando');
});

test('accepts a numeric progress callback for backward compatibility', () => {
  assert.equal(formatWarrantOcrProgress(0), 'Leitura local: processando 0%');
  assert.equal(formatWarrantOcrProgress(-5), 'Leitura local: processando 0%');
});
