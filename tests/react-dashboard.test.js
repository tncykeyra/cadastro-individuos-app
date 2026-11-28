import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appUrl = new URL('../src/react/App.jsx', import.meta.url);
const cssUrl = new URL('../src/react/react.css', import.meta.url);

test('Painel React mantém os indicadores operacionais existentes', async () => {
  const app = await readFile(appUrl, 'utf8');
  for (const label of [
    'Indivíduos cadastrados',
    'Indivíduos com CPF',
    'Veículos cadastrados',
    'Mandados ativos',
  ]) assert.ok(app.includes(label), 'Indicador ausente: ' + label);
});

test('Painel React apresenta acessos rápidos e identificação da cidade', async () => {
  const app = await readFile(appUrl, 'utf8');
  assert.ok(app.includes('{activeCity.name}'));
  assert.ok(app.includes('Acesso rápido'));
  assert.ok(app.includes("setPage('people')"));
  assert.ok(app.includes("setPage('vehicles')"));
});

test('Estilos do Painel React preservam a paleta institucional', async () => {
  const css = await readFile(cssUrl, 'utf8');
  for (const color of ['#50595e', '#3e474c', '#f6f7f7', '#ffffff', '#e6e8e9', '#f0f1f2']) {
    assert.ok(css.includes(color), 'Cor institucional ausente: ' + color);
  }
});
