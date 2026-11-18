import { normalizeWarrantName, normalizeWarrantProcessNumber, normalizeWarrantText } from './warrants.js';

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

function parseRowsStrict(text, delimiter) {
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
  if (quoted) throw new Error('unbalanced_quotes');
  row.push(cell);
  if (row.some(value => String(value).trim())) rows.push(row);
  return rows;
}

function recoverCsvLine(line, delimiter) {
  const row = [];
  let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; continue; }
      if (!quoted && cell.trim() === '') { quoted = true; continue; }
      if (quoted) {
        let next = i + 1;
        while (next < line.length && /\s/.test(line[next])) next++;
        if (next === line.length || line[next] === delimiter) { quoted = false; continue; }
      }
      cell += ch;
    } else if (!quoted && ch === delimiter) { row.push(cell); cell = ''; }
    else cell += ch;
  }
  if (quoted) {
    return line.split(delimiter).map(value => value.replace(/^\s*"/, '').replace(/"\s*$/, '').replace(/""/g, '"'));
  }
  row.push(cell);
  return row;
}

function parseRows(text, delimiter) {
  const input = String(text || '').replace(/^\uFEFF/, '');
  try {
    return parseRowsStrict(input, delimiter);
  } catch (error) {
    if (error?.message !== 'unbalanced_quotes') throw error;
    return input.split(/\r?\n/).filter(line => line.trim()).map(line => recoverCsvLine(line, delimiter));
  }
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
const VALID_STATE_CODES = new Set([...Object.values(UF_NAMES), 'DF']);
function resolveWarrantStateCode(value, fallback = '') {
  const normalized = normalizeHeader(value);
  if (normalized.length === 2 && VALID_STATE_CODES.has(normalized.toUpperCase())) return normalized.toUpperCase();
  if (UF_NAMES[normalized]) return UF_NAMES[normalized];
  for (const [name, code] of Object.entries(UF_NAMES).sort((a, b) => b[0].length - a[0].length)) {
    if ((' ' + normalized + ' ').includes(' ' + name + ' ')) return code;
  }
  if (fallback) {
    const fallbackValue = normalizeHeader(fallback);
    if (fallbackValue.length === 2 && VALID_STATE_CODES.has(fallbackValue.toUpperCase())) return fallbackValue.toUpperCase();
    if (UF_NAMES[fallbackValue]) return UF_NAMES[fallbackValue];
  }
  return '';
}

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
    state: findColumn(headers, ['uf', 'estado', 'unidade federativa'], h => h.includes('unidade federativa') || h.includes('estado') || h === 'uf expedicao'),
    status: findColumn(headers, ['situacao', 'status', 'situacao do mandado'], h => h.includes('situacao')),
    birth: findColumn(headers, ['nascimento', 'data nascimento', 'data de nascimento'], h => h.includes('nascimento')),
    warrant: findColumn(headers, ['numero', 'numero mandado', 'numero do mandado', 'peca'], h => h.includes('mandado') || h === 'peca')
  };
  if (column.name < 0) throw new Error('Não encontrei a coluna de nome. Confira o cabeçalho da planilha.');
  const value = (row, index) => index < 0 ? '' : clean(row[index]);
  const fallback = resolveWarrantStateCode(fallbackState);
  const records = [];
  let rowsMissingState = 0;
  for (let i = 1; i < parsed.length; i++) {
    const row = parsed[i];
    const full_name = value(row, column.name);
    if (!full_name) continue;
    const stateRaw = value(row, column.state);
    const uf = resolveWarrantStateCode(stateRaw, fallback);
    if (!uf) rowsMissingState++;
    const sourceReference = value(row, column.process);
    const numberValue = value(row, column.warrant);
    const processNumber = sourceReference || (/^(?:\d{7}\\s*-\\s*\d{2}\\s*\\.\\s*\d{4}\\s*\\.\\s*\d\\s*\\.\\s*\d{2}\\s*\\.\\s*\d{4}|\d{20})$/.test(numberValue) ? numberValue : '');
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

function normalizeCrosscheckBirthDate(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[1] + '-' + match[2] + '-' + match[3];
  match = text.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);
  return match ? match[3] + '-' + match[2] + '-' + match[1] : '';
}

