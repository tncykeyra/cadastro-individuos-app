import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWarrantProcessNumber, parseWarrantCsv } from '../src/warrants.js';

test('normalizes Brazilian CNJ process numbers and digit-only values', () => {
  assert.equal(normalizeWarrantProcessNumber('Processo: 1000000-00.2024.8.26.0000'), '10000000020248260000');
  assert.equal(normalizeWarrantProcessNumber('10000000020248260000'), '10000000020248260000');
  assert.equal(normalizeWarrantProcessNumber('Referência administrativa 123'), '');
});

test('retains duplicate process rows for administrator review instead of discarding them', () => {
  const csv = [
    'Número do mandado;Nome completo;Processo;Situação',
    'MP-001;Pessoa de Teste Um;1000000-00.2024.8.26.0000;Pendente',
    'MP-002;Pessoa de Teste Dois;1000000-00.2024.8.26.0000;Pendente',
    'MP-003;Pessoa de Teste Três;2000000-00.2025.8.26.0000;Pendente'
  ].join('\n');
  const parsed = parseWarrantCsv(csv);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.duplicateRows, 1);
  assert.equal(parsed.duplicateProcessRows, 1);
  assert.deepEqual(parsed.records.map(row => row.warrant_number), ['MP-001', 'MP-003']);
  assert.equal(parsed.duplicateRecords.length, 1);
  assert.equal(parsed.duplicateRecords[0].record.warrant_number, 'MP-002');
  assert.equal(parsed.duplicateRecords[0].duplicate_reason, 'csv_duplicate');
});
