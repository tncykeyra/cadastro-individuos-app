import { normalizeWarrantName } from './warrants.js';

const MAX_CSV_CHARS = 50 * 1024 * 1024;
const clean = (value, max = 240) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const normalizeHeader = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function detectDelimiter(text) {
  const first = String(text || '').split(/\r?\n/, 1)[0] || '';
  return [';', ',', '\t', '|'].map(delimiter => {
    let quoted = false, count = 0;
    for (let i = 0; i < first.length; i++) {
      if (first[i] === '"') {
        if (quoted && first[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (!quoted && first[i] === delimiter) count++;
    }
    return { delimiter, count };
  }).sort((a, b) => b.count - a.count)[0].delimiter;
}

function parseRows(text, delimiter) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && ch === delimiter) { row.push(cell); cell = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(value => String(value).trim())) rows.push(row);
      row = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('O CSV contém aspas sem fechamento. Salve novamente e tente de novo.');
  row.push(cell);
  if (row.some(value => String(value).trim())) rows.push(row);
  return rows;
}

function findColumn(headers, aliases, predicate = () => false) {
  return headers.findIndex(header => aliases.includes(header) || predicate(header));
}

const UF_NAMES = {
  acre:'AC', alagoas:'AL', amapa:'AP', amazonas:'AM', bahia:'BA', ceara:'CE', 'distrito federal':'DF',
  'espirito santo':'ES', goias:'GO', maranhao:'MA', 'mato grosso':'MT', 'mato grosso do sul':'MS',
  'minas gerais':'MG', para:'PA', paraiba:'PB', parana:'PR', pernambuco:'PE', piaui:'PI',
  'rio de janeiro':'RJ', 'rio grande do norte':'RN', 'rio grande do sul':'RS', rondonia:'RO',
  roraima:'RR', 'santa catarina':'SC', 'sao paulo':'SP', sergipe:'SE', tocantins:'TO'
};

export function parseNationwideWarrantCsv(text, fallbackState = '') {
  if (String(text || '').length > MAX_CSV_CHARS) throw new Error('O CSV deve ter até 50 MB. Divida a planilha por estado e tente novamente.');
  const parsed = parseRows(text, detectDelimiter(text));
  if (parsed.length < 2) throw new Error('O arquivo não contém linhas de dados.');
  const headers = parsed[0].map(normalizeHeader);
  const column = {
    process: findColumn(headers, ['processo', 'numero processo', 'numero do processo', 'numero do processo judicial'], h => h.includes('processo')),
    name: findColumn(headers, ['nome', 'nome completo', 'nome do procurado', 'nome da pessoa'], h => h === 'nome do investigado'),
    alias: findColumn(headers, ['alcunha', 'vulgo', 'apelido'], h => h.includes('alcunha')),
    mother: findColumn(headers, ['mae', 'nome da mae', 'nome mae'], h => h.includes('nome da mae')),
    father: findColumn(headers, ['pai', 'nome do pai', 'nome pai'], h => h.includes('nome do pai')),
    state: findColumn(headers, ['uf', 'estado', 'unidade federativa'], h => h === 'uf expedicao' || h === 'estado expedidor'),
    status: findColumn(headers, ['situacao', 'status', 'situacao do mandado'], h => h.includes('situacao')),
    birth: findColumn(headers, ['nascimento', 'data nascimento', 'data de nascimento'], h => h.includes('nascimento')),
    warrant: findColumn(headers, ['numero', 'numero mandado', 'numero do mandado', 'peca'], h => h.includes('mandado') || h === 'peca')
  };
  if (column.name < 0) throw new Error('Não encontrei a coluna de nome. Confira o cabeçalho da planilha.');
  const value = (row, index) => index < 0 ? '' : clean(row[index]);
  const fallback = String(fallbackState || '').trim().toUpperCase();
  const records = [];
  let rowsMissingState = 0;
  for (let i = 1; i < parsed.length; i++) {
    const row = parsed[i];
    const full_name = value(row, column.name);
    if (!full_name) continue;
    const stateRaw = value(row, column.state);
    const uf = stateRaw.length === 2 ? stateRaw.toUpperCase() : UF_NAMES[normalizeHeader(stateRaw)] || fallback;
    if (!uf) rowsMissingState++;
    const sourceReference = value(row, column.process);
    const numberValue = value(row, column.warrant);
    const processNumber = sourceReference || (/^(?:\\d{7}\\s*-\\s*\\d{2}\\s*\\.\\s*\\d{4}\\s*\\.\\s*\\d\\s*\\.\\s*\\d{2}\\s*\\.\\s*\\d{4}|\\d{20})$/.test(numberValue) ? numberValue : '');
    records.push({
      full_name,
      alias: value(row, column.alias),
      mother_name: value(row, column.mother),
      father_name: value(row, column.father),
      process_number: processNumber,
      state: uf || 'UF não identificada',
      status: value(row, column.status) || 'Não informada',
      birth_date: value(row, column.birth),
      warrant_number: numberValue,
      source_row: i + 1
    });
  }
  if (!records.length) throw new Error('Não encontrei linhas com nome válido.');
  return { records, rowsMissingState, hasStateColumn: column.state >= 0, columns: column };
}

function tokens(name) {
  return normalizeWarrantName(name).split(/\s+/).filter(token => token.length > 1);
}

function nameScore(left, right) {
  const a = normalizeWarrantName(left), b = normalizeWarrantName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aTokens = tokens(a), bTokens = tokens(b);
  const setB = new Set(bTokens);
  const overlap = aTokens.filter(token => setB.has(token)).length;
  const overlapScore = overlap / Math.max(1, Math.min(aTokens.length, bTokens.length));
  const prefixBonus = aTokens[0] && bTokens[0] && (aTokens[0].startsWith(bTokens[0]) || bTokens[0].startsWith(aTokens[0])) ? 0.08 : 0;
  return Math.min(0.96, overlapScore * 0.88 + prefixBonus);
}

export function findWarrantNameCandidates(rows, people, { threshold = 0.72, maxCandidates = 3 } = {}) {
  const index = new Map();
  for (const person of people || []) {
    const name = String(person?.full_name || '').trim();
    const normalized = normalizeWarrantName(name);
    if (!person?.id || !normalized) continue;
    const entry = { id: person.id, full_name: name, birthday: person.birthday || '', city_id: person.city_id || '' };
    for (const token of new Set(tokens(name))) {
      const list = index.get(token) || [];
      list.push(entry); index.set(token, list);
    }
  }
  return (rows || []).map(row => {
    const candidatePool = new Map();
    for (const token of new Set(tokens(row.full_name))) {
      for (const person of index.get(token) || []) candidatePool.set(person.id, person);
    }
    const candidates = [...candidatePool.values()].map(person => ({
      ...person,
      confidence: nameScore(row.full_name, person.full_name),
      reason: normalizeWarrantName(row.full_name) === normalizeWarrantName(person.full_name) ? 'Nome idêntico' : 'Nome semelhante; confirme com filiação e nascimento'
    })).filter(candidate => candidate.confidence >= threshold)
      .sort((a, b) => b.confidence - a.confidence || a.full_name.localeCompare(b.full_name, 'pt-BR'))
      .slice(0, maxCandidates);
    return { ...row, candidates };
  });
}
