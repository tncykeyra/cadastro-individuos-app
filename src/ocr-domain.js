const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const cleanValue = value => String(value || '').replace(/^[\s:;=|–—-]+/, '').replace(/\s+/g, ' ').trim().slice(0, 240);
const LABELS = {
  full_name: ['1 E 2 NOME E SOBRENOME', 'NOME E SOBRENOME', 'NOME COMPLETO', 'NOME DO CONDUTOR', 'NOME DO PROPRIETARIO', 'NOME'],
  cpf_digits: ['4D CPF', '4D-CPF', 'CPF DO PROPRIETARIO', 'CPF/CNPJ', 'CPF'],
  rg: ['4C DOCUMENTO DE IDENTIDADE / ORG. EMISSOR / UF', '4C DOC. IDENTIDADE / ORG. EMISSOR / UF', '4C DOC. IDENTIDADE/ORG. EMISSOR/UF', 'DOC. IDENTIDADE/ORG. EMISSOR/UF', 'DOCUMENTO DE IDENTIDADE', 'DOC. IDENTIDADE', 'REGISTRO GERAL', 'IDENTIDADE', 'RG'],
  birthday: ['3 DATA, LOCAL E UF DE NASCIMENTO', 'DATA, LOCAL E UF DE NASCIMENTO', '3 DATA E LOCAL DE NASCIMENTO', 'DATA E LOCAL DE NASCIMENTO', 'DATA DE NASCIMENTO', 'NASCIMENTO', 'NASC.'],
  filiation: ['FILIAÇÃO', 'FILIACAO', 'NOME DA MÃE', 'NOME DA MAE'],
  registration: ['NUMERO DO REGISTRO', 'REGISTRO CNH', 'REGISTRO'],
  cnh_category: ['CATEGORIA CNH', 'CATEGORIA'],
  cnh_expiry: ['VALIDADE CNH', 'VALIDADE'],
  issue_date: ['DATA DE EMISSAO', 'EMISSAO'],
  license_status: ['SITUACAO DA HABILITACAO', 'CONDUTOR HABILITADO', 'SITUACAO'],
  plate: ['PLACA'],
  renavam: ['RENAVAM'],
  chassis: ['NUMERO DO CHASSI', 'CHASSI'],
  make_model: ['MARCA/MODELO', 'MARCA E MODELO'],
  make: ['MARCA'],
  model: ['MODELO'],
  fabrication_year: ['ANO DE FABRICACAO', 'FABRICACAO'],
  model_year: ['ANO DO MODELO', 'MODELO/ANO'],
  color: ['COR'],
  fuel_type: ['COMBUSTIVEL/ENERGIA', 'COMBUSTIVEL'],
  city: ['MUNICIPIO DE REGISTRO', 'MUNICIPIO'],
  owner_name: ['NOME DO PROPRIETARIO', 'PROPRIETARIO'],
  owner_cpf: ['CPF/CNPJ DO PROPRIETARIO', 'CPF/CNPJ'],
  category: ['CATEGORIA'],
  species: ['ESPECIE'],
  vehicle_type: ['TIPO DE VEICULO', 'TIPO']
};
const ALL_LABELS = [...new Set(Object.values(LABELS).flat().map(normalized))].sort((a, b) => b.length - a.length);
const FIELD_LABELS = Object.values(LABELS).flat();

export function isValidCpf(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const check = offset => {
    let sum = 0;
    for (let index = 0; index < offset - 1; index++) sum += Number(digits[index]) * (offset - index);
    const remainder = (sum * 10) % 11;
    return (remainder === 10 ? 0 : remainder) === Number(digits[offset - 1]);
  };
  return check(10) && check(11);
}

function normalizedWithMap(value) {
  let text = '';
  const rawEndByIndex = [];
  let previousSpace = false;
  const source = String(value || '');
  for (let offset = 0; offset < source.length;) {
    const codePoint = source.codePointAt(offset);
    const original = String.fromCodePoint(codePoint);
    const end = offset + original.length;
    const folded = original.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    for (const character of folded) {
      if (/\s/.test(character)) {
        if (!previousSpace && text) {
          text += ' ';
          rawEndByIndex.push(end);
        }
        previousSpace = true;
      } else {
        text += character;
        for (let index = 0; index < character.length; index++) rawEndByIndex.push(end);
        previousSpace = false;
      }
    }
    offset = end;
  }
  return { text: text.trim(), rawEndByIndex };
}

