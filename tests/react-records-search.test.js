import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [component, main, domain] = await Promise.all([
  readFile(new URL('../src/react/RecordsList.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/domain.js', import.meta.url), 'utf8')
]);

test('pesquisa React oferece botão explícito e acionamento por Enter', () => {
  assert.match(component, /onClick=\{submitSearch\}/);
  assert.match(component, /event\.key === 'Enter'[\s\S]*?submitSearch\(\)/);
  assert.match(component, /aria-label="Pesquisar"/);
});

test('pesquisa preserva limpeza automática, limite mínimo e orientação ao operador', () => {
  assert.match(component, /setTimeout\(\(\) => onSearchRef\.current\(searchValue\), 300\)/);
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

test('pesquisa mantém a raiz React e não rouba o foco durante atualizações', async () => {
  assert.match(main, /if\(!peopleReactRoot\)peopleReactRoot=createRoot\(root\)/);
  assert.match(main, /if\(!vehicleReactRoot\)vehicleReactRoot=createRoot\(root\)/);
  assert.doesNotMatch(main, /if\(peopleReactRoot\)\{peopleReactRoot\.unmount\(\);peopleReactRoot=null\}[\s\S]{0,160}const renderRoot=createRoot\(root\)/);
  assert.doesNotMatch(main, /root\.focus\(\{preventScroll:true\}\);\s*}\s*async function renderRecords\(\)/);
  assert.match(component, /type="text" inputMode="search" enterKeyHint="search"/);
});


test('alfabeto fica logo abaixo da pesquisa em uma faixa horizontal deslizável', () => {
  assert.match(component, /react-records-search-wrap[\\s\\S]*?react-records-search[\\s\\S]*?react-record-letters/);
  assert.match(component, /aria-label="Filtrar indivíduos pela inicial"/);
  assert.match(component, /letters\\.map\\(item => <Button/);
  assert.doesNotMatch(component, /react-records-toolbar[\\s\\S]{0,220}react-record-letters/);
  assert.match(css, /react-record-letters\\{[^}]*overflow-x:auto[^}]*flex-wrap:nowrap/);
  assert.match(css, /-webkit-overflow-scrolling:touch/);
  assert.match(css, /react-record-letters \\.ui-button\\{flex:0 0 auto/);
});
