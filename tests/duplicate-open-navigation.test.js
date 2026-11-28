import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('abrir veículo encontrado na pesquisa fecha o diálogo antes de carregar a ficha', () => {
  assert.match(main, /const ov=e\.target\.closest\('\[data-open-vehicle\]'\);if\(ov\)\{const recordId=ov\.dataset\.openVehicle;if\(\$\('#recordDialog'\)\?\.open\)\$\('#recordDialog'\)\.close\(\);await openVehicle\(recordId\);return\}/);
});

test('abrir indivíduo encontrado por CPF ou nome fecha o diálogo e aguarda a ficha', () => {
  assert.match(main, /duplicateNotice\.querySelectorAll\('\[data-open-duplicate-person\]'\)\.forEach\(button=>button\.onclick=async\(\)=>\{const recordId=button\.dataset\.openDuplicatePerson;if\(!recordId\)return;button\.disabled=true;try\{if\(dialog\.open\)dialog\.close\(\);await openPerson\(recordId\)\}/);
  assert.match(main, /Não foi possível abrir o cadastro do indivíduo/);
});

test('abertura de cadastro existente não depende do botão salvar nem cria novo registro', () => {
  assert.match(main, /data-open-vehicle=/);
  assert.match(main, /data-open-duplicate-person=/);
  assert.match(main, /await openVehicle\(recordId\)/);
  assert.match(main, /await openPerson\(recordId\)/);
});