function allowedLabelPrefix(prefix) {
  const value = prefix.trim().replace(/[:=|–—-]+$/, '').trim().replace(/\.$/, '');
  return !value || /^(?:[1-4][A-Z]?(?:\s*(?:E|&)\s*[1-4][A-Z]?)?)$/.test(value);
}

function findLabelMatch(line, aliases = FIELD_LABELS) {
  const mapped = normalizedWithMap(line);
  for (const label of [...aliases].map(normalized).sort((a, b) => b.length - a.length)) {
    let from = 0;
    while (from < mapped.text.length) {
      const index = mapped.text.indexOf(label, from);
      if (index < 0) break;
      from = index + label.length;
      const before = mapped.text.slice(0, index);
      const after = mapped.text.slice(index + label.length);
      if (!allowedLabelPrefix(before)) continue;
      if (after && (/^[A-Z0-9]/.test(after) || (after.startsWith('/') && !label.includes('/')))) continue;
      if (label === 'NOME' && /^(?:\s+DO PAI|\s+DA MAE|\s+DO CONDUTOR|\s+DO PROPRIETARIO)/.test(after)) continue;
      const rawEnd = mapped.rawEndByIndex[index + label.length - 1] ?? line.length;
      return { label, rawEnd };
    }
  }
  return null;
}

function isKnownLabel(line) {
  return Boolean(findLabelMatch(line));
}

function cleanPersonLine(value) {
  return String(value || '').replace(/^[\s:;=|–—-]+/, '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function looksLikePersonLine(value) {
  const line = cleanPersonLine(value);
  return Boolean(line) && line.length <= 120 && /^[\p{L}\p{M} .,'’‘-]+$/u.test(line) && /\p{L}/u.test(line);
}

function readLabel(text, aliases, { multiline = false, joinWith = ' ', maxLines = 4 } = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index++) {
    const match = findLabelMatch(lines[index], aliases);
    if (!match) continue;
    const sameLine = cleanValue(lines[index].slice(match.rawEnd));
    const parts = sameLine ? [sameLine] : [];
    if (multiline || !sameLine) {
      for (let next = index + 1; next < Math.min(lines.length, index + maxLines + 1); next++) {
        if (isKnownLabel(lines[next])) break;
        const candidate = multiline ? cleanPersonLine(lines[next]) : cleanValue(lines[next]);
        if (!candidate || (multiline && !looksLikePersonLine(candidate))) break;
        parts.push(candidate);
      }
    }
    if (parts.length) return parts.join(joinWith).trim().slice(0, 500);
  }
  return '';
}

function validIsoDate(value) {
  const raw = String(value || '').trim();
  let day, month, year;
  let match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) [, day, month, year] = match;
  else {
    match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    [, year, month, day] = match;
  }
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return '';
  if (Number(year) < 1900 || Number(year) > new Date().getFullYear() + 20) return '';
  return String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}
