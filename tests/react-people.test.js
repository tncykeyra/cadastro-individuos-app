import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, component, styles] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/PeopleWorkspace.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/people-workspace.css', import.meta.url), 'utf8')
]);

test('aba Indivíduos usa workspace React sem botão de retorno à interface clássica', () => {
  assert.match(main, /PEOPLE_UI_MODE_KEY/);
  assert.match(main, /renderPeopleWorkspace\(pageContent,'list'\)/);
  assert.match(main, /renderPeopleWorkspace\([\s\S]*?'detail',id\)/);
  assert.doesNotMatch(main, /onSwitchClassic/);
  assert.doesNotMatch(component, /Voltar à interface clássica/);
  assert.match(component, /dangerouslySetInnerHTML/);
});

test('ações existentes da ficha, pesquisa e associação permanecem preservadas', () => {
  for (const marker of ['data-open-person', 'data-open-vehicle', 'data-link-person', 'data-unlink', 'data-edit-person', 'data-record-pdf', 'data-identity-review']) {
    assert.ok(main.includes(marker), 'marcador preservado: ' + marker);
  }
  assert.match(component, /new MutationObserver/);
  assert.match(component, /data-people-react-owned/);
  assert.match(component, /createPortal\(/);
});

test('a interface moderna mantém paleta do aplicativo e adaptação para celular', () => {
  assert.match(styles, /--brand/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /person-relationships \\.section-heading>\\.button\\{[\\s\\S]*?width:100%/);
  assert.match(styles, /prefers-reduced-motion/);
});

test('detalhes do indivíduo são montados no workspace React e compartilhar vira ícone verde no mobile', () => {
  const detailStart = main.indexOf("async function openPerson");
  const detailEnd = main.indexOf("function crimesDisplayText", detailStart);
  const detailSource = main.slice(detailStart, detailEnd);
  assert.match(detailSource, /renderPeopleWorkspace\([\s\S]*?'detail',id\)/);
  assert.match(detailSource, /people-share-button/);
  assert.match(detailSource, /aria-label="Compartilhar ficha do indivíduo"/);
  assert.match(component, /view === 'detail'/);
  assert.match(styles, /people-share-button\{[^}]*background:#198754!important/);
  assert.match(styles, /@media\(max-width:700px\)[\s\S]*?people-share-button-label\{display:none\}/);
  assert.match(styles, /people-share-button \.share-icon\{[^}]*stroke:#fff/);
});
