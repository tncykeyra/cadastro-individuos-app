import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, main, densityCss, vehiclesCss, people, vehicles, control, pkg, worker, recordsList, recordsCss] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../card-density.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/vehicles-workspace.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/PeopleWorkspace.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/VehiclesWorkspace.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/CardDensityControl.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
  readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/RecordsList.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/RecordsList.jsx.css', import.meta.url), 'utf8'),
]);

test('seletor controlado aparece apenas nas listas de indivíduos e veículos', () => {
  assert.doesNotMatch(index, /card-density-control/);
  assert.match(people, /!detail && <CardDensityControl value=\{density\} onChange=\{changeDensity\} \/>/);
  assert.match(vehicles, /!detail && <CardDensityControl value=\{density\} onChange=\{changeDensity\} \/>/);
  assert.match(control, /data-card-density="large"/);
  assert.match(control, /data-card-density="compact"/);
  assert.match(control, /onClick=\{\(\) => onChange\('large'\)\}/);
  assert.match(control, /onClick=\{\(\) => onChange\('compact'\)\}/);
  assert.match(vehicles, /useState\(getCardDensity\)/);
  assert.match(main, /\.people-react-shell,\.vehicles-react-shell/);
});

test('modo grande de veículos usa cards ampliados e proporção 3:4', () => {
  assert.match(densityCss, /vehicles-react-shell\[data-card-density="large"\]/);
  assert.match(densityCss, /grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,280px\),1fr\)\)/);
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
  assert.equal(JSON.parse(pkg).version, '2.52.14');
  assert.match(worker, /cadastro-app-shell-v152/);
  assert.match(main, /sw\.js\?v=118/);
  assert.match(index, /card-density\.css\?v=4/);
});


test('listagem React efetiva controla densidade e amplia cards de veículos', () => {
  assert.match(recordsList, /CardDensityControl value=\{density\} onChange=\{changeDensity\}/);
  assert.match(recordsList, /data-card-density=\{density\}/);
  assert.match(recordsList, /useState\(getCardDensity\)/);
  assert.match(recordsCss, /react-records-module\[data-card-density="large"\] \.react-record-card\.is-vehicle/);
  assert.match(recordsCss, /aspect-ratio:3\/4/);
  assert.match(recordsCss, /react-records-module\[data-card-density="compact"\] \.react-record-card\.is-vehicle/);
});
