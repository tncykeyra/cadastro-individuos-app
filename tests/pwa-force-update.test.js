import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [worker, main, pkg] = await Promise.all([
  readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8')
]);

test('PWA usa um novo cache de shell para descartar os arquivos da versão anterior', () => {
  assert.match(worker, /cadastro-app-shell-v146/);
  assert.match(worker, /self\.skipWaiting\(\)/);
  assert.match(worker, /self\.clients\.claim\(\)/);
  assert.match(worker, /keys\.filter\(key=>key!==CACHE\)/);
});

test('clientes instalados solicitam a nova versão do service worker sem cache HTTP', () => {
  assert.match(main, /sw\.js\?v=112/);
  assert.match(main, /updateViaCache:'none'/);
  assert.match(main, /registration\.update\(\)/);
  assert.match(main, /setInterval\(\(\)=>\{if\(document\.visibilityState==='visible'\)/);
  assert.match(main, /navigator\.serviceWorker\.addEventListener\('controllerchange'/);
});

test('nova versão pública do aplicativo é identificada na interface', () => {
  assert.equal(JSON.parse(pkg).version, '2.52.8');
});
