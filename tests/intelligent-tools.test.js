import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntelligentText, parseIntelligentBundle, inspectRecords, getSmartPersonSearchTerms, duplicateReviewPairKey } from '../src/intelligent-tools.js';

test('interprets explicit individual fields and leaves filiation and other unlabelled text untouched', () => {
  const result = parseIntelligentText('person', 'Nome: JOÃO CARLOS DA SILVA\nCPF: 123.456.789-09\nRG: 45.678.901\nNascido em: 15/03/1990\nCrimes: furto');
  assert.equal(result.full_name, 'JOÃO CARLOS DA SILVA');
  assert.equal(result.cpf_digits, '12345678909');
  assert.equal(result.rg, '45.678.901');
  assert.equal(result.birthday, '15/03/1990');
  assert.equal(result.notes, 'furto');
});

test('interprets labeled vehicle fields and Brazilian plate formats', () => {
  const result = parseIntelligentText('vehicle', 'Placa: ABC1D23\nMarca: Fiat\nModelo: Uno\nCor: Azul');
  assert.equal(result.plate, 'ABC1D23');
  assert.equal(result.make, 'Fiat');
  assert.equal(result.model, 'Uno');
  assert.equal(result.color, 'Azul');
});

test('review flags exact normalized duplicate CPF and plate without modifying records', () => {
  const people = [{ id: 'p1', full_name: 'Pessoa Um', cpf_digits: '123.456.789-09' }, { id: 'p2', full_name: 'Pessoa Dois', cpf_digits: '12345678909' }];
  const vehicles = [{ id: 'v1', plate: 'abc-1234' }, { id: 'v2', plate: 'ABC1234' }];
  const findings = inspectRecords(people, vehicles);
  const cpfPairs=findings.filter(item => item.label === 'Possível CPF duplicado');
  const platePairs=findings.filter(item => item.label === 'Possível placa duplicada');
  assert.equal(cpfPairs.length, 1); assert.equal(cpfPairs[0].duplicateId, 'p2');
  assert.equal(platePairs.length, 1); assert.equal(platePairs[0].duplicateId, 'v2');
  assert.equal(people[0].full_name, 'Pessoa Um');
  assert.equal(vehicles[0].plate, 'abc-1234');
});

test('captures an individual address and keeps it separate from notes', () => {
  const result = parseIntelligentText('person', 'Nome: Maria Aparecida de Souza; CPF: 111.111.111-11 (exemplo); RG: 12.345.678-9; nascimento: 10/05/1985; endereço: Rua das Flores, 123, Centro, Lençóis Paulista; anotações: abordada para verificação.');
  assert.equal(result.full_name, 'Maria Aparecida de Souza');
  assert.equal(result.address_primary, 'Rua das Flores, 123, Centro, Lençóis Paulista');
  assert.equal(result.notes, 'abordada para verificação.');
});

test('smart entry renders examples for both entity types and preserves selected type', async () => {
  const { renderIntelligentEntry } = await import('../src/intelligent-tools.js');
  const person = renderIntelligentEntry('person');
  const vehicle = renderIntelligentEntry('vehicle');
  assert.match(person, /data-smart-example="person"/);
  assert.match(vehicle, /data-smart-kind="vehicle"[^>]*>🚗 Veículo/);
  assert.match(vehicle, /Placa ABC1D23/);
});

test('reads address labels without accents or with natural residence phrasing and keeps notes separate', () => {
  const labeled = parseIntelligentText('person', 'Nome: Ana Souza; endereco: Rua das Acácias, 45, Jardim América, Lençóis Paulista; crimes: furto');
  assert.match(labeled.address_primary, /Rua das Acácias, 45, Jardim América, Lençóis Paulista/i);
  assert.equal(labeled.notes, 'furto');
  const natural = parseIntelligentText('person', 'Ana Souza, mora na Rua das Acácias, 45, Jardim América, Lençóis Paulista; anotações: abordagem no local');
  assert.match(natural.address_primary, /Rua das Acácias, 45, Jardim América, Lençóis Paulista/i);
  assert.equal(natural.notes, 'abordagem no local');
});

test('uses only the individual name for possible duplicate search, never the address', () => {
  assert.deepEqual(getSmartPersonSearchTerms({ full_name: 'Maria de Souza', address_primary: 'Rua das Flores, 123' }), ['Maria de Souza']);
  assert.deepEqual(getSmartPersonSearchTerms({ full_name: 'Al', address_primary: 'Rua das Flores, 123' }), []);
});


test('duplicate review pair key is stable regardless of record order', () => {
  assert.equal(duplicateReviewPairKey('people','b','a'), duplicateReviewPairKey('people','a','b'));
});

test('extracts person and vehicle together from person-first text', () => {
  const result = parseIntelligentBundle('João Carlos da Silva, CPF 123.456.789-09, proprietário de um Gol branco, placa ABC1D23; marca Volkswagen; modelo Gol');
  assert.equal(result.hasPerson, true);
  assert.equal(result.hasVehicle, true);
  assert.match(result.person.full_name, /João Carlos da Silva/);
  assert.equal(result.person.cpf_digits, '12345678909');
  assert.equal(result.vehicle.plate, 'ABC1D23');
  assert.equal(result.vehicle.make, 'Volkswagen');
  assert.equal(result.vehicle.model, 'Gol');
  assert.equal(result.vehicle.color, 'branco');
});

test('extracts person and vehicle together from vehicle-first text', () => {
  const result = parseIntelligentBundle('Corolla prata, placa FGH2J45, pertencente a Carlos Eduardo, CPF 987.654.321-00');
  assert.equal(result.hasPerson, true);
  assert.equal(result.hasVehicle, true);
  assert.equal(result.person.full_name, 'Carlos Eduardo');
  assert.equal(result.vehicle.plate, 'FGH2J45');
  assert.equal(result.vehicle.model, 'Corolla');
  assert.equal(result.vehicle.color, 'prata');
});

test('recognizes VW and GM abbreviations and does not confuse Corolla with the Cor field', () => {
  const vw = parseIntelligentBundle('Gol branco, placa ABC1D23, marca VW');
  const gm = parseIntelligentBundle('Corsa prata, placa FGH2J45, marca GM');
  assert.equal(vw.vehicle.make, 'Volkswagen');
  assert.equal(vw.vehicle.model, 'Gol');
  assert.equal(vw.vehicle.color, 'branco');
  assert.equal(gm.vehicle.make, 'Chevrolet');
  assert.equal(gm.vehicle.model, 'Corsa');
  assert.equal(gm.vehicle.color, 'prata');
});


test('recognizes unlabelled Brazilian street prefixes as person address', () => {
  for (const prefix of ['Rua', 'Avenida', 'Av.', 'Alameda', 'Travessa']) {
    const result = parseIntelligentText('person', `Maria Souza, ${prefix} das Flores, 123, Centro, CPF: 123.456.789-09; Anotações: abordada à noite`);
    assert.match(result.address_primary, new RegExp('^' + prefix.replace('.', '\\.') + ' das Flores, 123, Centro$', 'i'));
    assert.equal(result.cpf_digits, '12345678909');
    assert.match(result.notes, /abordada à noite/i);
  }
});