function extractLabeledParentName(notes, parent) {
  const source = String(notes || '');
  const found = parent === 'mother'
    ? source.match(/(?:^|[\n;,.|:])\s*(?:nome\s+da\s+m[aã]e|m[aã]e|filia[cç][aã]o\s+materna)\s*[:=–-]\s*([^\n;,.|]+)/i)
    : source.match(/(?:^|[\n;,.|:])\s*(?:nome\s+do\s+pai|pai|filia[cç][aã]o\s+paterna)\s*[:=–-]\s*([^\n;,.|]+)/i);
  if (!found) return '';
  const otherLabels = parent === 'mother'
    ? /\b(?:nome\s+do\s+pai|pai|filia[cç][aã]o\s+paterna)\s*[:=–-].*$/i
    : /\b(?:nome\s+da\s+m[aã]e|m[aã]e|filia[cç][aã]o\s+materna)\s*[:=–-].*$/i;
  return normalizeWarrantName(found[1].replace(otherLabels, ''));
}

function compareEvidence(expected, values, normalize = normalizeWarrantName) {
  const target = normalize(expected);
  const available = [...new Set((values || []).map(value => normalize(value)).filter(Boolean))];
  if (!target || !available.length) return { status: 'unavailable' };
  return available.includes(target) ? { status: 'match' } : { status: 'conflict' };
}

export function findWarrantNameCandidates(rows, people, { threshold = 1, maxCandidates = 3, includeConflicts = false } = {}) {
  const index = new Map();
  for (const person of people || []) {
    const name = String(person?.full_name || '').trim();
    const normalized = normalizeWarrantText(name);
    if (!person?.id || !normalized) continue;
    const entry = { ...person, full_name: name, birthday: person.birthday || '', city_id: person.city_id || '' };
    const list = index.get(normalized) || [];
    list.push(entry);
    index.set(normalized, list);
  }
  return (rows || []).map(row => {
    const normalized = normalizeWarrantText(row?.full_name);
    const candidates = [], excludedCandidates = [];
    for (const person of index.get(normalized) || []) {
      const notes = [person.notes, person.occurrence_notes].filter(Boolean).join('\\n');
      const linkedWarrants = person.linked_warrants || [];
      const birthValues = [person.birthday, ...linkedWarrants.map(warrant => warrant.birth_date)];
      const motherValues = [extractLabeledParentName(notes, 'mother'), ...linkedWarrants.map(warrant => warrant.mother_name)];
      const fatherValues = [extractLabeledParentName(notes, 'father'), ...linkedWarrants.map(warrant => warrant.father_name)];
      const evidence = {
        'nascimento': compareEvidence(row.birth_date, birthValues, normalizeCrosscheckBirthDate),
        'nome da mãe': compareEvidence(row.mother_name, motherValues),
        'nome do pai': compareEvidence(row.father_name, fatherValues)
      };
      const confirmed = Object.entries(evidence).filter(([, result]) => result.status === 'match').map(([label]) => label);
      const conflicts = Object.entries(evidence).filter(([, result]) => result.status === 'conflict').map(([label]) => label);
      const confidence = 1;
      const result = {
        ...person,
        confidence,
        evidence_matches: confirmed,
        evidence_conflicts: conflicts,
        reason: confirmed.length
          ? 'Nome completo igual; também confere: ' + confirmed.join(', ') + (conflicts.length ? '. Divergência em: ' + conflicts.join(', ') : '')
          : conflicts.length
            ? 'Nome completo igual; divergência em: ' + conflicts.join(', ')
            : 'Nome completo igual; nascimento e filiação sem dados para comparar',
        evidence_score: confirmed.length * 2 - conflicts.length
      };
      // Do not suggest a homonym when two or more independent known fields conflict
      // and none of the available identity fields corroborates it.
      const parentMatch = evidence['nome da mãe'].status === 'match' || evidence['nome do pai'].status === 'match';
      const bothParentsConflict = evidence['nome da mãe'].status === 'conflict' && evidence['nome do pai'].status === 'conflict';
      const strongIdentityConflict = (evidence.nascimento.status === 'conflict' && !parentMatch) ||
        (bothParentsConflict && evidence.nascimento.status !== 'match');
      if (strongIdentityConflict && !includeConflicts) {
        excludedCandidates.push({ ...result, exclusion_reason: 'Divergência em ' + conflicts.join(' e ') });
      } else if (confidence >= threshold) candidates.push(result);
    }
    const sort = (a, b) => b.evidence_score - a.evidence_score || a.full_name.localeCompare(b.full_name, 'pt-BR');
    candidates.sort(sort);
    excludedCandidates.sort(sort);
    return { ...row, candidates: candidates.slice(0, maxCandidates), excluded_candidates: excludedCandidates };
  });
}

