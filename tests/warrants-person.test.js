import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWarrantPersonSuggestions } from '../src/warrants.js';

test('extracts person fields, multiline name and filiation from a warrant PDF OCR result', () => {
  const text = [
    'MANDADO DE PRISÃO',
    'REQUERIDO(A):',
    'ANA MARIA',
    'DE OLIVEIRA',
    'CPF: 529.982.247-25',
    'RG: 12.345.678 SSP/SP',
    'DATA DE NASCIMENTO: 10/02/1980',
    'ENDEREÇO:',
    'Rua das Flores, 123',
    'Jardim Exemplo',
    'INFORMAÇÕES PROCESSUAIS',
    'Processo nº: 1000000-00.2024.8.26.0000',
    'Ação penal: Exemplo de ocorrência',
    'FILIAÇÃO',
    'NOME DA MÃE: MARIA DE EXEMPLO',
    'NOME DO PAI: JOSE DE EXEMPLO'
  ].join('\n');
  const result = extractWarrantPersonSuggestions(text);
  assert.equal(result.full_name, 'ANA MARIA DE OLIVEIRA');
  assert.equal(result.cpf_digits, '52998224725');
  assert.equal(result.rg, '12.345.678 SSP/SP');
  assert.equal(result.birth_date, '1980-02-10');
  assert.equal(result.address_primary, 'Rua das Flores, 123 Jardim Exemplo');
  assert.equal(result.filiation, 'MARIA DE EXEMPLO\nJOSE DE EXEMPLO');
  assert.match(result.process_information, /Ação penal: Exemplo de ocorrência/);
  assert.equal(result.process_reference, '1000000-00.2024.8.26.0000');
});

test('does not invent missing warrant person fields', () => {
  const result = extractWarrantPersonSuggestions('Mandado de prisão\nInformações processuais\nAção penal: exemplo');
  assert.equal(result.full_name, '');
  assert.equal(result.cpf_digits, '');
  assert.equal(result.rg, '');
  assert.equal(result.address_primary, '');
  assert.equal(result.filiation, '');
});
test('prefers Nome da Pessoa and reads ENDEREÇO(S) without leaking the label', () => {
  const text = [
    'MANDADO DE PRISÃO',
    'Nome do Magistrado: FULANO DE TAL',
    'Nome da Pessoa:',
    'DAVI MARCIO DE SOUZA',
    'JUNIOR',
    'CPF: 592.305.648-85',
    'ENDEREÇO(S):',
    'Rua das Palmeiras, 45',
    'Jardim Central',
    'INFORMAÇÕES PROCESSUAIS',
    'Processo nº: 1000000-00.2024.8.26.0000'
  ].join('\n');
  const result = extractWarrantPersonSuggestions(text);
  assert.equal(result.full_name, 'DAVI MARCIO DE SOUZA JUNIOR');
  assert.equal(result.address_primary, 'Rua das Palmeiras, 45 Jardim Central');
});
