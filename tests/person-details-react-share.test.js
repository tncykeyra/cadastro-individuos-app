import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const detail = await readFile(new URL('../src/react/PersonDetail.jsx', import.meta.url), 'utf8');

test('ficha React do indivíduo recebe ação direta para gerar o PDF', () => {
  assert.match(main, /React\.createElement\(PersonDetail,\{\.\.\.detailData,onShare:id=>generateRecordPdf\('people',id\)\}\)/);
});

test('botão compartilhar da ficha executa callback React, sem depender de delegação global', () => {
  assert.match(detail, /const sharePerson = async \(\) =>/);
  assert.match(detail, /await onShare\(person\.id\)/);
  assert.match(detail, /onClick=\{sharePerson\} disabled=\{sharing\}/);
  assert.doesNotMatch(detail, /data-record-pdf=/);
});

test('botão impede acionamento repetido durante a geração do documento', () => {
  assert.match(detail, /if \(sharing \|\| typeof onShare !== 'function'\) return/);
  assert.match(detail, /setSharing\(true\)/);
  assert.match(detail, /finally \{ setSharing\(false\); \}/);
});
