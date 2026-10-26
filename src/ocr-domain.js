const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const cleanValue = value => String(value || '').replace(/^[\s:;=|–—-]+/, '').replace(/\s+/g, ' ').trim().slice(0, 240);
const LABELS = {
  full_name: ['NOME COMPLETO', 'NOME DO CONDUTOR', 'NOME DO PROPRIETARIO', 'NOME'],
  cpf_digits: ['CPF', 'CPF DO PROPRIETARIO', 'CPF/CNPJ'],
  rg: ['RG', 'IDENTIDADE', 'REGISTRO GERAL'],
  birthday: ['DATA DE NASCIMENTO', 'NASCIMENTO', 'NASC.'],
  mother_name: ['NOME DA MAE', 'MAE'],
  father_name: ['NOME DO PAI', 'PAI'],
  naturality: ['NATURALIDADE', 'NATURAL DE'],
  nationality: ['NACIONALIDADE'],
  sex: ['SEXO'],
  issuing_authority: ['ORGAO EMISSOR', 'EMISSOR'],
  issuing_state: ['UF DO DOCUMENTO', 'UF', 'ESTADO'],
  registration: ['NUMERO DO REGISTRO', 'REGISTRO CNH', 'REGISTRO'],
  cnh_category: ['CATEGORIA', 'CATEGORIA CNH'],
  cnh_expiry: ['VALIDADE', 'VALIDADE CNH'],
  issue_date: ['DATA DE EMISSAO', 'EMISSAO'],
  license_status: ['SITUACAO DA HABILITACAO', 'CONDUTOR HABILITADO', 'SITUACAO'],
  plate: ['PLACA'],
  renavam: ['RENAVAM'],
  chassis: ['CHASSI', 'NUMERO DO CHASSI'],
  make_model: ['MARCA/MODELO', 'MARCA E MODELO'],
  make: ['MARCA'],
  model: ['MODELO'],
  fabrication_year: ['ANO DE FABRICACAO', 'FABRICACAO'],
  model_year: ['ANO DO MODELO', 'MODELO/ANO'],
  color: ['COR'],
  fuel_type: ['COMBUSTIVEL', 'COMBUSTIVEL/ENERGIA'],
  city: ['MUNICIPIO', 'MUNICIPIO DE REGISTRO'],
  owner_name: ['PROPRIETARIO', 'NOME DO PROPRIETARIO'],
  owner_cpf: ['CPF/CNPJ DO PROPRIETARIO', 'CPF/CNPJ'],
  category: ['CATEGORIA'],
  species: ['ESPECIE'],
  vehicle_type: ['TIPO DE VEICULO', 'TIPO']
};
const ALL_LABELS = [...new Set(Object.values(LABELS).flat().map(normalized))].sort((a, b) => b.length - a.length);
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

function isKnownLabel(line) {
  const value = normalized(line);
  return ALL_LABELS.some(label => value === label || value.startsWith(label + ':') || value.startsWith(label + ' ') || value.startsWith(label + '-'));
}

function readLabel(text, aliases) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  const labels = aliases.map(normalized).sort((a, b) => b.length - a.length);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], value = normalized(line);
    for (const label of labels) {
      if (!(value === label || value.startsWith(label + ':') || value.startsWith(label + ' ') || value.startsWith(label + '-') || value.startsWith(label + '='))) continue;
      const remainder = value.slice(label.length).trimStart();
      if (label === 'NOME' && /^(DO PAI|DA MAE|DO CONDUTOR|DO PROPRIETARIO)\b/.test(remainder)) continue;
      if (label === 'REGISTRO' && /^GERAL\b/.test(remainder)) continue;
      const rawRemainder = line.slice(label.length).replace(/^\s*[:=|–—-]?\s*/, '');
      if (rawRemainder) return cleanValue(rawRemainder);
      for (let next = index + 1; next < Math.min(lines.length, index + 4); next++) {
        if (isKnownLabel(lines[next])) break;
        const candidate = cleanValue(lines[next]);
        if (candidate) return candidate;
      }
    }
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
export function isValidDocumentDate(value) { return Boolean(validIsoDate(value)); }
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
  ['full_name', 'Nome completo', LABELS.full_name],
  ['cpf_digits', 'CPF', LABELS.cpf_digits],
  ['rg', 'RG', LABELS.rg],
  ['birthday', 'Data de nascimento', LABELS.birthday],
  ['mother_name', 'Nome da mãe', LABELS.mother_name],
  ['father_name', 'Nome do pai', LABELS.father_name],
  ['naturality', 'Naturalidade', LABELS.naturality],
  ['nationality', 'Nacionalidade', LABELS.nationality],
  ['sex', 'Sexo', LABELS.sex],
  ['issuing_authority', 'Órgão emissor', LABELS.issuing_authority],
  ['issuing_state', 'UF do documento', LABELS.issuing_state],
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
  ['issuing_state', 'UF', LABELS.issuing_state],
  ['owner_name', 'Proprietário', LABELS.owner_name],
  ['owner_cpf', 'CPF/CNPJ do proprietário', LABELS.owner_cpf],
  ['category', 'Categoria', LABELS.category],
  ['species', 'Espécie', LABELS.species],
  ['vehicle_type', 'Tipo de veículo', LABELS.vehicle_type]
];

export function extractDocumentFields(text, kind = 'people', confidence = 0) {
  const fields = kind === 'vehicles' ? VEHICLE_FIELDS : PERSON_FIELDS;
  const values = {};
  const details = [];
  const warnings = [];
  for (const [key, label, aliases] of fields) {
    let value = readLabel(text, aliases);
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
      const normalizedDate = validIsoDate(value);
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
    details.push({ key, label, value, warning, supported: (kind === 'people' ? ['full_name', 'cpf_digits', 'rg', 'birthday', 'registration'] : ['plate', 'make', 'model', 'color']).includes(key) });
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
  const formValues = kind === 'vehicles'
    ? Object.fromEntries(['plate', 'make', 'model', 'color'].filter(key => values[key] && !details.some(item => item.key === key && item.warning)).map(key => [key, values[key]]))
    : Object.fromEntries(['full_name', 'cpf_digits', 'rg', 'birthday', 'registration'].filter(key => values[key] && !details.some(item => item.key === key && item.warning)).map(key => [key, values[key]]));
  if (confidence > 0 && confidence < 55) warnings.unshift('Leitura com baixa confiança (' + Math.round(confidence) + '%). Confira todos os campos.');
  if (!details.length) warnings.unshift('Não encontrei campos reconhecíveis. Tente outra foto ou um print original.');
  return { type: documentType(text, kind), values, formValues, details, warnings, confidence: Number(confidence) || 0 };
}

