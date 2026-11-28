const digits = value => String(value ?? '').replace(/\D/g, '');
function extractCpf(text) {
 const explicit = text.match(/\bCPF\s*[:\-]?\s*(\d[\d.\s-]{9,18})/i)?.[1];
 if (explicit && digits(explicit).length === 11) return digits(explicit);
 const matches = text.match(/\b\d{3}(?:[.\s]?\d{3}){2}[-\s]?\d{2}\b|\b\d{11}\b/g) || [];
 return digits(matches.find(value => digits(value).length === 11) || '');
}
const streetPrefix = '(?:rua|r\\.|avenida|av\\.?|alameda|al\\.?|travessa|tv\\.?|trav\\.?|pra[cç]a|p[cç]a\\.?|estrada|rodovia|rod\\.?|largo|viela|via)';
const addressLabels = '(?:endere[cç]o(?:\\s+residencial)?|resid[eê]ncia)';
const stopLabels = '(?:cpf|rg|identidade|nascimento|data\\s+de\\s+nascimento|anota[cç][oõ]es|crimes?|ocorr[eê]ncia|envolvimento|telefone|celular)';
function extractAddress(text) {
 const labeled = new RegExp(addressLabels + '\\s*[:\\-]?\\s*', 'i').exec(text);
 const street = new RegExp('\\b' + streetPrefix + '\\s+', 'i').exec(text);
 const marker = labeled || street;
 if (!marker) return { value: '', full: '', start: -1 };
 const start = labeled ? marker.index + marker[0].length : marker.index;
 const remaining = text.slice(start);
 const stop = new RegExp('(?:[,;\\n]\\s*' + stopLabels + '\\s*[:\\-]?|[,;\\n]\\s*(?:abordad[oa]|conhecid[oa]|possui|tem|trabalha|conduzia|suspeit[oa]|envolvid[oa])\\b|[;\\n]|$)', 'i').exec(remaining);
 const end = start + (stop ? stop.index : remaining.length);
 return {
   value: text.slice(start, end).trim().replace(/^[,;\s]+|[,;\s]+$/g, '').replace(/\s+/g, ' '),
   full: text.slice(labeled ? labeled.index : marker.index, end),
   start: labeled ? labeled.index : marker.index
 };
}
export function parseIntelligentText(kind, rawText) {
 const text = String(rawText ?? '').replace(/\r/g, '').trim();
 const cpfDigits = extractCpf(text);
 const cpfSource = text.match(/\bCPF\s*[:\-]?\s*\d[\d.\s-]{9,18}/i)?.[0] || digits(text.match(/\b\d{3}(?:[.\s]?\d{3}){2}[-\s]?\d{2}\b|\b\d{11}\b/)?.[0] || '');
 const dateMatch = text.match(/\b(?:(?:nascid[oa]\s+em|nascimento|data de nascimento)\s*[:\-]?\s*)?(\d{2}[\/.-]\d{2}[\/.-]\d{4})\b/i);
 if (kind === 'person') {
   const nameMatch = text.match(/(?:nome(?: completo)?\s*[:\-]\s*)([\s\S]*?)(?=\s*(?:[,;\n]|\s+(?:CPF|RG|identidade|nascimento|data\s+de\s+nascimento|endere[cç]o|anota[cç][oõ]es|crimes?)\b\s*[:\-]?|$))/i);
   const rgMatch = text.match(/\b(?:RG|identidade)\s*[:\-]?\s*([\w.\/-]{4,20})/i);
   const address = extractAddress(text);
   const firstPart = text.split(/[\n,;]/)[0].trim();
   let name = nameMatch?.[1] || (address.start >= 0 && address.start < firstPart.length ? text.slice(0, address.start) : firstPart);
   name = name.replace(/^\s*(?:cadastrar|ind[ií]viduo|pessoa)\s*/i, '').replace(/\s+(?:residente|mora|reside)\s+(?:em|na|no)?\s*$/i, '');
   if (cpfSource) name = name.replace(cpfSource, ' ');
   name = name.replace(/\bCPF\b.*$/i, '').replace(/\s+/g, ' ').trim();
   let remainder = text;
   for (const field of [nameMatch?.[0], address.full, cpfSource, cpfDigits, rgMatch?.[0], dateMatch?.[0], name]) {
     if (field) remainder = remainder.replace(field, ' ');
   }
   remainder = remainder.replace(/\bCPF\s*[:\-]?\s*/i, ' ').replace(/^\s*(?:mora|reside|residente)\s+(?:em|na|no)?\s*/i, ' ').replace(/[,;]\s*(?=[,;])/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,;|]+|[\s,;|]+$/g, '').trim();
   const notesMatch = text.match(/(?:anota[cç][oõ]es?|crimes?|ocorr[eê]ncia|envolvimento)\s*[:\-]\s*([\s\S]+)$/i);
   return { full_name: name, cpf_digits: cpfDigits, rg: rgMatch?.[1] || '', birthday: dateMatch?.[1] || '', address_primary: address.value, notes: notesMatch?.[1]?.trim() || remainder };
 }
 const plateMatch = text.match(/\b([A-Z]{3}\s*\d[A-Z0-9]\s*\d{2}|[A-Z]{3}\s*\d{4})\b/i);
 const readField = labels => {
   const re = new RegExp('\\b(?:' + labels + ')\\b\\s*[:\\-]?\\s*([^\\n,;]+)', 'i');
   return text.match(re)?.[1]?.trim() || '';
 };
 const notesMatch = text.match(/(?:anota[cç][oõ]es?|observa[cç][oõ]es?)\s*[:\-]\s*([\s\S]+)$/i);
 return { plate: plateMatch?.[1]?.replace(/\s/g, '').toUpperCase() || '', make: readField('marca'), model: readField('modelo'), color: readField('cor'), notes: notesMatch?.[1]?.trim() || '' };
}
export function getSmartPersonSearchTerms(values) {
 const name = String(values?.full_name || '').trim();
 return name.length >= 3 ? [name] : [];
}

