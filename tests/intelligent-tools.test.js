import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntelligentText, inspectRecords } from '../src/intelligent-tools.js';

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
  assert.equal(findings.filter(item => item.label === 'Possível CPF duplicado').length, 1);
  assert.equal(findings.filter(item => item.label === 'Possível placa duplicada').length, 1);
  assert.equal(people[0].full_name, 'Pessoa Um');
  assert.equal(vehicles[0].plate, 'abc-1234');
});
