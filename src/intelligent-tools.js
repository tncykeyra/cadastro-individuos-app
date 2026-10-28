const digits = value => String(value ?? '').replace(/\D/g, '');

export function parseIntelligentText(kind, rawText) {
  const text = String(rawText ?? '').replace(/\r/g, '').trim();
  const cpfMatch = text.match(/\b(?:CPF\s*[:\-]?\s*)?(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/i);
  const dateMatch = text.match(/\b(?:(?:nascid[oa]\s+em|nascimento|data de nascimento)\s*[:\-]?\s*)?(\d{2}[\/.-]\d{2}[\/.-]\d{4})\b/i);
  if (kind === 'person') {
    const nameMatch = text.match(/(?:nome(?: completo)?\s*[:\-]\s*)([^\n,;]+)/i);
    const rgMatch = text.match(/\b(?:RG|identidade)\s*[:\-]?\s*([\w.\/-]{4,20})/i);
    const firstPart = text.split(/[\n,;]/)[0].trim();
    const name = nameMatch?.[1]?.trim() || firstPart.replace(/\bCPF\b.*$/i, '').trim();
    let remainder = text;
    for (const field of [nameMatch?.[0] || firstPart, cpfMatch?.[0], rgMatch?.[0], dateMatch?.[0]]) {
      if (field) remainder = remainder.replace(field, ' ');
    }
    remainder = remainder.replace(/^[\s,;|]+|[\s,;|]+$/g, '').trim();
    const notesMatch = text.match(/(?:anotações?|crimes?|ocorrência|envolvimento)\s*[:\-]\s*([\s\S]+)$/i);
    const notes = notesMatch?.[1]?.trim() || remainder;
    return { full_name: name, cpf_digits: cpfMatch ? digits(cpfMatch[1]) : '', rg: rgMatch?.[1] || '', birthday: dateMatch?.[1] || '', notes };
  }

  const plateMatch = text.match(/\b([A-Z]{3}\s*\d[A-Z0-9]\s*\d{2}|[A-Z]{3}\s*\d{4})\b/i);
  const readField = labels => {
    const re = new RegExp('(?:' + labels + ')\\s*[:\\-]\\s*([^\\n,;]+)', 'i');
    return text.match(re)?.[1]?.trim() || '';
  };
  const notesMatch = text.match(/(?:anotações?|observações?)\s*[:\-]\s*([\s\S]+)$/i);
  return {
    plate: plateMatch?.[1]?.replace(/\s/g, '').toUpperCase() || '',
    make: readField('marca'),
    model: readField('modelo'),
    color: readField('cor'),
    notes: notesMatch?.[1]?.trim() || ''
  };
}

export function renderIntelligentEntry() {
  return '<section class="page-intro"><div><h1>Cadastro Inteligente</h1><p>Organize informações digitadas e confira possíveis registros existentes antes de continuar.</p></div></section>' +
    '<section class="smart-entry-panel"><div class="smart-kind-switch" role="group" aria-label="Tipo de cadastro"><button class="button smart-kind active" type="button" data-smart-kind="person">👤 Indivíduo</button><button class="button secondary smart-kind" type="button" data-smart-kind="vehicle">🚗 Veículo</button></div>' +
    '<label class="smart-text-label" for="smartText">Digite as informações</label><textarea id="smartText" class="search smart-text" placeholder="Ex.: João Carlos da Silva, CPF 12345678909, RG 456789, nascido em 15/03/1990..."></textarea>' +
    '<button class="button" type="button" id="smartAnalyze">Analisar informações</button><div id="smartResult" aria-live="polite"></div></section>';
}

export function inspectRecords(people, vehicles) {
  const findings = [];
  const cpfGroups = new Map();
  for (const person of people) {
    const cpf = digits(person.cpf_digits || person.cpf);
    if (cpf) cpfGroups.set(cpf, [...(cpfGroups.get(cpf) || []), person]);
    if (!String(person.full_name || '').trim()) findings.push({ type: 'Indivíduo', id: person.id, label: 'Nome ausente', detail: 'O registro está sem nome.' });
    if (cpf && cpf.length !== 11) findings.push({ type: 'Indivíduo', id: person.id, label: 'CPF incompleto', detail: 'O CPF armazenado não contém 11 dígitos.' });
    if (!cpf) findings.push({ type: 'Indivíduo', id: person.id, label: 'CPF ausente', detail: 'Campo opcional não preenchido.', low: true });
  }
  for (const rows of cpfGroups.values()) if (rows.length > 1) findings.push({ type: 'Indivíduos', id: rows[0].id, label: 'Possível CPF duplicado', detail: rows.map(row => row.full_name || row.id).join(' · ') });
  const plateGroups = new Map();
  for (const vehicle of vehicles) {
    const plate = String(vehicle.plate || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    if (plate) plateGroups.set(plate, [...(plateGroups.get(plate) || []), vehicle]);
    if (!String(vehicle.plate || '').trim()) findings.push({ type: 'Veículo', id: vehicle.id, label: 'Placa ausente', detail: 'Não foi possível validar duplicidade sem placa.', low: true });
  }
  for (const rows of plateGroups.values()) if (rows.length > 1) findings.push({ type: 'Veículos', id: rows[0].id, label: 'Possível placa duplicada', detail: rows.map(row => [row.make, row.model, row.plate].filter(Boolean).join(' ')).join(' · ') });
  return findings;
}
