import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWarrantPersonSuggestions, formatPdfTextItems, resolveWarrantBatchValues } from '../src/warrants.js';

test('reconstructs searchable PDF text in visual line and column order', () => {
  const text = formatPdfTextItems([
    { str: 'JOÃO DA SILVA', transform: [10, 0, 0, 10, 120, 80] },
    { str: 'NOME DA PESSOA:', transform: [10, 0, 0, 10, 10, 80] },
    { str: '123456', transform: [10, 0, 0, 10, 140, 100] },
    { str: 'NÚMERO DO MANDADO:', transform: [10, 0, 0, 10, 10, 100] },
    { str: 'CPF:', transform: [10, 0, 0, 10, 10, 60] }
  ]);
  assert.equal(text, 'NÚMERO DO MANDADO: 123456\nNOME DA PESSOA: JOÃO DA SILVA\nCPF:');
  const parsed = extractWarrantPersonSuggestions(text);
  assert.equal(parsed.warrant_number, '123456');
  assert.equal(parsed.full_name, 'JOÃO DA SILVA');
});

test('PDF OCR form values keep deliberate edits, including cleared fields', () => {
  const fields = ['warrant_number', 'full_name', 'cpf', 'source_reference'];
  const result = resolveWarrantBatchValues(
    { warrant_number: '123456', full_name: 'Nome OCR', cpf: '12345678901', source_reference: 'processo' },
    { warrant_number: '', full_name: 'Nome corrigido', cpf: '', source_reference: '' },
    fields
  );
  assert.deepEqual(result, { warrant_number: '', full_name: 'Nome corrigido', cpf: '', source_reference: '' });
});

test('PDF OCR form values use recognized values only when an edit control is absent', () => {
  assert.deepEqual(
    resolveWarrantBatchValues({ full_name: 'Nome OCR' }, {}, ['full_name', 'cpf']),
    { full_name: 'Nome OCR', cpf: '' }
  );
});