export function inferWarrantStateFromFilename(filename) {
  const base = String(filename || '').split(/[\\/]/).pop().replace(/\.[^.]*$/, '');
  const normalized = normalizeHeader(base);
  const tokens = new Set(normalized.split(' '));
  for (const token of tokens) {
    const code = resolveWarrantStateCode(token);
    if (code) return code;
  }
  return resolveWarrantStateCode(normalized);
}


export function findExistingWarrantRows(rows, warrants) {
  const processIndex = new Map();
  const identityIndex = new Map();
  const normalizeBirthDate = value => {
    const text = String(value || '').trim();
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return match[1] + '-' + match[2] + '-' + match[3];
    match = text.match(/^(\d{2})[\\/.-](\d{2})[\\/.-](\d{4})$/);
    return match ? match[3] + '-' + match[2] + '-' + match[1] : '';
  };
  const identityKey = row => {
    const name = normalizeWarrantName(row?.full_name);
    const birth = normalizeBirthDate(row?.birth_date || row?.birthDate);
    const mother = normalizeWarrantName(row?.mother_name);
    const father = normalizeWarrantName(row?.father_name);
    // Without a process number, only surface a cautious identity match when
    // birth date and at least one parent are also available on both records.
    if (!name || !birth || (!mother && !father)) return '';
    return [name, birth, mother, father].join('|');
  };
  for (const warrant of warrants || []) {
    const process = normalizeWarrantProcessNumber(warrant?.process_number_digits || warrant?.process_number || '');
    if (process) {
      const list = processIndex.get(process) || [];
      list.push(warrant);
      processIndex.set(process, list);
    }
    const identity = identityKey({
      full_name: warrant?.full_name,
      birth_date: warrant?.birth_date,
      mother_name: warrant?.mother_name,
      father_name: warrant?.father_name
    });
    if (identity) {
      const list = identityIndex.get(identity) || [];
      list.push(warrant);
      identityIndex.set(identity, list);
    }
  }
  return (rows || []).map(row => {
    const process = normalizeWarrantProcessNumber(row?.process_number || '');
    const exact = process ? processIndex.get(process) || [] : [];
    const identity = identityKey(row);
    const identityMatches = !process && identity ? identityIndex.get(identity) || [] : [];
    const matches = exact.length ? exact : identityMatches;
    const matchType = exact.length ? 'process' : identityMatches.length ? 'identity' : '';
    return {
      ...row,
      existing_warrant_match_type: matchType,
      existing_warrant_count: matches.length,
      existing_warrants: matches.slice(0, 5).map(warrant => ({
        id: warrant.id,
        full_name: warrant.full_name,
        city_id: warrant.city_id || '',
        status: warrant.status || '',
        process_number_digits: warrant.process_number_digits || '',
        warrant_number: warrant.warrant_number || ''
      }))
    };
  });
}
