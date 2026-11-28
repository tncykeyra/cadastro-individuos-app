import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/react/vehicles-workspace.css', import.meta.url), 'utf8');
const nativeDetail = readFileSync(new URL('../src/react/VehicleDetail.jsx', import.meta.url), 'utf8');
const mountedDetail = readFileSync(new URL('../src/react/VehiclesWorkspace.jsx', import.meta.url), 'utf8');

test('ficha nativa mantém compartilhar, editar e excluir no mesmo grupo de ações', () => {
  assert.match(nativeDetail, /className="vehicle-native-actions"/);
  assert.match(nativeDetail, /className="vehicle-detail-action vehicle-share-action"/);
  assert.match(nativeDetail, /className="vehicle-detail-action vehicle-edit-action"/);
  assert.match(nativeDetail, /className="vehicle-detail-action vehicle-delete-action"/);
});

test('ficha alternativa mantém as três ações no mesmo contêiner', () => {
  assert.match(mountedDetail, /<div className="vehicle-detail-actions">/);
  assert.match(mountedDetail, /vehicle-share-action/);
  assert.match(mountedDetail, /vehicle-edit-action/);
  assert.match(mountedDetail, /vehicle-delete-action/);
});

test('ações da ficha ficam alinhadas e usam três colunas iguais em telas móveis', () => {
  assert.match(css, /\.vehicle-native-actions,\s*\.vehicles-react-shell\.is-detail \.vehicle-detail-actions[\s\S]*?justify-content:\s*flex-start/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.vehicle-native-actions > \.ui-button,[\s\S]*?\.vehicle-detail-actions > \.vehicle-detail-action[\s\S]*?min-width:\s*0/);
});
