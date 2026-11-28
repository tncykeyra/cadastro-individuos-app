import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [component, main, domain] = await Promise.all([
  readFile(new URL('../src/react/RecordsList.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/domain.js', import.meta.url), 'utf8')
]);

test('pesquisa React oferece botão explícito e acionamento por Enter', () => {
  assert.match(component, /onClick=\{\(\) => onSearch\(searchValue\)\}/);
  assert.match(component, /event\.key === 'Enter'[\s\S]*?onSearch\(searchValue\)/);
  assert.match(component, /aria-label="Pesquisar"/);
});

test('pesquisa preserva limpeza automática, limite mínimo e orientação ao operador', () => {
  assert.match(component, /if \(!nextValue\.trim\(\) && query\.trim\(\)\) onSearch\(''\)/);
  assert.match(component, /Digite ao menos 3 caracteres úteis/);
  assert.match(domain, /export function isUsefulSearch\(value, minimum = 3\)/);
  assert.match(main, /search_people_list/);
  assert.match(main, /search_vehicles_list/);
  assert.match(main, /loadRelatedSearch\(requestId/);
});

test('cards React formatam CPF e preservam foto e abertura da ficha', () => {
  assert.match(component, /const formattedCpf = formatCpf\(record\.cpf_digits\)/);
  assert.match(component, /record\.photos\?\.find/);
  assert.match(component, /onOpen\(record\.id, entity\)/);
});
