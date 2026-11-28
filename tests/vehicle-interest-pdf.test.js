import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVehicleInterestPdf } from '../src/vehicle-interest-pdf.js';

test('gera um PDF estruturalmente válido mesmo sem veículos', () => {
  const pdf = buildVehicleInterestPdf({
    rows: [],
    cityName: 'CIDADE DE TESTE',
    generatedAt: new Date('2026-01-15T12:00:00Z')
  });
  const content = Buffer.from(pdf).toString('latin1');

  assert.equal(Buffer.from(pdf.slice(0, 8)).toString('ascii'), '%PDF-1.4');
  assert.match(content, /\/Type \/Catalog/);
  assert.match(content, /\/Count 1/);
  assert.match(content, /%%EOF/);
});

test('gera página com os dados fornecidos do veículo', () => {
  const pdf = buildVehicleInterestPdf({
    rows: [{
      plate_letters: 'ABC',
      plate_numbers: '1D23',
      model: 'VEICULO TESTE',
      year: '2020',
      color: 'BRANCO',
      incident_type: 'furto',
      plate_city: 'CIDADE DE TESTE',
      occurrence_locat: 'RUA DE TESTE'
    }],
    cityName: 'CIDADE DE TESTE',
    generatedAt: new Date('2026-01-15T12:00:00Z')
  });
  const content = Buffer.from(pdf).toString('latin1');

  assert.match(content, /<41424331443233>/);
  assert.match(content, /<56454943554C4F205445535445>/);
  assert.match(content, /\/Count 1/);
});
