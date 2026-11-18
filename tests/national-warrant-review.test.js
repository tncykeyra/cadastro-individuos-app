import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNationwideWarrantCsv, findWarrantNameCandidates, inferWarrantStateFromFilename } from '../src/national-warrant-review.js';

test('interpreta nomes, filiação, processo, UF e situação sem descartar estados não pendentes', () => {
  const csv='Número;Nome;Alcunha;Nome da mãe;Nome do pai;Número do processo;Estado;Situação\n' +
    '0001;João Carlos da Silva;Joãozinho;Maria da Silva;Pedro Silva;0000001-12.2024.8.26.0001;São Paulo;Pendente\n' +
    '0002;Ana Souza;;Rita Souza;Carlos Souza;0000002-13.2023.8.26.0002;SP;Cumprido';
  const result=parseNationwideWarrantCsv(csv);
  assert.equal(result.records.length,2);
  assert.equal(result.records[0].state,'SP');
  assert.equal(result.records[0].mother_name,'Maria da Silva');
  assert.equal(result.records[0].father_name,'Pedro Silva');
  assert.equal(result.records[0].process_number,'0000001-12.2024.8.26.0001');
  assert.equal(result.records[1].status,'Cumprido');
});

test('usa a UF selecionada quando a planilha não tem estado', () => {
  const result=parseNationwideWarrantCsv('Nome,Número do processo,Situação\nJoão Silva,00000011220248260001,Pendente','SP');
  assert.equal(result.records[0].state,'SP');
  assert.equal(result.rowsMissingState,0);
});

test('marca linhas sem UF para que o operador resolva antes da conferência', () => {
  const result=parseNationwideWarrantCsv('Nome,Número do processo\nJoão Silva,123');
  assert.equal(result.rowsMissingState,1);
  assert.equal(result.records[0].state,'UF não identificada');
});

test('retorna candidatos por nome para revisão, sem declarar vínculo definitivo', () => {
  const records=[{full_name:'João Carlos Silva',source_row:2},{full_name:'Maria Souza',source_row:3}];
  const people=[{id:'p1',full_name:'João Carlos da Silva'},{id:'p2',full_name:'José Eduardo Silva'}];
  const matches=findWarrantNameCandidates(records,people);
  assert.equal(matches[0].candidates[0].id,'p1');
  assert.equal(matches[0].candidates[0].reason,'Nome idêntico');
  assert.ok(matches[0].candidates[0].confidence > 0.9);
  assert.equal(matches[1].candidates.length,0);
});


test('identifies state from spreadsheet filenames for batch uploads', () => {
  assert.equal(inferWarrantStateFromFilename('mandados_SP_2026.csv'),'SP');
  assert.equal(inferWarrantStateFromFilename('BNMP_São Paulo.csv'),'SP');
  assert.equal(inferWarrantStateFromFilename('reportes-gerais.csv'),'');
});


test('recovers a row with an unmatched opening quote instead of aborting the CSV', () => {
  const csv='Nome;Número do processo;Estado;Situação\n"João da Silva;0000001-12.2024.8.26.0001;SP;Pendente';
  const result=parseNationwideWarrantCsv(csv);
  assert.equal(result.records.length,1);
  assert.equal(result.records[0].full_name,'João da Silva');
  assert.equal(result.records[0].state,'SP');
  assert.equal(result.records[0].status,'Pendente');
});


test('identifica mandado já cadastrado pelo número de processo e preserva a informação do app', async () => {
  const { findExistingWarrantRows } = await import('../src/national-warrant-review.js');
  const rows = [
    { full_name: 'João Silva', process_number: '0000001-12.2024.8.26.0001', birth_date: '1980-02-03', mother_name: 'Maria Silva', father_name: 'José Silva' },
    { full_name: 'João Silva', process_number: '0000002-12.2024.8.26.0001', birth_date: '1980-02-03', mother_name: 'Maria Silva', father_name: 'José Silva' }
  ];
  const warrants = [
    { id: 'w1', process_number_digits: '00000011220248260001', full_name: 'João Silva', birth_date: '1980-02-03', mother_name: 'Maria Silva', father_name: 'José Silva', city_id: 'c1', status: 'pending' }
  ];
  const result = findExistingWarrantRows(rows, warrants);
  assert.equal(result[0].existing_warrant_match_type, 'process');
  assert.equal(result[0].existing_warrants[0].id, 'w1');
  assert.equal(result[1].existing_warrant_match_type, '');
});

test('sem processo, só sinaliza possível repetição quando nome, nascimento e filiação coincidem', async () => {
  const { findExistingWarrantRows } = await import('../src/national-warrant-review.js');
  const result = findExistingWarrantRows([
    { full_name: 'João da Silva', birth_date: '03/02/1980', mother_name: 'Maria da Silva', father_name: 'José da Silva' },
    { full_name: 'João da Silva', birth_date: '03/02/1980' }
  ], [
    { id: 'w1', full_name: 'João da Silva', birth_date: '1980-02-03', mother_name: 'Maria da Silva', father_name: 'José da Silva', status: 'pending' }
  ]);
  assert.equal(result[0].existing_warrant_match_type, 'identity');
  assert.equal(result[1].existing_warrant_match_type, '');
});


test('aceita o nome completo do estado na coluna e no nome do arquivo', () => {
  const inColumn = parseNationwideWarrantCsv('Nome;Estado;Número do processo\nJoão Silva;Estado do Acre;0000001-12.2024.8.01.0001');
  assert.equal(inColumn.records[0].state, 'AC');
  assert.equal(inColumn.rowsMissingState, 0);

  const byFilename = parseNationwideWarrantCsv('Nome;Número do processo\nJoão Silva;0000001-12.2024.8.01.0001', inferWarrantStateFromFilename('acre.csv'));
  assert.equal(byFilename.records[0].state, 'AC');
  assert.equal(byFilename.rowsMissingState, 0);
  assert.equal(inferWarrantStateFromFilename('mandados-Estado-do-Acre-2026.csv'), 'AC');
});

test('não aceita sigla de estado inválida como UF', () => {
  const result = parseNationwideWarrantCsv('Nome;Estado\nJoão Silva;XX');
  assert.equal(result.rowsMissingState, 1);
});
