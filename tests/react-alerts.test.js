import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, alert, sidebar, toast] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/IdentitySuggestionAlert.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/Sidebar.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/ui/ToastViewport.jsx', import.meta.url), 'utf8'),
]);

test('alerta de sugestões de edição é renderizado por React e preserva o fluxo de revisão', () => {
  assert.match(main, /IdentitySuggestionAlert/);
  assert.match(main, /renderIdentitySuggestionAlert\(userId,freshIds\)/);
  assert.doesNotMatch(main, /identitySuggestionAlertDialog/);
  assert.match(alert, /showModal\(\)/);
  assert.match(alert, /Nenhuma informação será modificada antes da sua decisão/);
  assert.match(alert, /onNavigate\?\.\(\)/);
});

test('balões de pendências apresentam quantidade real e texto acessível no menu React', () => {
  assert.match(main, /alertCount/);
  assert.match(sidebar, /item\.alertCount > 99 \? '99\+'/);
  assert.match(sidebar, /aria-label=\{item\.alertLabel \+ ': ' \+ item\.alertCount\}/);
  assert.match(toast, /react-toast-dismiss/);
  assert.doesNotMatch(toast, /toastModeKey|setToastMode/);
});

test('alertas do menu são separados: alterações de indivíduos em Indivíduos e placas em Veículos', () => {
  assert.match(main, /id==='people'&&admin\?Number\(state\.pendingIdentityCount\)\|\|0/);
  assert.match(main, /id==='vehicles'&&admin\?Number\(state\.pendingVehiclePlateCount\)\|\|0/);
  assert.match(main, /Sugestões de nome ou CPF pendentes/);
  assert.match(main, /Sugestões de placa pendentes/);
  assert.match(main, /refreshEntitySuggestionBadges\(\)/);
  assert.match(main, /if\(isAdmin\(\)\)\{void refreshEntitySuggestionBadges\(\);void refreshPendingIdentitySuggestionPopup\(\);\}/);
});

test('todos os usuários recebem workspaces React sem preferência local para interface clássica', () => {
  assert.doesNotMatch(main, /getPeopleUiMode|getVehiclesUiMode|getWarrantsUiMode/);
  assert.doesNotMatch(main, /Interface clássica|warrant-enable-react/);
  assert.match(main, /legacyPageRoot=createRoot\(root\)/);
});
