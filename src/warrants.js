import { isValidCpf } from './ocr-domain.js';

export function normalizeWarrantText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\uFFFD/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normalizeWarrantName(value) {
  return normalizeWarrantText(value).replace(/\b(de|da|do|das|dos|e)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function csvRows(text, delimiter) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && ch === delimiter) {
      row.push(cell); cell = '';
    } else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(value => String(value).trim())) rows.push(row);
      row = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('O CSV contém aspas sem fechamento. Salve novamente como CSV e tente de novo.');
  row.push(cell);
  if (row.some(value => String(value).trim())) rows.push(row);
  return rows;
}

function detectDelimiter(text) {
  const head = String(text || '').split(/\r?\n/, 1)[0] || '';
  const candidates = [';', ',', '\t', '|'];
  const counts = candidates.map(delimiter => {
    let quoted = false, count = 0;
    for (let i = 0; i < head.length; i++) {
      if (head[i] === '"') {
        if (quoted && head[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (!quoted && head[i] === delimiter) count++;
    }
    return { delimiter, count };
  });
  return counts.sort((a, b) => b.count - a.count)[0]?.count ? counts.sort((a, b) => b.count - a.count)[0].delimiter : ';';
}

function parseIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  let year, month, day;
  if (match) [, day, month, year] = match;
  else {
    match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return null;
    [, year, month, day] = match;
  }
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function firstHeader(headers, predicate) {
  return headers.findIndex(header => predicate(normalizeWarrantText(header)));
}

function cleanField(value, maxLength = 180) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function parseWarrantCsv(text) {
  if (String(text || '').length > 10 * 1024 * 1024) throw new Error('O arquivo CSV deve ter até 10 MB.');
  const delimiter = detectDelimiter(text);
  const parsed = csvRows(text, delimiter);
  if (parsed.length < 2) throw new Error('O arquivo não contém linhas de dados.');
  const headers = parsed[0].map(cleanField);
  const col = {
    number: firstHeader(headers, key => key === 'numero' || key.includes('mero') || key.includes('mandado')),
    name: firstHeader(headers, key => key === 'nome' || key === 'nome completo' || key === 'nome do procurado'),
    alias: firstHeader(headers, key => key.includes('alcunha') || key.includes('vulgo')),
    mother: firstHeader(headers, key => key.includes('nome da mae') || key.includes('nome da m') || key === 'mae' || key.includes('nome mae')),
    father: firstHeader(headers, key => key.includes('nome do pai') || key === 'pai'),
    birthday: firstHeader(headers, key => key.includes('nascimento')),
    status: firstHeader(headers, key => key.includes('situ') || key === 'status'),
    agency: firstHeader(headers, key => key.includes('expedidor') || key.includes('orgao') || key.includes('tribunal')),
    cpf: firstHeader(headers, key => key === 'cpf' || key.includes('cpf'))
  };
  if (col.number < 0 || col.name < 0) throw new Error('Não encontrei as colunas de número do mandado e nome. Confira o cabeçalho do CSV.');
  const records = [], errors = [], seen = new Set();
  let skippedNotPending = 0, duplicateRows = 0, invalidCpfRows = 0;
  for (let index = 1; index < parsed.length; index++) {
    const raw = parsed[index];
    const value = i => i >= 0 ? raw[i] : '';
    const full_name = cleanField(value(col.name));
    const warrant_number = cleanField(value(col.number), 120).toLocaleUpperCase('pt-BR');
    if (!full_name || !warrant_number) {
      errors.push(index + 1);
      continue;
    }
    const statusText = normalizeWarrantText(value(col.status));
    if (col.status >= 0 && statusText && !statusText.includes('pendente')) {
      skippedNotPending++;
      continue;
    }
    let cpf_digits = null;
    if (col.cpf >= 0) {
      const digits = String(value(col.cpf) || '').replace(/\D/g, '');
      if (digits.length) {
        if (isValidCpf(digits)) cpf_digits = digits;
        else invalidCpfRows++;
      }
    }
    const source_agency = cleanField(value(col.agency), 140).toLocaleUpperCase('pt-BR') || 'BNMP';
    const uniqueKey = source_agency + '|' + warrant_number;
    if (seen.has(uniqueKey)) {
      duplicateRows++;
      continue;
    }
    seen.add(uniqueKey);
    const birthValue = value(col.birthday);
    const birthday = parseIsoDate(birthValue);
    if (birthValue && !birthday) errors.push(index + 1);
    records.push({
      warrant_number,
      full_name,
      cpf_digits,
      alias: cleanField(value(col.alias)),
      mother_name: cleanField(value(col.mother)),
      father_name: cleanField(value(col.father)),
      birth_date: birthday,
      source_agency,
      source_kind: 'csv',
      status: 'pending'
    });
  }
  return {
    records,
    delimiter,
    headerCount: headers.length,
    hasCpfColumn: col.cpf >= 0,
    skippedNotPending,
    duplicateRows,
    invalidCpfRows,
    invalidRows: [...new Set(errors)],
    statusColumnPresent: col.status >= 0
  };
}

function lineAfterLabel(text, pattern) {
  const match = String(text || '').match(pattern);
  if (!match) return '';
  return cleanField(match[1], 180).replace(/\s+(?:CPF|RG|MANDADO|PROCESSO|DATA DE NASCIMENTO)\b.*$/i, '').trim();
}

export function extractWarrantSuggestions(text) {
  const source = String(text || '');
  const cpfLabel = source.match(/\bCPF\b[^\d]{0,28}(\d{3}\.?\d{3}\.?\d{3}[- ]?\d{2})/i);
  const cpfDigits = cpfLabel?.[1]?.replace(/\D/g, '') || '';
  const cpf_digits = cpfDigits.length === 11 && isValidCpf(cpfDigits) ? cpfDigits : '';
  const full_name = lineAfterLabel(source,
    /(?:em desfavor de|em face de|requerido(?:\(a\))?|indiciado(?:\(a\))?|procurado(?:\(a\))?|nome completo)\s*[:\-]?\s*([^\r\n]{3,180})/i
  );
  const numberMatch = source.match(/(?:n[º°.]?\s*(?:do\s*)?mandado|n[uú]mero\s+(?:do\s+)?mandado|mandado\s*(?:n[º°.]|n[uú]mero|#)|\bBNMP\b)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9./\-]{3,55})/i);
  const dateMatch = source.match(/(?:data de nascimento|nascimento)\s*[:\-]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i);
  const birth_date = parseIsoDate(dateMatch?.[1] || '') || '';
  return {
    full_name,
    cpf_digits,
    warrant_number: cleanField(numberMatch?.[1] || '', 120),
    birth_date,
    hasValidCpf: Boolean(cpf_digits)
  };
}
