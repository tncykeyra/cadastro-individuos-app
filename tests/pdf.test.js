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
  assert.equal(pdf.previewPages.length, 1);
  assert.ok(pdf.previewPages[0].texts.some(item => item.text === 'Ficha do indivíduo'));
  assert.ok(pdf.previewPages[0].texts.some(item => item.text === 'Pessoa de teste' && item.size === 13 && item.x === 34));
});

test('organiza o cabeçalho e coloca a capa antes do campo nome completo', () => {
  const pdf = buildRecordPdf({
    title: 'Ficha do indivíduo',
    recordName: 'Pessoa de teste',
    sections: [{ title: 'Identificação e informações do indivíduo', rows: [{ label: 'Nome completo', value: 'Pessoa de teste' }, { label: 'Crimes', value: 'Informação de teste' }] }],
    generatedAt: new Date('2026-01-01T12:00:00Z'),
    photos: [{ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 1200, height: 800, is_cover: true, label: 'Foto de capa' }, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 1200, height: 800, label: 'Fotografia duplicada' }]
  });
  const text = decode(pdf), preview = pdf.previewPages[0];
  assert.ok(text.includes('/Subtype /Image'));
  assert.ok(text.includes('/Filter /DCTDecode'));
  assert.ok(text.includes('/Im1'));
  assert.ok(text.includes('/Count 1'));
  assert.equal(preview.images.length, 1);
  assert.equal(preview.images[0].height, 220);
  const title = preview.texts.find(item => item.text === 'Ficha do indivíduo');
  const name = preview.texts.find(item => item.text === 'Pessoa de teste');
  const generated = preview.texts.find(item => item.text.startsWith('Gerado em'));
  const section = preview.texts.find(item => item.text === 'Identificação e informações do indivíduo');
  const fullNameField = preview.texts.find(item => item.text === 'Nome completo');
  assert.ok(title && name && generated && section && fullNameField);
  assert.ok(title.y > name.y && name.y > generated.y && generated.y > section.y);
  assert.ok(section.y > preview.images[0].y && preview.images[0].y > fullNameField.y);
  assert.ok(text.endsWith('%%EOF'));
});

test('mantém as fotos adicionais em páginas depois da capa', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildRecordPdf({
    title: 'Ficha do indivíduo',
    sections: [{ title: 'Identificação', rows: [{ label: 'Nome', value: 'Pessoa de teste' }] }],
    photos: [
      { bytes: jpeg, width: 600, height: 800, is_cover: true, label: 'Foto de capa' },
      { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x01]), width: 800, height: 600, label: 'Fotografia 2' },
      { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x02]), width: 800, height: 600, label: 'Fotografia 3' }
    ]
  });
  const text = decode(pdf);
  assert.ok(text.includes('/Count 2'));
  assert.equal(pdf.previewPages[0].images.length, 1);
  assert.equal(pdf.previewPages[1].images.length, 2);
});

test('pagina registros extensos em várias páginas', () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({ label: 'Campo ' + index, value: 'Detalhe do registro ' + index }));
  const text = decode(buildRecordPdf({ title: 'Cadastro extenso', sections: [{ title: 'Dados', rows }] }));
  assert.match(text, /\/Count [2-9]/);
});

test('preserva uma foto por pessoa associada mesmo quando os bytes são iguais', () => { const jpeg = new Uint8Array([0xff,0xd8,0xff,0xd9]); const pdf=buildRecordPdf({title:'Ficha do veículo',photos:[{bytes:jpeg,width:32,height:32,association_photo:true,dedupe_group:'person:1',label:'Foto de Ana'},{bytes:jpeg,width:32,height:32,association_photo:true,dedupe_group:'person:2',label:'Foto de Bia'}]}); assert.equal(decode(pdf).match(/\/Subtype \/Image/g)?.length,2); assert.equal(pdf.previewPages[0].images.length,0); assert.equal(pdf.previewPages[1].images.length,2); assert.ok(pdf.previewPages[1].texts.some(item=>item.text==='Foto de Ana')); assert.ok(pdf.previewPages[1].texts.some(item=>item.text==='Foto de Bia')); });
