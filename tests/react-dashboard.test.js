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


test('Carregamento do painel é exibido por componente React com animação acessível', async () => {
  const dashboard = await readFile(dashboardUrl, 'utf8');
  const dashboardCss = await readFile(dashboardCssUrl, 'utf8');
  const main = await readFile(mainUrl, 'utf8');
  assert.ok(dashboard.includes('export function CityDashboardLoading'));
  assert.ok(dashboard.includes('aria-live="polite"'));
  assert.ok(dashboard.includes('Preparando seu painel'));
  assert.ok(main.includes('CityDashboardLoading'));
  assert.ok(main.includes('cityDashboardRoot.render(React.createElement(CityDashboardLoading'));
  for (const animation of ['city-loader-spin','city-loader-pulse','city-loader-progress','city-loader-shimmer','prefers-reduced-motion']) {
    assert.ok(dashboardCss.includes(animation), 'Animação ou acessibilidade ausente: ' + animation);
  }
});


test('Tela animada padronizada é usada nas seções e nas fichas de veículos', async () => {
  const main = await readFile(mainUrl, 'utf8');
  assert.ok(main.includes("import './react/city-dashboard.css';"));
  const loadingStart = main.indexOf('function loadingPage(');
  const loadingEnd = main.indexOf('async function loadUser(', loadingStart);
  const loading = main.slice(loadingStart, loadingEnd);
  for (const className of ['city-react-loading-screen','city-react-loading-card','city-react-loader-orbit','city-react-loader-core','city-react-loading-track','city-react-loading-skeletons']) {
    assert.ok(loading.includes(className), 'Elemento visual de carregamento ausente: ' + className);
  }
  assert.ok(loading.includes('aria-live="polite"'));
  assert.ok(main.includes('saveLastView();loadingPage(\'Abrindo cadastro do veículo…\')'));
  const pageLoader = main.slice(main.indexOf('async function loadPage(){'), main.indexOf('async function galleryPhotos(', main.indexOf('async function loadPage(){')));
  assert.ok(pageLoader.includes('nav();loadingPage();try{'));
});
