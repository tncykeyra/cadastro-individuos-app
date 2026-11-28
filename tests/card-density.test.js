import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, main, density, vehicles, pkg, worker] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../card-density.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/vehicles-workspace.css', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
  readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
]);

test('seletor de densidade oferece dois botões acessíveis com ícones e estado selecionado', () => {
  assert.match(index, /class="card-density-control" role="group"/);
  assert.match(index, /data-card-density="large"/);
  assert.match(index, /data-card-density="compact"/);
  assert.match(index, /aria-label="Cards grandes"/);
  assert.match(index, /aria-label="Miniaturas"/);
  assert.match(index, /<svg viewBox="0 0 24 24"/);
  assert.match(main, /button\[data-card-density\]/);
  assert.match(main, /aria-pressed/);
  assert.match(main, /cadastro-criminal-card-density-v1/);
});

test('cards grandes de veículos permanecem grandes inclusive no mobile', () => {
  assert.match(density, /data-card-density="large".*\.vehicles-react-content \.vehicle-cards/);
  assert.match(density, /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(density, /vehicle-card \.card-photo-gallery/);
  assert.match(density, /height:210px/);
  assert.match(density, /data-card-density="compact".*\.vehicles-react-content \.vehicle-cards/);
  assert.match(density, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(vehicles, /\.vehicle-cards/);
});

test('versão, cache e atualização do service worker acompanham a correção', () => {
  assert.equal(JSON.parse(pkg).version, '2.52.10');
  assert.match(worker, /cadastro-app-shell-v148/);
  assert.match(main, /sw\.js\?v=115/);
  assert.match(index, /card-density\.css\?v=2/);
});
