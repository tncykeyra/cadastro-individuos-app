import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPdfTextItems,
  resolveWarrantBatchValues,
  normalizeWarrantText,
  normalizeWarrantName,
  isSpecificWarrantNumber,
  normalizeWarrantProcessNumber,
  parseWarrantCsv,
  extractWarrantSuggestions
} from '../src/warrants.js';

test('recompõe itens de texto do PDF na ordem visual', () => {
  const items = [
    { str: 'SILVA', transform: [1, 0, 0, 10, 60, 100] },
    { str: 'PESSOA', transform: [1, 0, 0, 10, 10, 100] },
    { str: 'MANDADO', transform: [1, 0, 0, 10, 10, 80] }
  ];
  assert.equal(formatPdfTextItems(items), 'PESSOA SILVA\nMANDADO');
  assert.equal(formatPdfTextItems([]), '');
});

test('preserva campos editados vazios durante a revisão em lote', () => {
  assert.deepEqual(
    resolveWarrantBatchValues(
      { full_name: 'NOME EXTRAÍDO', cpf: '123' },
      { full_name: '', cpf: '456' },
      ['full_name', 'cpf', 'mother']
    ),
    { full_name: '', cpf: '456', mother: '' }
  );
});

test('normaliza texto e nome para comparação', () => {
  assert.equal(normalizeWarrantText('  Prisão   Preventiva — AÇÃO '), 'prisao preventiva acao');
  assert.equal(normalizeWarrantName('JOÃO DA SILVA'), 'joao silva');
});

test('distingue número específico de rótulos genéricos de mandado', () => {
  assert.equal(isSpecificWarrantNumber('Prisão preventiva'), false);
  assert.equal(isSpecificWarrantNumber('123456/2026'), true);
  assert.equal(isSpecificWarrantNumber(''), false);
});

test('normaliza número de processo CNJ formatado ou com 20 dígitos', () => {
  assert.equal(normalizeWarrantProcessNumber('0001234-56.2024.8.26.0000'), '00012345620248260000');
  assert.equal(normalizeWarrantProcessNumber('00012345620248260000'), '00012345620248260000');
  assert.equal(normalizeWarrantProcessNumber('processo inválido'), '');
});

test('importa CSV, mantém apenas pendentes e identifica duplicidades', () => {
  const csv = [
    'Número do Mandado;Nome;Situação',
    '123456/2026;PESSOA TESTE;Pendente',
    '123456/2026;OUTRA PESSOA;Pendente',
    '987654/2026;PESSOA BAIXADA;Baixado'
  ].join('\n');

  const result = parseWarrantCsv(csv);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].full_name, 'PESSOA TESTE');
  assert.equal(result.duplicateRows, 1);
  assert.equal(result.skippedNotPending, 1);
});

test('rejeita CSV sem colunas obrigatórias e aspas sem fechamento', () => {
  assert.throws(() => parseWarrantCsv('Nome;Situação\nPESSOA;Pendente'), /colunas de número do mandado e nome/i);
  assert.throws(() => parseWarrantCsv('Número;Nome\n123;"PESSOA'), /aspas sem fechamento/i);
});

test('extrai sugestões básicas de um texto de mandado', () => {
  const result = extractWarrantSuggestions(
    'Em desfavor de: PESSOA DE TESTE\nCPF: 529.982.247-25\nMandado nº: 123456/2026\nData de nascimento: 15/08/1990'
  );
  assert.equal(result.full_name, 'PESSOA DE TESTE');
  assert.equal(result.cpf_digits, '52998224725');
  assert.equal(result.warrant_number, '123456/2026');
  assert.equal(result.birth_date, '1990-08-15');
});
