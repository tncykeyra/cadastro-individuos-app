import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDocumentFields, isValidCpf, isValidCnpj, isValidDocumentDate } from '../src/ocr-domain.js';

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

test('does not misread father or mother names as the individual name', () => {
  const result = extractDocumentFields('NOME DA MÃE: Maria de Souza\nNOME DO PAI: José da Silva\nCPF: 52998224725', 'people', 90);
  assert.equal(result.values.full_name, undefined);
  assert.equal(result.values.mother_name, 'Maria de Souza');
  assert.equal(result.values.father_name, 'José da Silva');
});

test('recognizes SENATRAN label/value pairs and normalizes dates', () => {
  const result = extractDocumentFields('Consulta SENATRAN\nCPF\n529.982.247-25\nNome do Condutor\nAna Maria de Souza\nNúmero do Registro\n01234567890\nCondutor Habilitado\nSim\nValidade\n15/08/2030\nCategoria\nAB', 'people', 91);
  assert.equal(result.type, 'Print de consulta SENATRAN');
  assert.equal(result.values.full_name, 'Ana Maria de Souza');
  assert.equal(result.values.registration, '01234567890');
  assert.equal(result.values.cnh_expiry, '2030-08-15');
  assert.equal(result.values.cnh_category, 'AB');
  assert.equal(result.values.license_status, 'Sim');
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
