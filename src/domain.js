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

export function formatPersonName(value) {
  const particles = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
  const titleWord = word => word.split(/([-’'])/).map(part => {
    if (part === '-' || part === '’' || part === "'") return part;
    return part ? part.charAt(0).toLocaleUpperCase('pt-BR') + part.slice(1) : '';
  }).join('');
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR').split(' ')
    .map((word, index) => index > 0 && particles.has(word) ? word : titleWord(word))
    .join(' ');
}

function photoSourceKey(value){
  const source=String(value||'').trim();
  if(!source)return '';
  try{
    const url=new URL(source);
    if(url.hostname==='drive.google.com'){
      const id=url.searchParams.get('id')||url.pathname.match(/\/d\/([^/]+)/)?.[1];
      if(id)return 'drive:'+id
    }
    if(url.hostname.endsWith('.supabase.co')){
      const storagePath=url.pathname.match(/\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/]+)\/(.*)$/);
      if(storagePath)return 'supabase:'+storagePath[1]+'/'+decodeURIComponent(storagePath[2])
    }
    if(url.hostname==='storage.googleapis.com'||url.hostname.endsWith('.googleusercontent.com'))return url.origin+url.pathname;
    return source
  }catch{const path=source.replace(/^\/+|\/+$/g,'').replace(/\\/g,'/');return path?'supabase:people-photos/'+path:''}
}
export function normalizeRecordPhotos(photos,primaryCoverPath=''){
  const byPath=new Map();
  for(const photo of Array.isArray(photos)?photos:[]){
    const path=String(photo?.photo_path||'').trim(),key=photoSourceKey(path);
    if(!path||!key)continue;
    const existing=byPath.get(key);
    if(!existing){byPath.set(key,{...photo,photo_path:path,is_cover:Boolean(photo.is_cover)});continue}
    if(!existing.id&&photo.id)existing.id=photo.id;
    if(photo.is_cover)existing.is_cover=true;
    if((!existing.crop_position||existing.crop_position==='50% 50%')&&photo.crop_position)existing.crop_position=photo.crop_position;
    if(!existing.created_at&&photo.created_at)existing.created_at=photo.created_at
  }
  const unique=[...byPath.values()],primaryKey=photoSourceKey(primaryCoverPath);
  const cover=unique.find(photo=>photo.is_cover)||((primaryKey&&byPath.get(primaryKey))||unique[0]||null);
  return unique.map(photo=>({...photo,is_cover:photo===cover})).sort((a,b)=>Number(b.is_cover)-Number(a.is_cover))
}
