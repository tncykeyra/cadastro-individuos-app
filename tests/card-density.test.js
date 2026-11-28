import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, main, densityCss, vehiclesCss, people, vehicles, control, pkg, worker] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../card-density.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/vehicles-workspace.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/PeopleWorkspace.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/VehiclesWorkspace.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/CardDensityControl.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
  readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
]);

test('seletor de densidade aparece apenas nas listas de indivíduos e veículos', () => {
  assert.doesNotMatch(index, /card-density-control/);
  assert.match(people, /!detail && <CardDensityControl \/>/);
  assert.match(vehicles, /!detail && <CardDensityControl \/>/);
  assert.match(control, /data-card-density="large"/);
  assert.match(control, /data-card-density="compact"/);
  assert.match(control, /aria-pressed/);\n  assert.match(control, /onChange=\\{\\(\\) => onChange\\('large'\\)\\}/);\n  assert.match(vehicles, /useState\\(getCardDensity\\)/);
  assert.match(main, /\.people-react-shell,\.vehicles-react-shell/);
  assert.doesNotMatch(main, /document\.documentElement\.dataset\.cardDensity/);
});

test('modo grande de veículos usa a proporção 3:4 e a mesma grade dos indivíduos', () => {
  assert.match(densityCss, /vehicles-react-shell\[data-card-density="large"\]/);
  assert.match(densityCss, /grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,240px\),1fr\)\)/);
  assert.match(densityCss, /aspect-ratio:3\/4/);
  assert.match(vehiclesCss, /vehicle-cards/);
});

test('modo miniatura fica limitado aos cartões das duas abas', () => {
  assert.match(densityCss, /people-react-shell\[data-card-density="compact"\]/);
  assert.match(densityCss, /vehicles-react-shell\[data-card-density="compact"\]/);
  assert.doesNotMatch(densityCss, /:root\[data-card-density/);
  assert.doesNotMatch(densityCss, /#mainContent \.react-record-grid/);
});

test('versão, cache e atualização do service worker acompanham a correção', () => {
  assert.equal(JSON.parse(pkg).version, '2.52.13');
  assert.match(worker, /cadastro-app-shell-v151/);
  assert.match(main, /sw\.js\?v=117/);
  assert.match(index, /card-density\.css\?v=3/);
});
