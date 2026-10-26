import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecordPdf } from '../src/pdf.js';

const decode = bytes => new TextDecoder('latin1').decode(bytes);

test('gera PDF A4 de um único cadastro sem dependências externas', () => {
  const pdf = buildRecordPdf({
    title: 'Ficha do indivíduo',
    sections: [{ title: 'Identificação', rows: [{ label: 'Nome', value: 'Pessoa de teste' }, { label: 'Crimes', value: 'Informação de teste' }] }],
    generatedAt: new Date('2026-01-01T12:00:00Z')
  });
  const text = decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.includes('/MediaBox [0 0 595 842]'));
  assert.ok(text.includes('/Count 1'));
  assert.ok(text.endsWith('%%EOF'));
});

test('inclui fotografias JPEG sem alterar proporção nem usar URLs públicas no PDF', () => {
  const pdf = buildRecordPdf({
    title: 'Ficha do veículo',
    sections: [{ title: 'Dados do veículo', rows: [{ label: 'Placa', value: 'ZZZ0000' }] }],
    photos: [{ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 1200, height: 800, label: 'Foto de capa' }]
  });
  const text = decode(pdf);
  assert.ok(text.includes('/Subtype /Image'));
  assert.ok(text.includes('/Filter /DCTDecode'));
  assert.ok(text.includes('/Im1'));
  assert.ok(text.includes('/Count 2'));
  assert.ok(text.endsWith('%%EOF'));
});

test('pagina registros extensos em várias páginas', () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({ label: 'Campo ' + index, value: 'Detalhe do registro ' + index }));
  const text = decode(buildRecordPdf({ title: 'Cadastro extenso', sections: [{ title: 'Dados', rows }] }));
  assert.match(text, /\/Count [2-9]/);
});