function extractDate(value) {
  const match = String(value || '').match(/\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2})\b/);
  return match ? match[0] : String(value || '').trim();
}
export function isValidDocumentDate(value) { return Boolean(validIsoDate(extractDate(value))); }
export function isValidCnpj(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const checkDigit = weights => {
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = checkDigit([5,4,3,2,9,8,7,6,5,4,3,2]);
  if (first !== Number(digits[12])) return false;
  const second = checkDigit([6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return second === Number(digits[13]);
}

function documentType(text, kind) {
  const value = normalized(text);
  if (/SENATRAN|CONDUTOR HABILITADO|NUMERO DO REGISTRO/.test(value)) return 'Print de consulta SENATRAN';
  if (/CRLV|CERTIFICADO DE REGISTRO E LICENCIAMENTO|RENAVAM/.test(value)) return 'Documento veicular';
  if (/CARTEIRA NACIONAL DE HABILITACAO|\bCNH\b/.test(value)) return 'CNH';
  if (/\bCIN\b|CARTEIRA DE IDENTIDADE NACIONAL/.test(value)) return 'CIN';
  if (/CARTEIRA DE IDENTIDADE|\bRG\b|REGISTRO GERAL/.test(value)) return 'Documento de identidade';
  return kind === 'people' ? 'Documento pessoal (tipo não identificado)' : 'Documento veicular (tipo não identificado)';
}

const PERSON_FIELDS = [
  ['full_name', 'Nome completo', LABELS.full_name, { multiline: true, maxLines: 4 }],
  ['cpf_digits', 'CPF', LABELS.cpf_digits],
  ['rg', 'RG', LABELS.rg],
  ['birthday', 'Data de nascimento', LABELS.birthday],
  ['filiation', 'Filiação (Anotações)', LABELS.filiation, { multiline: true, joinWith: '\n', maxLines: 6 }],
  ['registration', 'Registro da CNH', LABELS.registration],
  ['cnh_category', 'Categoria da CNH', LABELS.cnh_category],
  ['cnh_expiry', 'Validade da CNH', LABELS.cnh_expiry],
  ['issue_date', 'Data de emissão', LABELS.issue_date],
  ['license_status', 'Situação da habilitação', LABELS.license_status]
];
const VEHICLE_FIELDS = [
  ['plate', 'Placa', LABELS.plate],
  ['renavam', 'RENAVAM', LABELS.renavam],
  ['chassis', 'Chassi', LABELS.chassis],
  ['make', 'Marca', LABELS.make],
  ['model', 'Modelo', LABELS.model],
  ['fabrication_year', 'Ano de fabricação', LABELS.fabrication_year],
  ['model_year', 'Ano do modelo', LABELS.model_year],
  ['color', 'Cor', LABELS.color],
  ['fuel_type', 'Combustível', LABELS.fuel_type],
  ['city', 'Município', LABELS.city],
  ['issuing_state', 'UF', ['UF']],
  ['owner_name', 'Proprietário', LABELS.owner_name],
  ['owner_cpf', 'CPF/CNPJ do proprietário', LABELS.owner_cpf],
  ['category', 'Categoria', LABELS.category],
  ['species', 'Espécie', LABELS.species],
  ['vehicle_type', 'Tipo de veículo', LABELS.vehicle_type]
];

function extractFiliationBlock(notes) {
  const source = String(notes || '').replace(/\r/g, '');
  const expression = /(?:^|\n)Filiação:\s*\n?([\s\S]*?)(?=\n{2,}|$)/i;
  const match = source.match(expression);
  if (!match) return { source, value: '' };
  const lines = match[1].split('\n').map(line => line.trim()).filter(Boolean);
  return { source: source.slice(0, match.index) + source.slice(match.index + match[0].length), value: lines.join('\n') };
}
export function extractFiliationFromNotes(notes) {
  return extractFiliationBlock(notes).value;
}
function cleanFiliation(value) {
  const lines = String(value || '').replace(/\r/g, '').split(/\n|;|\s+\/\s+/).map(line => cleanPersonLine(line)).filter(line => looksLikePersonLine(line) && !/^FILIA(C|Ç)AO:?$/i.test(line));
  const unique = [];
  for (const line of lines) if (!unique.some(existing => normalized(existing) === normalized(line))) unique.push(line);
  return unique;
}
export function mergeFiliationIntoNotes(notes, filiation) {
  const original = String(notes || '').replace(/\r/g, '').trim();
  const extracted = cleanFiliation(filiation);
  if (!extracted.length) return original;
  const existing = extractFiliationBlock(original);
  const oldNames = cleanFiliation(existing.value);
  if (oldNames.length === extracted.length && oldNames.every((name, index) => normalized(name) === normalized(extracted[index]))) return original;
  const remaining = existing.source.split('\n').map(line => line.replace(/[ \t]+$/g, '')).join('\n').trim();
  const block = 'Filiação:\n' + extracted.join('\n');
  return remaining ? remaining + '\n\n' + block : block;
}

export function extractDocumentFields(text, kind = 'people', confidence = 0) {
  const fields = kind === 'vehicles' ? VEHICLE_FIELDS : PERSON_FIELDS;
  const values = {};
  const details = [];
  const warnings = [];
  for (const [key, label, aliases, options = {}] of fields) {
    let value = readLabel(text, aliases, options);
    if (!value) continue;
    let warning = '';
    if (key === 'cpf_digits' || key === 'owner_cpf') {
      const digits = value.replace(/\D/g, '');
      if (key === 'cpf_digits' && !isValidCpf(digits)) warning = 'CPF não passou na validação; confira o documento.';
      if (key === 'owner_cpf' && digits.length === 11 && !isValidCpf(digits)) warning = 'CPF do proprietário inválido; confira o documento.';
      if (key === 'owner_cpf' && digits.length === 14 && !isValidCnpj(digits)) warning = 'CNPJ do proprietário inválido; confira o documento.';
      if (key === 'owner_cpf' && ![11, 14].includes(digits.length)) warning = 'CPF/CNPJ incompleto; confira o documento.';
      value = digits;
    }
    if (key === 'birthday' || key === 'cnh_expiry' || key === 'issue_date') {
      const normalizedDate = validIsoDate(extractDate(value));
      if (!normalizedDate) warning = 'Data não reconhecida ou inválida; confira o documento.';
      else value = normalizedDate;
    }
    if (['fabrication_year', 'model_year'].includes(key) && !/^\d{4}$/.test(value)) warning = 'Ano não reconhecido; confira o documento.';
    if (key === 'renavam') { value = value.replace(/\D/g, ''); if (value.length !== 11) warning = 'RENAVAM deve conter 11 dígitos; confira o documento.'; }
    if (key === 'chassis') { value = value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (value.length !== 17 || /[IOQ]/.test(value)) warning = 'Chassi deve ter 17 caracteres válidos; confira o documento.'; }
    if (key === 'plate') {
      const plate = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!/^(?:[A-Z]{3}[0-9]{4}|[A-Z]{3}[0-9][A-Z][0-9]{2})$/.test(plate)) warning = 'Placa não segue o formato AAA0000 ou AAA0A00.';
      else value = plate;
    }
    if (key === 'registration') { value = value.replace(/[^\d]/g, ''); if (value.length !== 11) warning = 'Número de registro da CNH deve ter 11 dígitos; confira o documento.'; }
    values[key] = value;
    const supported = kind === 'people' ? ['full_name', 'cpf_digits', 'rg', 'birthday', 'filiation'].includes(key) : ['plate', 'make', 'model', 'color'].includes(key);
    details.push({ key, label, value, warning, supported });
    if (warning) warnings.push(label + ': ' + warning);
  }
  if (kind === 'vehicles' && !values.make && !values.model) {
    const combined = readLabel(text, LABELS.make_model);
    if (combined) {
      const parts = combined.split(/[\/]/).map(part => cleanValue(part));
      if (parts[0]) { values.make = parts[0]; details.push({ key: 'make', label: 'Marca', value: parts[0], warning: '', supported: true }); }
      if (parts[1]) { values.model = parts.slice(1).join(' '); details.push({ key: 'model', label: 'Modelo', value: values.model, warning: '', supported: true }); }
    }
  }
  const formKeys = kind === 'vehicles' ? ['plate', 'make', 'model', 'color'] : ['full_name', 'cpf_digits', 'rg', 'birthday', 'filiation'];
  const formValues = Object.fromEntries(formKeys.filter(key => values[key] && !details.some(item => item.key === key && item.warning)).map(key => [key, values[key]]));
  if (confidence > 0 && confidence < 55) warnings.unshift('Leitura com baixa confiança (' + Math.round(confidence) + '%). Confira todos os campos.');
  if (!details.length) warnings.unshift('Não encontrei campos reconhecíveis. Tente outra foto ou um print original.');
  return { type: documentType(text, kind), values, formValues, details, warnings, confidence: Number(confidence) || 0 };
}