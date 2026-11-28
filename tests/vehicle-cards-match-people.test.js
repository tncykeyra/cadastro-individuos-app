import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../src/react/vehicles-workspace.css', import.meta.url), 'utf8');

test('cards de veículos usam a mesma composição vertical e responsiva dos cards de indivíduos', () => {
  assert.match(css, /\.vehicles-react-content \.vehicle-cards\{grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,230px\),1fr\)\)/);
  assert.match(css, /\.vehicle-card \.card-photo-gallery,[\s\S]*?aspect-ratio:3\/4/);
  assert.match(css, /\.vehicle-card-copy h3\{font-size:1\.05rem;font-weight:820/);
  assert.match(css, /@media\(max-width:520px\)[\s\S]*?\.vehicle-cards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.vehicle-card-copy\{padding:9px 10px 11px/);
});
