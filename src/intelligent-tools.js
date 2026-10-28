const digits = value => String(value ?? '').replace(/\D/g, '');
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function parseIntelligentText(kind, rawText) {
  const text = String(rawText ?? '').replace(/\r/g, '').trim();
  const cpfMatch = text.match(/\b(?:CPF\s*[:\-]?\s*)?(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/i);
  const dateMatch = text.match(/\b(?:(?:nascid[oa]\s+em|nascimento|data de nascimento)\s*[:\-]?\s*)?(\d{2}[\/.-]\d{2}[\/.-]\d{4})\b/i);
  if (kind === 'person') {
    const nameMatch = text.match(/(?:nome(?: completo)?\s*[:\-]\s*)([^\n,;]+)/i);
    const rgMatch = text.match(/\b(?:RG|identidade)\s*[:\-]?\s*([\w.\/-]{4,20})/i);
    const name = nameMatch?.[1]?.trim() || text.split(/[\n,;]/)[0].replace(/\bCPF\b.*$/i, '').trim();
    const firstPart = text.split(/[\n,;]/)[0].trim();
    let remainder = text;
    for (const field of [nameMatch?.[0] || firstPart, cpfMatch?.[0], rgMatch?.[0], dateMatch?.[0]]) {
      if (field) remainder = remainder.replace(field, ' ');
    }
    remainder = remainder.replace(/^[\s,;|]+|[\s,;|]+$/g, '').trim();
    const notesMatch = text.match(/(?:anotações?|crimes?|ocorrência|envolvimento)\s*[:\-]\s*([\s\S]+)$/i);
    const notes = notesMatch?.[1]?.trim() || remainder;
    return { full_name: name, cpf_digits: cpfMatch ? digits(cpfMatch[1]) : '', rg: rgMatch?.[1] || '', birthday: dateMatch?.[1] || '', notes };
