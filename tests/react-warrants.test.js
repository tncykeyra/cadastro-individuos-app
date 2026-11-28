import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, component, styles] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/WarrantsWorkspace.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

test('aba Mandados usa workspace React sem botão de retorno à interface clássica', () => {
  assert.doesNotMatch(main, /WARRANTS_UI_MODE_KEY|getWarrantsUiMode|setWarrantsUiMode/);
  assert.match(main, /async function renderWarrantWorkspace/);
  assert.match(main, /renderWarrantWorkspace\(pageHtml,warrantStats,admin\)/);
  assert.doesNotMatch(main, /onSwitchClassic/);
  assert.doesNotMatch(component, /Voltar à interface clássica/);
  assert.match(component, /dangerouslySetInnerHTML/);
});

test('workspace apresenta indicadores e preserva o aviso de conferência oficial', () => {
  assert.match(component, /Registros exibidos/);
  assert.match(component, /Pendentes/);
  assert.match(component, /Baixa informada/);
  assert.match(component, /Baixados ou encerrados/);
  assert.match(component, /fonte oficial/);
});

test('estilos usam a paleta do aplicativo e têm adaptação mobile', () => {
  assert.match(styles, /--brand/);
  assert.match(styles, /prefers-reduced-motion/);
});

test('todos os botões da área Mandados são montados pelo React, inclusive ações dinâmicas dos diálogos', () => {
  assert.match(component, /function collectWarrantButtons/);
  assert.match(component, /createPortal\(/);
  assert.match(component, /useLayoutEffect\(/);
  assert.match(component, /new MutationObserver/);
  assert.match(component, /closest\('\.warrants-react-shell'\)/);
  assert.match(component, /closest\('#recordDialog'\)/);
  assert.match(component, /form\[id\^="warrant"\]/);
  assert.match(component, /data-warrants-react-owned/);
  assert.match(component, /WarrantsReactContent key=\{contentHtml\} contentHtml=\{contentHtml\}/);
});

test('ações, abas e formulários de mandados continuam conectados aos fluxos existentes', () => {
  assert.match(main, /document\.querySelectorAll\('\[data-warrant-tab\]'\)/);
  assert.match(main, /data-warrant-search-focus/);
  assert.match(main, /data-warrant-proposal-approve/);
  assert.match(main, /warrantManualForm:saveWarrantManual/);
  assert.match(main, /warrantConfirmForm:submitWarrantConfirmation/);
  assert.match(component, /buttonPropsFromMarkup/);
  assert.match(component, /dangerouslySetInnerHTML/);
});
