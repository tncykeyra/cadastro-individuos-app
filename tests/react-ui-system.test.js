import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = [
  'App.jsx',
  'CityDashboard.jsx',
  'PeopleWorkspace.jsx',
  'Sidebar.jsx',
  'VehiclesWorkspace.jsx',
  'WarrantsWorkspace.jsx',
];
const modules = await Promise.all(files.map(file =>
  readFile(new URL('../src/react/' + file, import.meta.url), 'utf8')
));
const [button, styles, main, index, serviceWorker, pkg, roadmap] = await Promise.all([
  readFile(new URL('../src/react/ui/Button.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/react/ui-system.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
  readFile(new URL('../docs/REACT-MIGRATION-ROADMAP.md', import.meta.url), 'utf8'),
]);

test('componentes React de produção usam o botão compartilhado', () => {
  for (const [index, source] of modules.entries()) {
    assert.match(source, /import Button from '\.\/ui\/Button\.jsx'/, files[index] + ' deve importar Button');
    assert.doesNotMatch(source, /<button(?=[\s/>])/, files[index] + ' não deve criar botões nativos paralelos');
  }
  assert.match(button, /forwardRef/);
  assert.match(button, /dangerouslySetInnerHTML/); // props HTML continuam compatíveis com os portais existentes.
  assert.match(button, /\.filter\(Boolean\)\.join\(' '\)/);
  assert.doesNotMatch(button, /type="button"/); // não altera o comportamento submit implícito de formulários existentes.
});

test('sistema visual padroniza foco, estados, variantes e controles sem remover classes dos módulos', () => {
  for (const marker of ['.ui-button:focus-visible','button.button:focus-visible','button.button.secondary','button.button.danger','button.button.success','prefers-reduced-motion','--ui-control-height-touch']) {
    assert.ok(styles.includes(marker), 'regra visual ausente: ' + marker);
  }
  assert.match(styles, /\.ui-button\.button/);
  assert.match(styles, /:disabled/);
});

test('integração mantém ações e contratos de navegação e formulário existentes', () => {
  for (const marker of ['data-page','data-open-operator-tour','data-link-person','data-link-vehicle','data-record-pdf','data-vehicle-plate-review','data-identity-review','data-warrant-tab','data-warrant-enable-react']) {
    assert.ok(main.includes(marker), 'contrato preservado: ' + marker);
  }
  assert.match(main, /ui-system\.css/);
});

test('versão e cache foram atualizados e o plano de migração explicita as áreas restantes', () => {
  assert.equal(JSON.parse(pkg).version, '2.44.0');
  assert.match(index, /styles\.css\?v=159/);
  assert.match(serviceWorker, /cadastro-app-shell-v113/);
  for (const module of ['Autenticação','Cadastro Inteligente','Usuários','Histórico','Veículos de interesse','Fiscalização']) {
    assert.ok(roadmap.includes(module), 'área da migração documentada: ' + module);
  }
});
