import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, records, interest, fiscalization] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/RecordsList.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/vehicle-interest.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/fiscalization.js', import.meta.url), 'utf8')
]);

test('indivíduos e veículos pesquisam automaticamente após debounce sem recriar o campo', () => {
  assert.match(records, /setTimeout\(\(\) => onSearchRef\.current\(searchValue\), 300\)/);
  assert.match(records, /const submitSearch = \(\) =>/);
  assert.match(main, /const onSearch=async value=>/);
  assert.match(main, /if\(!peopleReactRoot\)peopleReactRoot=createRoot\(root\)/);
  assert.match(main, /if\(!vehicleReactRoot\)vehicleReactRoot=createRoot\(root\)/);
});

test('mandados filtram a lista a cada alteração e pesquisam associações automaticamente', () => {
  assert.match(main, /warrantSearchInput\.addEventListener\('input',\(\)=>\{state\.warrantQuery=warrantSearchInput\.value;filterWarrantList\(\)\}\)/);
  assert.match(main, /warrantSearchTimers\.set\(warrantId,setTimeout\(\(\)=>\{if\(personSearch\.isConnected/);
  assert.match(main, /container\.innerHTML=results\?\.length\?results\.map\(person=>/);
});

test('pesquisas de associação de indivíduos e veículos usam debounce sem desmontar o diálogo', () => {
  assert.match(main, /associationSearchTimer=setTimeout\(\(\)=>void renderResults\(\),300\)/);
  assert.match(main, /personSearchTimer=setTimeout\(\(\)=>void renderPeopleResults\(\),300\)/);
});

test('veículos de interesse pesquisam a lista e veículos associados em tempo real', () => {
  assert.match(interest, /listSearchTimer=setTimeout\\(\\(\\)=>/);
  assert.match(interest, /interestSearchTimer=setTimeout\\(\\(\\)=>/);
  assert.match(main, /onRefresh:async\(\)=>\{const input=\$\('#interestSearch'\),restore=input&&document\.activeElement===input/);
  assert.match(main, /next\.focus\(\{preventScroll:true\}\)/);
});

test('fiscalização mantém filtragem imediata por evento input', () => {
  assert.match(fiscalization, /root\.addEventListener\('input',[\s\S]*?if \(event\.target\?\.id === 'fiscalizationSearch'\) applyGuideFilters\(\)/);
});
