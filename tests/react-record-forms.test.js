import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [main, renderer] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/markup-to-react.jsx', import.meta.url), 'utf8')
]);

test('formulários de indivíduos e veículos são montados por uma raiz React', () => {
  const start = main.indexOf('async function showForm(kind,item=null,options={})');
  const end = main.indexOf('async function uploadInitialPhotos', start);
  const source = main.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(source, /renderRecordDialog\(dialogMarkup\)/);
  assert.doesNotMatch(source, /dialog\.innerHTML\s*=/);
  assert.match(main, /createRoot\(dialog\)/);
  assert.match(main, /flushSync\(\(\)=>recordDialogReactRoot\.render/);
  assert.match(main, /recordDialogReactRoot\.unmount\(\)/);
});

test('adaptador cria elementos React nativos e preserva atributos dos controles', () => {
  assert.match(renderer, /React\.createElement\(tag, props/);
  assert.match(renderer, /props\.defaultValue = attribute\.value/);
  assert.match(renderer, /props\.defaultChecked = true/);
  assert.match(renderer, /ATTRIBUTE_NAMES/);
  assert.match(renderer, /data-/);
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML/);
});

test('formulários mantêm os identificadores usados pela validação e gravação existentes', () => {
  const start = main.indexOf('async function showForm(kind,item=null,options={})');
  const end = main.indexOf('async function uploadInitialPhotos', start);
  const source = main.slice(start, end);
  for (const marker of ['recordForm','full_name','cpf_digits','addressEntry','photos','cameraPhotos','plate','initialPersonId','data-edit-delete-photo','data-photo-pick','data-photo-camera']) {
    assert.ok(source.includes(marker), 'controle preservado: ' + marker);
  }
  assert.match(source, /new FormData\(form\)/);
  assert.match(source, /find_similar_people|lookupSimilarPeople/);
  assert.match(source, /submit_person_identity_change_proposal/);
  assert.match(source, /submit_vehicle_plate_change_proposal/);
});
