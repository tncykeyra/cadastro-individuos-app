import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appUrl = new URL('../src/react/App.jsx', import.meta.url);
const cssUrl = new URL('../src/react/react.css', import.meta.url);
const dashboardUrl = new URL('../src/react/CityDashboard.jsx', import.meta.url);
const dashboardCssUrl = new URL('../src/react/city-dashboard.css', import.meta.url);
const mainUrl = new URL('../src/main.js', import.meta.url);

test('Painel React mantém os indicadores operacionais existentes', async () => {
  const app = await readFile(appUrl, 'utf8');
  for (const label of ['Indivíduos cadastrados','Indivíduos com CPF','Veículos cadastrados','Mandados ativos']) {
    assert.ok(app.includes(label), 'Indicador ausente: ' + label);
  }
});

test('Prévia React apresenta acessos rápidos e identificação da cidade', async () => {
  const app = await readFile(appUrl, 'utf8');
  assert.ok(app.includes('{activeCity.name}'));
  assert.ok(app.includes('Acesso rápido'));
  assert.ok(app.includes("setPage('people')"));
  assert.ok(app.includes("setPage('vehicles')"));
});

test('Painel integrado preserva dados e atalhos sem oferecer retorno à interface clássica', async () => {
  const dashboard = await readFile(dashboardUrl, 'utf8');
  const main = await readFile(mainUrl, 'utf8');
  for (const label of ['Indivíduos cadastrados','Indivíduos com foto','Veículos cadastrados','Mandados ativos']) {
    assert.ok(dashboard.includes(label), 'Elemento ausente no painel: ' + label);
  }
  assert.ok(!dashboard.includes('Voltar ao painel clássico'));
  assert.ok(!main.includes('onSwitchClassic'));
});

test('Estilos preservam a paleta institucional e oferecem layout responsivo', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const dashboardCss = await readFile(dashboardCssUrl, 'utf8');
  for (const color of ['#50595e','#3e474c','#f6f7f7','#ffffff','#e6e8e9','#f0f1f2']) {
    assert.ok(css.includes(color), 'Cor institucional ausente: ' + color);
  }
  assert.ok(dashboardCss.includes('@media(max-width:700px)'));
  assert.ok(dashboardCss.includes('var(--ink'));
});


test('Painel moderno é padrão para todos os usuários, ignorando preferência clássica antiga', async () => {
  const main = await readFile(mainUrl, 'utf8');
  const dashboardEntry = main.slice(main.indexOf('async function renderDashboard(){'), main.indexOf('async function renderDashboardReact(){'));
  assert.ok(dashboardEntry.includes('return renderDashboardReact()'));
  assert.ok(!dashboardEntry.includes('localStorage'));
  assert.ok(!main.includes('cadastro-painel-cidade-mode-v1'));
  assert.ok(!main.includes('Experimentar painel moderno'));
  assert.ok(!main.includes("setCityDashboardMode('classic')"));
});
