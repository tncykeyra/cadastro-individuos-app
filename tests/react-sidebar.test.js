import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, component, styles, index, serviceWorker, pkg] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/Sidebar.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/sidebar.css', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8')
]);

test('menu lateral é renderizado em React e preserva os identificadores de navegação', () => {
  assert.match(main, /renderSidebar\(\$\('#sideNav'\)/);
  assert.match(main, /page:state\.page/);
  assert.match(component, /createRoot\(element\)/);
  assert.match(component, /data-page=\{item\.id\}/);
  assert.match(component, /data-open-operator-tour/);
  for (const item of ['dashboard','people','vehicles','warrants','vehicleInterest','fiscalization','smart','review','maintenance','history','team','cities']) {
    assert.ok(main.includes("['" + item + "'"), 'item preservado: ' + item);
  }
});

test('menu React mantém seletor de cidade, alertas e ação de ajuda', () => {
  assert.match(component, /reactCitySwitcher/);
  assert.match(component, /onCityChange/);
  assert.match(component, /nav-alert-badge/);
  assert.match(component, /Como usar/);
});

test('menu lateral possui animações, responsividade e respeito à preferência de movimento reduzido', () => {
  assert.match(styles, /@keyframes sidebar-item-in/);
  assert.match(styles, /@keyframes sidebar-backdrop-in/);
  assert.match(styles, /@media\(max-width:899px\)/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
  assert.match(styles, /\.react-sidebar-item\.active/);
});

test('menu lateral abre com gesto horizontal da borda esquerda no mobile', () => {
  assert.match(main, /supportsMobileDrawerSwipe/);
  assert.match(main, /touchstart/);
  assert.match(main, /touchmove/);
  assert.match(main, /touchend/);
  assert.match(main, /touch\.clientX>32/);
  assert.match(main, /dx>=72/);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /input,textarea,select,\[contenteditable="true"\],\[data-no-drawer-swipe\]/);
  assert.match(main, /openDrawer\(\)/);
});

test('cache e versão do app são atualizados para a nova interface', () => {
  assert.match(index, /styles\.css\?v=167/);
  assert.match(serviceWorker, /cadastro-app-shell-v130/);
  assert.equal(JSON.parse(pkg).version, '2.51.0');
});
