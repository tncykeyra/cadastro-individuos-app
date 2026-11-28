import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('botão flutuante Cadastro Inteligente foi removido globalmente sem remover o acesso pelo menu', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /SmartFab|smartFabRoot|smartFabHost|renderSmartFab/);
  assert.match(main, /\['smart','Cadastro Inteligente'\]/);
  assert.doesNotMatch(main, /className="smart-fab"|class="smart-fab"/);
});