export function renderIntelligentEntry(initialKind = 'person') {
  const kind = initialKind === 'vehicle' ? 'vehicle' : 'person';
  const placeholder = kind === 'vehicle'
    ? 'Ex.: Placa ABC1D23; marca Honda; modelo CG 160 Fan; cor vermelha; observações sobre o veículo.'
    : 'Ex.: Nome, CPF, RG, nascimento, endereço completo e anotações do indivíduo.';
  return '<section class="page-intro"><div><h1>Cadastro Inteligente</h1><p>Digite os dados uma vez. O sistema confere nome, CPF, endereço ou placa antes de abrir o formulário e a área de fotos.</p></div></section>' +
    '<section class="smart-entry-panel"><div class="smart-kind-switch" role="group" aria-label="Tipo de cadastro"><button class="button smart-kind '+(kind==='person'?'active':'secondary')+'" type="button" data-smart-kind="person">👤 Indivíduo</button><button class="button smart-kind '+(kind==='vehicle'?'active':'secondary')+'" type="button" data-smart-kind="vehicle">🚗 Veículo</button></div>' +
    '<label class="smart-text-label" for="smartText">Informações para o cadastro</label><textarea id="smartText" class="search smart-text" placeholder="'+placeholder+'"></textarea>' +
    '<div class="smart-examples"><strong>Exemplos para preencher</strong><button type="button" class="button secondary small" data-smart-example="person">Usar exemplo de indivíduo</button><button type="button" class="button secondary small" data-smart-example="vehicle">Usar exemplo de veículo</button></div>' +
    '<button class="button" type="button" id="smartAnalyze">🔎 Conferir duplicidade e organizar dados</button><div id="smartResult" aria-live="polite"></div></section>';
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
