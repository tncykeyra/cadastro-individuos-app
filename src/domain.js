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

function photoHashDistance(left,right){if(!/^[\da-f]{16}$/i.test(String(left||''))||!/^[\da-f]{16}$/i.test(String(right||'')))return null;let bits=BigInt('0x'+left)^BigInt('0x'+right),count=0;while(bits){count+=Number(bits&1n);bits>>=1n}return count}
export function arePhotoHashesSimilar(left,right,maxDistance=3){const distance=photoHashDistance(left,right);return distance!==null&&distance<=maxDistance}
export function dedupePhotoSources(photos,maxDistance=3){const groups=new Map(),kept=[];for(const photo of photos||[]){const difference=photo.difference_hash,average=photo.average_hash;if(!/^[\da-f]{16}$/i.test(String(difference||''))||!/^[\da-f]{16}$/i.test(String(average||''))){kept.push(photo);continue}const group=String(photo.dedupe_group||'record'),bucket=groups.get(group)||[];if(bucket.some(existing=>arePhotoHashesSimilar(existing.difference_hash,difference,maxDistance)&&arePhotoHashesSimilar(existing.average_hash,average,maxDistance)))continue;bucket.push(photo);groups.set(group,bucket);kept.push(photo)}return kept}
