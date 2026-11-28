import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Cadastro Inteligente usa um botão flutuante React global', async () => {
  const [main, component] = await Promise.all([
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/react/SmartFab.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(main, /import SmartFab from '\.\/react\/SmartFab\.jsx'/);
  assert.match(main, /renderSmartFab\(allowed\)/);
  assert.match(main, /state\.page!=='smart'/);
  assert.doesNotMatch(main, /<button class="smart-fab"/);
  assert.match(component, /className="smart-fab"/);
  assert.match(component, /data-page="smart"/);
  assert.match(component, /data-smart-page-kind=\{kind === 'vehicle' \? 'vehicle' : 'person'\}/);
});
