import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [person, vehicle, styles, main] = await Promise.all([
  readFile(new URL('../src/react/PersonDetail.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/VehicleDetail.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/detail-actions.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8')
]);

test('ficha do indivíduo possui botão compartilhar com ícone SVG acessível', () => {
  assert.match(person, /className="people-share-button"/);
  assert.match(person, /data-record-pdf=\{'people:'/);
  assert.match(person, /aria-label="Compartilhar ficha do indivíduo"/);
  assert.match(person, /className="detail-share-icon"/);
  assert.match(person, /people-share-button-label/);
});

test('ficha do veículo possui botão compartilhar com o mesmo ícone e ação', () => {
  assert.match(vehicle, /className="vehicle-detail-action vehicle-share-action"/);
  assert.match(vehicle, /data-record-pdf=\{'vehicles:'/);
  assert.match(vehicle, /aria-label="Compartilhar ficha do veículo"/);
  assert.match(vehicle, /className="detail-share-icon"/);
  assert.match(vehicle, /vehicle-action-label/);
});

test('botões de compartilhar não quebram o texto e mantêm ícone e rótulo juntos no desktop', () => {
  assert.match(styles, /flex-wrap:\s*nowrap/);
  assert.match(styles, /white-space:\s*nowrap/);
  assert.match(styles, /overflow-wrap:\s*normal/);
  assert.match(styles, /\.detail-share-icon[\s\S]*?flex:\s*0 0 18px/);
});

test('em telas móveis os dois botões exibem somente o ícone em área de toque quadrada', () => {
  assert.match(styles, /@media\s*\(max-width:\s*620px\)/);
  assert.match(styles, /\.people-share-button-label,[\s\S]*?\.vehicle-action-label\s*\{\s*display:\s*none/);
  assert.match(styles, /width:\s*42px/);
  assert.match(styles, /min-height:\s*42px/);
});
