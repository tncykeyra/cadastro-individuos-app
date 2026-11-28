import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('Cidades e acessos é sempre renderizada pelo workspace React', async () => {
  const main = await read('src/main.js');
  const workspace = await read('src/react/CitiesWorkspace.jsx');
  const start = main.indexOf('async function renderCities(){');
  const end = main.indexOf('async function renderCitiesClassic(){', start);
  assert.ok(start >= 0 && end > start, 'integração React de cidades deve existir');
  const integration = main.slice(start, end);
  assert.ok(integration.includes("import('./react/CitiesWorkspace.jsx')"));
  assert.ok(integration.includes('citiesReactRoot.render'));
  assert.ok(integration.includes('master_list_city_catalog'));
  assert.ok(integration.includes('master_replace_user_city_roles'));
  assert.ok(!integration.includes('getCitiesUiMode'));
  assert.ok(!integration.includes('renderCitiesClassic'));
  for (const action of ['onActivate','onCreate','onAssign','onRemove']) {
    assert.ok(workspace.includes(action), 'ação React ausente: ' + action);
  }
  assert.ok(workspace.includes('useState'));
  assert.ok(workspace.includes('onSubmit={assign}'));
  assert.ok(workspace.includes('onSubmit={create}'));
  assert.ok(workspace.includes('members.filter'));
  assert.ok(!workspace.includes('dangerouslySetInnerHTML'));
});
