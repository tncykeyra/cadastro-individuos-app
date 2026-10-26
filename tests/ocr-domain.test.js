import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDocumentFields, extractFiliationFromNotes, isValidCpf, isValidCnpj, isValidDocumentDate, mergeFiliationIntoNotes } from '../src/ocr-domain.js';

test('validates CPF digits before making them applicable', () => {
  assert.equal(isValidCpf('529.982.247-25'), true);
  const result = extractDocumentFields('CPF: 529.982.247-25\nNome completo: Ana Maria de Souza', 'people', 92);
  assert.equal(result.formValues.cpf_digits, '52998224725');
  assert.equal(result.formValues.full_name, 'Ana Maria de Souza');
});

test('validates CNPJ when recognized as owner document', () => {
  assert.equal(isValidCnpj('11.222.333/0001-81'), true);
  const result = extractDocumentFields('CPF/CNPJ do proprietário: 11.222.333/0001-80', 'vehicles', 90);
  assert.match(result.warnings.join(' '), /CNPJ/);
});

test('flags an invalid CPF and does not make it applicable', () => {
  const result = extractDocumentFields('CPF: 111.111.111-11', 'people', 88);
  assert.equal(result.values.cpf_digits, '11111111111');
  assert.equal(Object.hasOwn(result.formValues, 'cpf_digits'), false);
  assert.match(result.warnings.join(' '), /CPF/);
});

test('does not expose parent names as separate fields; mother-only SENATRAN value becomes filiation', () => {
  const result = extractDocumentFields('NOME DA MÃE: Maria de Souza\nNOME DO PAI: José da Silva\nCPF: 52998224725', 'people', 90);
  assert.equal(result.values.full_name, undefined);
  assert.equal(result.values.filiation, 'Maria de Souza');
  assert.deepEqual(result.formValues, { cpf_digits: '52998224725', filiation: 'Maria de Souza' });
  assert.equal(result.details.some(item => item.key === 'mother_name' || item.key === 'father_name'), false);
});

test('joins a CNH name across lines and recognizes 4C RG, 4D CPF and birth date', () => {
  const result = extractDocumentFields([
    '1 e 2 NOME E SOBRENOME',
    'JOÃO CARLOS DA SILVA',
    'OLIVEIRA',
    '3 DATA E LOCAL DE NASCIMENTO',
    '03/08/1980 SÃO PAULO/SP',
    '4C DOC. IDENTIDADE/ORG. EMISSOR/UF',
    '12.345.678 SSP SP',
    '4D - CPF',
    '529.982.247-25',
    'FILIAÇÃO',
    'ALEXANDRE DOS SANTOS',
    'ELIANA MIGUEL BARBOSA DOS SANTOS'
  ].join('\n'), 'people', 92);
  assert.equal(result.values.full_name, 'JOÃO CARLOS DA SILVA OLIVEIRA');
  assert.equal(result.values.birthday, '1980-08-03');
  assert.equal(result.values.rg, '12.345.678 SSP SP');
  assert.equal(result.values.cpf_digits, '52998224725');
  assert.equal(result.values.filiation, 'ALEXANDRE DOS SANTOS\nELIANA MIGUEL BARBOSA DOS SANTOS');
  assert.deepEqual(Object.keys(result.formValues).sort(), ['birthday', 'cpf_digits', 'filiation', 'full_name', 'rg']);
  assert.equal(result.details.find(item => item.key === 'filiation').supported, true);
  assert.equal(result.details.find(item => item.key === 'registration'), undefined);
});

test('joins SENATRAN names across lines but never treats CNH registration or expiry as form fields', () => {
  const result = extractDocumentFields('Consulta SENATRAN\nCPF\n529.982.247-25\nNome do Condutor\nAna Maria de Souza\nOliveira\nNúmero do Registro\n01234567890\nCondutor Habilitado\nSim\nValidade\n15/08/2030\nCategoria\nAB', 'people', 91);
  assert.equal(result.type, 'Print de consulta SENATRAN');
  assert.equal(result.values.full_name, 'Ana Maria de Souza Oliveira');
  assert.equal(result.values.registration, '01234567890');
  assert.equal(result.values.cnh_expiry, '2030-08-15');
  assert.equal(result.values.cnh_category, 'AB');
  assert.equal(result.values.license_status, 'Sim');
  assert.equal(Object.hasOwn(result.formValues, 'registration'), false);
  assert.equal(Object.hasOwn(result.formValues, 'cnh_expiry'), false);
  assert.equal(Object.hasOwn(result.formValues, 'cnh_category'), false);
});

test('extracts vehicle data without fabricating unsupported database fields', () => {
  const result = extractDocumentFields('CRLV-e\nPlaca: ABC1D23\nMarca/Modelo: FIAT/ARGO\nCor: Branco\nRENAVAM: 01234567890', 'vehicles', 89);
  assert.equal(result.values.plate, 'ABC1D23');
  assert.equal(result.values.make, 'FIAT');
  assert.equal(result.values.model, 'ARGO');
  assert.equal(result.formValues.plate, 'ABC1D23');
  assert.equal(result.formValues.make, 'FIAT');
  assert.equal(Object.hasOwn(result.formValues, 'renavam'), false);
  assert.equal(result.details.find(item => item.key === 'renavam').supported, false);
});

test('flags invalid dates and vehicle plates for review', () => {
  const person = extractDocumentFields('Data de nascimento: 31/02/2000', 'people', 80);
  const vehicle = extractDocumentFields('Placa: A1', 'vehicles', 80);
  assert.equal(isValidDocumentDate('31/02/2000'), false);
  assert.equal(Object.hasOwn(person.formValues, 'birthday'), false);
  assert.match(person.warnings.join(' '), /Data/);
  assert.equal(Object.hasOwn(vehicle.formValues, 'plate'), false);
  assert.match(vehicle.warnings.join(' '), /Placa/);
});

test('preserves existing notes and appends or replaces filiation without duplicating it', () => {
  const notes = 'Anotação já existente';
  const appended = mergeFiliationIntoNotes(notes, 'ALEXANDRE DOS SANTOS\nELIANA MIGUEL BARBOSA DOS SANTOS');
  assert.equal(appended, 'Anotação já existente\n\nFiliação:\nALEXANDRE DOS SANTOS\nELIANA MIGUEL BARBOSA DOS SANTOS');
  assert.equal(mergeFiliationIntoNotes(appended, 'ALEXANDRE DOS SANTOS\nELIANA MIGUEL BARBOSA DOS SANTOS'), appended);
  const updated = mergeFiliationIntoNotes(appended, 'MARIA DE SOUZA');
  assert.equal(updated, 'Anotação já existente\n\nFiliação:\nMARIA DE SOUZA');
  assert.equal(extractFiliationFromNotes(updated), 'MARIA DE SOUZA');
  const withFollowingNote = appended + '\nCrimes\nFurto';
  const replaced = mergeFiliationIntoNotes(withFollowingNote, 'MARIA DE SOUZA');
  assert.equal(replaced, 'Anotação já existente\n\nCrimes\nFurto\n\nFiliação:\nMARIA DE SOUZA');
});
