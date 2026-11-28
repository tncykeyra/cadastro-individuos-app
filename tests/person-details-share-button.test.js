import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('botão compartilhar da ficha intercepta o clique antes de handlers conflitantes', () => {
  assert.match(main, /document\.addEventListener\('click',async event=>\{const target=event\.target instanceof Element\?event\.target:null;const button=target\?\.closest\('\[data-record-pdf\]'\)/);
  assert.match(main, /event\.preventDefault\(\);event\.stopPropagation\(\)/);
  assert.match(main, /\},true\);/);
});

test('compartilhamento impede acionamentos duplicados e aguarda a geração do PDF', () => {
  assert.match(main, /button\.dataset\.shareBusy==='true'/);
  assert.match(main, /button\.disabled=true;button\.setAttribute\('aria-busy','true'\)/);
  assert.match(main, /await generateRecordPdf\(entity,id\)/);
  assert.match(main, /button\.removeAttribute\('aria-busy'\)/);
});

test('compartilhamento valida o tipo e o identificador do cadastro', () => {
  assert.match(main, /!\['people','vehicles'\]\.includes\(entity\)\|\|!id/);
  assert.match(main, /data-record-pdf="people:/);
});
