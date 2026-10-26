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

test('stores mother-only SENATRAN data as filiation without creating parent fields', () => {
  const result = extractDocumentFields('NOME DA MÃE: Maria de Souza\nNOME DO PAI: José da Silva\nCPF: 52998224725', 'people', 90);
  assert.equal(result.values.full_name, undefined);
  assert.equal(result.values.filiation, 'Maria de Souza');
  assert.equal(result.values.father_name, undefined);
  assert.equal(result.formValues.filiation, 'Maria de Souza');
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


test('recognizes physical and digital CNH label variants with parentheses and no comma', () => {
  const result = extractDocumentFields([
    '(2 e 1) NOME E SOBRENOME',
    'PESSOA EXEMPLO DA SILVA',
    '3 DATA LOCAL E UF DE NASCIMENTO',
    '12/04/1990 LENCOIS PAULISTA/SP',
    '4C DOC. IDENTIDADE/ORG. EMISSOR/UF',
    '12.345.678 SSP SP',
    '4D CPF',
    '529.982.247-25',
    'FILIAÇÃO',
    'MARIA EXEMPLO UM',
    'JOSE EXEMPLO DOIS',
    '7 ASSINATURA DO PORTADOR',
    'ASSINATURA EXEMPLO'
  ].join('\n'), 'people', 55);
  assert.equal(result.values.full_name, 'PESSOA EXEMPLO DA SILVA');
  assert.equal(result.values.birthday, '1990-04-12');
  assert.equal(result.values.rg, '12.345.678 SSP SP');
  assert.equal(result.values.cpf_digits, '52998224725');
  assert.equal(result.values.filiation, 'MARIA EXEMPLO UM\nJOSE EXEMPLO DOIS');
  assert.deepEqual(Object.keys(result.formValues).sort(), ['birthday', 'cpf_digits', 'filiation', 'full_name', 'rg']);
});


test('recognizes vehicle Senatran query fields and fills the existing vehicle form values', () => {
  const result = extractDocumentFields([
    'Veículo (pesquisa por placa)',
    'Resultado da pesquisa',
    'Dados do Veículo',
    'Placa Renavam',
    'DPG4B21 01275566950',
    'Número do motor Chassi',
    'KC22E0N116367 9C2KC2200NR116307',
    'Marca / Modelo',
    'HONDA/CG 160 FAN',
    'Município / UF',
    'LENCOIS PAULISTA / SP',
    'Cor Combustível',
    'VERMELHA ALCOOL/GASOLINA',
    'Tipo Espécie',
    'MOTOCICLETA PASSAGEIRO'
  ].join('\\n'), 'vehicles', 55);
  assert.equal(result.type, 'Print de consulta veicular SENATRAN');
  assert.equal(result.values.plate, 'DPG4B21');
  assert.equal(result.values.make, 'HONDA');
  assert.equal(result.values.model, 'CG 160 FAN');
  assert.equal(result.values.color, 'VERMELHA');
  assert.deepEqual(result.formValues, { plate: 'DPG4B21', make: 'HONDA', model: 'CG 160 FAN', color: 'VERMELHA' });
  assert.equal(result.details.filter(item => item.key === 'make').length, 1);
  assert.equal(result.details.filter(item => item.key === 'model').length, 1);
});

test('does not treat the word after a vehicle label as its value when it is another field label', () => {
  const result = extractDocumentFields('Dados do Veículo\\nPlaca Renavam\\nABC1D23 01275566950\\nMarca / Modelo\\nHONDA/CG 160 FAN\\nCor Combustível\\nVERMELHA ALCOOL/GASOLINA', 'vehicles', 87);
  assert.equal(result.values.plate, 'ABC1D23');
  assert.equal(result.values.make, 'HONDA');
  assert.equal(result.values.model, 'CG 160 FAN');
  assert.equal(result.values.color, 'VERMELHA');
});
