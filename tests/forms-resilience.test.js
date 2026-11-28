import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, cities, fiscalization, vehicleInterest] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/CitiesWorkspace.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/fiscalization.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/vehicle-interest.js', import.meta.url), 'utf8')
]);

test('formulário de cidade preserva o nome se a gravação falhar', () => {
  assert.match(cities, /const saved=await run\('create',\(\)=>onCreate\(name\)\);if\(saved\)setNewCityName\(''\)/);
  assert.doesNotMatch(cities, /setNewCityName\(''\);void run\('create'/);
});

test('formulário de permissões informa seleções ausentes antes de gravar', () => {
  assert.match(cities, /if\(!selectedUser\)\{setActionError\('Selecione um usuário\.'/);
  assert.match(cities, /if\(!selected\.length\)\{setActionError\('Selecione ao menos uma cidade/);
  assert.match(cities, /if\(busy\)return false/);
});

test('formulário de fiscalização valida sessão dentro do ciclo protegido de envio', () => {
  const start = fiscalization.indexOf("root.addEventListener('submit'");
  const end = fiscalization.indexOf("\n  });", start);
  const handler = fiscalization.slice(start, end);
  assert.match(handler, /form\.dataset\.submitting = 'true'/);
  assert.match(handler, /try\s*\{\s*const \{ data: authData, error: authError \} = await client\.auth\.getUser\(\)/);
  assert.match(handler, /if \(!authData\?\.user\?\.id\)/);
  assert.match(handler, /finally \{ form\.dataset\.submitting = 'false'/);
});

test('alteração de senha impede repetição e mantém a tela utilizável em caso de erro', () => {
  const start = main.indexOf("$('#newPasswordForm').onsubmit");
  const end = main.indexOf("\nfunction loadingPage", start);
  const handler = main.slice(start, end);
  assert.match(handler, /form\.dataset\.submitting==='true'/);
  assert.match(handler, /password\.length<12/);
  assert.match(handler, /catch\(error\)\{toast\(msg\(error\)\)\}/);
  assert.match(handler, /finally\{form\.dataset\.submitting='false'/);
});

test('formulários de mandados bloqueiam submissões concorrentes e reabilitam o botão', () => {
  const start = main.indexOf("document.addEventListener('submit',async event=>");
  const end = main.indexOf("\n\n\ndocument.addEventListener('click'", start);
  const handler = main.slice(start, end);
  assert.match(handler, /form\.dataset\.submitting==='true'/);
  assert.match(handler, /submit\.disabled=true/);
  assert.match(handler, /finally\{form\.dataset\.submitting='false'/);
});

test('cadastro de indivíduos e veículos e veículos de interesse já protegem a gravação contra repetição', () => {
  assert.match(main, /if\(recordSaveInProgress\)return/);
  assert.match(vehicleInterest, /if\(operationBusy\)return;operationBusy=true/);
});
