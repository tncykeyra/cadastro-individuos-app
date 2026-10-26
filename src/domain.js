export function normalizeSearchTerm(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLocaleUpperCase('pt-BR');
}

export function isUsefulSearch(value, minimum = 3) {
  return normalizeSearchTerm(value).length >= minimum;
}

export function normalizePlate(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
}

export function isValidPlate(value) {
  const plate = normalizePlate(value);
  return /^(?:[A-Z]{3}[0-9]{4}|[A-Z]{3}[0-9][A-Z][0-9]{2})$/.test(plate);
}
