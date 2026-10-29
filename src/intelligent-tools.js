const digits = value => String(value ?? '').replace(/\D/g, '');

export function parseIntelligentText(kind, rawText) {
  const text = String(rawText ?? '').replace(/\r/g, '').trim();
  const cpfMatch = text.match(/\b(?:CPF\s*[:\-]?\s*)?(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/i);
  const dateMatch = text.match(/\b(?:(?:nascid[oa]\s+em|nascimento|data de nascimento)\s*[:\-]?\s*)?(\d{2}[\/.-]\d{2}[\/.-]\d{4})\b/i);
  if (kind === 'person') {
    const nameMatch = text.match(/(?:nome(?: completo)?\s*[:\-]\s*)([^\n,;]+)/i);
    const rgMatch = text.match(/\b(?:RG|identidade)\s*[:\-]?\s*([\w.\/-]{4,20})/i);
    const addressLabels = '(?:endere[cç]o(?:\\s+residencial)?|resid[eê]ncia|residente\\s+(?:em|na|no)|mora\\s+(?:em|na|no))';
    const streetPrefix = '(?:rua|r\\.|avenida|av\\.?|alameda|al\\.?|travessa|tv\\.?|pra[cç]a|estrada|rodovia|rod\\.?|largo|viela|via)';
    const nextPersonLabel = '(?:nome(?:\\s+completo)?|cpf|rg|identidade|nascimento|data\\s+de\\s+nascimento|anota[cç][oõ]es|crimes?|ocorr[eê]ncia|envolvimento|telefone|celular)';
    const addressEnd = '(?=(?:[,;\\n]\\s*' + nextPersonLabel + '\\s*[:\\-]?)|[;\\n]|$)';
    const labeledAddress = text.match(new RegExp(addressLabels + '\\s*[:\\-]?\\s*([\\s\\S]*?)' + addressEnd, 'i'));
    const streetAddress = text.match(new RegExp('(?:^|[,;\\n])\\s*(' + streetPrefix + '\\s+[^,;\\n]+(?:,[^;\\n]*)?)' + addressEnd, 'i'));
    const addressMatch = labeledAddress || streetAddress;
    const addressValue = addressMatch?.[1]?.replace(/[,;]\s*(?:CPF|RG|identidade|nascimento|data\s+de\s+nascimento|anota[cç][oõ]es|crimes?|ocorr[eê]ncia|envolvimento|telefone|celular)\s*[:\-]?[\s\S]*$/i, '').trim() || '';
    const firstPart = text.split(/[\n,;]/)[0].trim();
    const name = nameMatch?.[1]?.trim() || firstPart.replace(/\bCPF\b.*$/i, '').trim();
    let remainder = text;
    for (const field of [nameMatch?.[0] || firstPart, cpfMatch?.[0], rgMatch?.[0], dateMatch?.[0], addressMatch?.[0]]) {
      if (field) remainder = remainder.replace(field, ' ');
    }
    remainder = remainder.replace(/^[\s,;|]+|[\s,;|]+$/g, '').trim();
    const notesMatch = text.match(/(?:anotações?|crimes?|ocorrência|envolvimento)\s*[:\-]\s*([\s\S]+)$/i);
    const notes = notesMatch?.[1]?.trim() || remainder;
    return { full_name: name, cpf_digits: cpfMatch ? digits(cpfMatch[1]) : '', rg: rgMatch?.[1] || '', birthday: dateMatch?.[1] || '', address_primary: addressValue.replace(/^[,;\s]+|[,;\s]+$/g, '').replace(/\s+/g, ' '), notes };
  }

  const plateMatch = text.match(/\b([A-Z]{3}\s*\d[A-Z0-9]\s*\d{2}|[A-Z]{3}\s*\d{4})\b/i);
  const readField = labels => {
    const re = new RegExp('\\b(?:' + labels + ')\\b\\s*[:\\-]?\\s*([^\\n,;]+)', 'i');
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

export function getSmartPersonSearchTerms(values) {
  const name = String(values?.full_name || '').trim();
  return name.length >= 3 ? [name] : [];
}
export function renderIntelligentEntry(initialKind = 'person') {
  const kind = initialKind === 'vehicle' ? 'vehicle' : 'person';
  const placeholder = kind === 'vehicle'
    ? 'Ex.: Veículo Gol branco, placa ABC1D23, ligado a uma pessoa...'
    : 'Ex.: João da Silva, CPF..., mora na Rua das Flores...';
  return '<section class="page-intro"><div><h1>Cadastro Inteligente</h1><p>Converse com o assistente para organizar os dados, conferir duplicidades e preparar o cadastro.</p></div></section>' +
    '<section class="smart-entry-panel"><div class="smart-kind-switch" role="group" aria-label="Tipo de cadastro"><button class="button smart-kind '+(kind==='person'?'active':'secondary')+'" type="button" data-smart-kind="person">👤 Indivíduo</button><button class="button smart-kind '+(kind==='vehicle'?'active':'secondary')+'" type="button" data-smart-kind="vehicle">🚗 Veículo</button></div>' +
    '<label class="smart-ai-optin"><input id="smartUseLocalAi" type="checkbox"><span><strong>✨ IA generativa local (opcional)</strong><small>Só processa o texto no aparelho ao enviar mensagem com a opção marcada. Requer WebGPU e baixa um modelo na primeira utilização. Sem suporte, o modo leve continua disponível.</small></span></label><p class="smart-ai-status" id="smartAiStatus" role="status" aria-live="polite"></p>' +
    '<section class="smart-chat" aria-label="Conversa do Cadastro Inteligente"><div class="smart-chat-heading"><div><h2>Assistente de cadastro</h2><p>Envie os dados aos poucos. Você pode corrigir informações sem reiniciar.</p></div><button class="button secondary small" type="button" id="smartChatReset">Nova conversa</button></div>' +
    '<div class="smart-chat-log" id="smartChatMessages" role="log" aria-live="polite"><div class="smart-chat-bubble assistant">Olá! Descreva a pessoa ou o veículo. Você pode informar nome, CPF, endereço, placa e outros detalhes em mensagens separadas.</div></div>' +
    '<div class="smart-chat-draft" id="smartChatDraft"><strong>Ficha em preparação</strong><span>Os campos reconhecidos aparecerão aqui para conferência.</span></div>' +
    '<label class="smart-chat-label" for="smartChatInput">Sua mensagem</label><textarea id="smartChatInput" class="search smart-chat-input" placeholder="'+placeholder+'" rows="3"></textarea>' +
    '<div class="smart-chat-actions"><button class="button" type="button" id="smartChatSend">Enviar mensagem</button><button class="button secondary" type="button" id="smartChatFinalize" disabled>Conferir duplicidade e continuar</button></div></section>' +
    '<details class="smart-direct-entry"><summary>Preencher tudo de uma vez</summary><label class="smart-text-label" for="smartText">Informações para o cadastro</label><textarea id="smartText" class="search smart-text" placeholder="'+placeholder+'"></textarea>' +
    '<div class="smart-examples"><strong>Exemplos</strong><button type="button" class="button secondary small" data-smart-example="person">Exemplo de indivíduo</button><button type="button" class="button secondary small" data-smart-example="vehicle">Exemplo de veículo</button></div>' +
    '<button class="button secondary" type="button" id="smartAnalyze">Analisar texto único</button></details><div id="smartResult" aria-live="polite"></div></section>';
}

export function mergeSmartChatDraft(kind, current = {}, deterministic = {}, generated = {}) {
  const allowed = kind === 'person'
    ? ['full_name', 'cpf_digits', 'rg', 'birthday', 'address_primary', 'notes']
    : ['plate', 'make', 'model', 'color', 'notes'];
  const identifier = kind === 'person' ? 'cpf_digits' : 'plate';
  const result = {};
  for (const key of allowed) {
    if (key === identifier) {
      result[key] = String(deterministic[key] || current[key] || '').trim();
      continue;
    }
    result[key] = String(generated[key] || deterministic[key] || current[key] || '').trim();
  }
  return result;
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
  for (const rows of cpfGroups.values()) if (rows.length > 1) {
    const identified = rows.filter(row => digits(row.cpf_digits || row.cpf).length === 11);
    for (let i = 0; i < identified.length; i++) for (let j = i + 1; j < identified.length; j++) {
      const left = identified[i], right = identified[j];
      findings.push({ type: 'Indivíduos', id: left.id, duplicateId: right.id, duplicateKind: 'people', label: 'Possível CPF duplicado', detail: [left.full_name || left.id, right.full_name || right.id].join(' · ') });
    }
  }
  const plateGroups = new Map();
  for (const vehicle of vehicles) {
    const plate = String(vehicle.plate || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    if (plate) plateGroups.set(plate, [...(plateGroups.get(plate) || []), vehicle]);
    if (!String(vehicle.plate || '').trim()) findings.push({ type: 'Veículo', id: vehicle.id, label: 'Placa ausente', detail: 'Não foi possível validar duplicidade sem placa.', low: true });
  }
  for (const rows of plateGroups.values()) if (rows.length > 1) {
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const left = rows[i], right = rows[j];
      findings.push({ type: 'Veículos', id: left.id, duplicateId: right.id, duplicateKind: 'vehicles', label: 'Possível placa duplicada', detail: [[left.make, left.model, left.plate].filter(Boolean).join(' '), [right.make, right.model, right.plate].filter(Boolean).join(' ')].join(' · ') });
    }
  }
  return findings;
}


export function duplicateReviewPairKey(entity, leftId, rightId) {
  const [first, second] = [String(leftId), String(rightId)].sort();
  return [entity, first, second].join(':');
}

export function parseIntelligentBundle(rawText) {
  const text = String(rawText ?? '').replace(/\r/g, '').trim();
  const person = parseIntelligentText('person', text);
  const vehicle = parseIntelligentText('vehicle', text);
  const labeledName = text.match(/(?:nome(?:\s+completo)?|pessoa|ind[ií]viduo|condutor)\s*[:\-]\s*([^\n,;]+)/i);
  const relatedName = text.match(/(?:pertencente\s+a|relacionad[oa]\s+a|associad[oa]\s+a)\s*([A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ'’-]*(?:\s+[A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ'’-]*){1,7})(?=\s*(?:[,;]|\bCPF\b|\bRG\b|$))/i);
  const cpfIndex = text.search(/\bCPF\b/i);
  const beforeCpf = cpfIndex >= 0 ? text.slice(0, cpfIndex) : '';
  const namePrefix = beforeCpf || text.slice(0, (text.search(/[,;]\s*(?:propriet[aá]rio|condutor|ve[ií]culo|carro|moto|placa|marca|modelo|cor)\b/i) + 1) || text.length);
  const vehicleBefore = /\b(?:placa|marca|modelo|cor)\b/i.test(namePrefix);
  const prefixName = !vehicleBefore
    ? namePrefix.replace(/^\s*(?:cadastrar|ind[ií]viduo|pessoa)\s*/i, '').replace(/[,:;\s]+$/g, '').trim()
    : '';
  const name = (labeledName?.[1] || relatedName?.[1] || prefixName || '').trim().replace(/\s+/g, ' ');
  person.full_name = name || '';
  const inferredMake = text.match(/\b(Volkswagen|VW|Chevrolet|GM|Fiat|Ford|Honda|Toyota|Hyundai|Renault|Nissan|Yamaha|Suzuki|Jeep|Peugeot|Citro[eë]n|Mitsubishi|BMW|Mercedes[- ]Benz|Kawasaki|Dafra)\s+([A-Z0-9][A-Z0-9.-]*)/i);
  if (!vehicle.make && inferredMake) vehicle.make = /^VW$/i.test(inferredMake[1]) ? 'Volkswagen' : /^GM$/i.test(inferredMake[1]) ? 'Chevrolet' : inferredMake[1];
  if (/^VW$/i.test(vehicle.make)) vehicle.make = 'Volkswagen';
  else if (/^GM$/i.test(vehicle.make)) vehicle.make = 'Chevrolet';
  if (!vehicle.model && inferredMake) vehicle.model = inferredMake[2];
  const knownModel=text.match(/\b(Corolla|Hilux|Yaris|Gol|Polo|Virtus|T-Cross|Uno|Palio|Argo|Mobi|Onix|Prisma|Celta|Corsa|Civic|City|Fit|CG(?:\\s*160)?|Biz|Pop|XRE|Fazer|Factor|HB20|Creta|Duster|Sandero|Kwid|Compass|Renegade)\b/i);
  if(!vehicle.model&&knownModel)vehicle.model=knownModel[1];
  const inferredColor = text.match(/\b(preta?|branc[oa]|azul|vermelha?|prata|cinza|verde|amarela?|marrom|bege|dourada?)\b/i);
  if (!vehicle.color && inferredColor) vehicle.color = inferredColor[1];
  const modelMention=text.match(/\b(?:um|uma|modelo|carro|ve[ií]culo|moto|motocicleta)\s+(?:modelo\s+)?([A-Z0-9][A-Z0-9.-]{1,20})\b/i);
  if(!vehicle.model&&modelMention&&vehicle.plate)vehicle.model=modelMention[1];
  const hasPerson = Boolean(person.full_name && (person.cpf_digits || /\b(?:nome|pessoa|ind[ií]viduo|condutor|pertencente a|relacionad[oa] a|propriet[aá]rio)\b/i.test(text)));
  const hasVehicle = Boolean(vehicle.plate);
  return { person, vehicle, hasPerson, hasVehicle };
}
