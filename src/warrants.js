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
    cpf: firstHeader(headers, key => key === 'cpf' || key.includes('cpf')),
    reference: firstHeader(headers, key => key.includes('peca') || key.includes('processo') || key.includes('referencia'))
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
      source_reference: cleanField(value(col.reference), 200),
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


function warrantOcrLines(text) {
  return String(text || '')
    .replace(/\f/g, '\n')
    .split(/\r?\n/)
    .map(line => String(line || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function warrantOcrHeader(line) {
  const value = normalizeWarrantText(line);
  return /^(?:cpf|rg|registro geral|documento de identidade|identidade|data de nascimento|nascimento|endereco|residencia|logradouro|filiacao|informacoes processuais|dados processuais|numero do processo|processo|numero do mandado|mandado|orgao expedidor|situacao|observacoes|nome da mae|nome do pai|nome completo|nome do requerido|nome do procurado|requerido|procurado|indiciado|acusado)\b/.test(value);
}

function warrantOcrValueAfter(line, labelPattern) {
  const match = String(line || '').match(labelPattern);
  if (!match) return '';
  return cleanField(line.slice(match.index + match[0].length).replace(/^\s*[:\-–—|]+\s*/, ''), 400);
}

function warrantOcrField(lines, labelPattern, { maxLines = 1, maxLength = 400 } = {}) {
  for (let index = 0; index < lines.length; index++) {
    if (!labelPattern.test(lines[index])) continue;
    const collected = [];
    const inline = warrantOcrValueAfter(lines[index], labelPattern);
    if (inline) collected.push(inline);
    for (let offset = 1; offset <= maxLines && index + offset < lines.length; offset++) {
      const line = lines[index + offset];
      if (warrantOcrHeader(line)) break;
      if (collected.length && !line) break;
      collected.push(line);
    }
    const value = cleanField(collected.join(' '), maxLength);
    if (value) return value;
  }
  return '';
}

function warrantOcrBlock(lines, labelPattern, { maxLines = 16, maxLength = 4000 } = {}) {
  for (let index = 0; index < lines.length; index++) {
    if (!labelPattern.test(lines[index])) continue;
    const collected = [];
    const inline = warrantOcrValueAfter(lines[index], labelPattern);
    if (inline) collected.push(inline);
    let blankCount = 0;
    for (let offset = 1; offset <= maxLines && index + offset < lines.length; offset++) {
      const line = lines[index + offset];
      if (!line) {
        if (collected.length && ++blankCount > 1) break;
        continue;
      }
      blankCount = 0;
      const normalized = normalizeWarrantText(line);
      if (/^(?:cpf|rg|registro geral|data de nascimento|endereco|residencia|logradouro|informacoes pessoais|dados pessoais|dados do mandado|filiacao|numero do mandado|mandado|observacoes|situacao|orgao expedidor)\b/.test(normalized)) break;
      collected.push(line);
    }
    const value = collected.map(line => line.replace(/^\s*(?:nome da m[aã]e|nome do pai)\s*[:\-]?\s*/i, '').trim()).filter(Boolean).join('\n').slice(0, maxLength).trim();
    if (value) return value;
  }
  return '';
}

function warrantOcrName(lines, fallback) {
  const labelPattern = /(?:em desfavor de|em face de|nome completo|nome do requerido|nome do procurado|nome do acusado|requerido(?:\(a\))?|procurado(?:\(a\))?|indiciado(?:\(a\))?|acusado(?:\(a\))?)\s*[:\-]?\s*/i;
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(labelPattern);
    if (!match) continue;
    const first = cleanField(lines[index].slice(match.index + match[0].length).replace(/\s+(?:CPF|RG|MANDADO|PROCESSO|DATA DE NASCIMENTO)\b.*$/i, ''), 180);
    const parts = first ? [first] : [];
    for (let offset = 1; offset <= 3 && index + offset < lines.length; offset++) {
      const line = lines[index + offset];
      const normalized = normalizeWarrantText(line);
      if (warrantOcrHeader(line) || /\d{2,}/.test(line) || /^(?:informacoes|dados|mandado|processo|cpf|rg)\b/.test(normalized)) break;
      if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’ .-]{0,79}$/.test(line)) break;
      parts.push(line);
    }
    const value = cleanField(parts.join(' ').replace(/\s+/g, ' '), 180);
    if (value.length >= 3) return value;
  }
  return fallback || '';
}

/** Extrai campos para conferência local do PDF; nada é salvo pelo parser. */
export function extractWarrantPersonSuggestions(text) {
  const source = String(text || '');
  const lines = warrantOcrLines(source);
  const base = extractWarrantSuggestions(source);
  const rg = warrantOcrField(lines, /(?:\bRG\b|registro geral|documento de identidade|identidade)\s*/i, { maxLines: 1, maxLength: 100 });
  const address_primary = warrantOcrField(lines, /(?:endere[cç]o(?:\s+residencial)?|resid[eê]ncia|logradouro)\s*/i, { maxLines: 3, maxLength: 1000 });
  const filiation = warrantOcrBlock(lines, /filia[cç][aã]o\s*[:\-]?\s*/i, { maxLines: 8, maxLength: 2000 });
  const process_information = warrantOcrBlock(lines, /(?:informa[cç][oõ]es|dados)\s+processuais\s*[:\-]?\s*/i, { maxLines: 20, maxLength: 12000 });
  const processMatch = source.match(/(?:n[uú]mero\s+do\s+processo|processo\s*(?:n[º°.]|n[uú]mero|#))\s*[:#\-]?\s*([0-9][0-9./-]{5,50})/i)
    || source.match(/\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b/);
  return {
    ...base,
    full_name: warrantOcrName(lines, base.full_name),
    rg,
    address_primary,
    filiation,
    process_information,
    process_reference: cleanField(processMatch?.[1] || '', 200)
  };
}
