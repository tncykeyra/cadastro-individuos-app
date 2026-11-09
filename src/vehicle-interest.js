import { buildVehicleInterestPdf } from './vehicle-interest-pdf.js';

const PAGE_SIZE=40;
const TABLE='service_vehicle_interest';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const statusLabel=status=>status==='baixado'?'Baixado':'Ativo';
const eventLabel=type=>type==='furto'?'Furto':type==='roubo'?'Roubo':'Outra ocorrência';
const eventLetter=type=>type==='furto'?'F':type==='roubo'?'R':'O';
const normalizePart=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
const safeTerm=value=>String(value||'').trim().slice(0,70).replace(/[,%()]/g,' ').replace(/\s+/g,' ');
let rowsById=new Map(),currentFilter='active',currentOffset=0,currentTerm='',editingId='',selectedVehicle=null,vehicleMatches=[],lookupBusy=false,operationBusy=false,currentPlateFormat=localStorage.getItem('vehicle-interest-plate-format')==='inverted'?'inverted':'normal',personalActiveIds=new Set(),personalPreferenceUserId='';
function personalPreferenceKey(userId){return 'vehicle-interest-personal-active-v1:'+String(userId||'')}
function loadPersonalPreferences(userId){
 if(personalPreferenceUserId===String(userId||''))return;
 personalPreferenceUserId=String(userId||'');personalActiveIds=new Set();
 try{const saved=JSON.parse(localStorage.getItem(personalPreferenceKey(userId))||'[]');if(Array.isArray(saved))personalActiveIds=new Set(saved.map(String))}catch{}
}
function savePersonalPreferences(userId){try{localStorage.setItem(personalPreferenceKey(userId),JSON.stringify([...personalActiveIds]))}catch{}}

function fullPlate(numbers,letters){return (String(letters||'').replace(/[^A-Z0-9]/gi,'')+String(numbers||'').replace(/[^A-Z0-9]/gi,'')).toUpperCase()}
function plateParts(plate){const normalized=String(plate||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return{numbers:normalized.slice(-4),letters:normalized.slice(0,3)}}
function parseInterestPlate(value){
 const normalized=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 if(normalized.length!==7)return null;
 const parts={numbers:normalized.slice(3),letters:normalized.slice(0,3)};
 return /^[A-Z0-9]{4}$/.test(parts.numbers)&&/^[A-Z]{3}$/.test(parts.letters)?parts:null
}
function plateDisplay(numbers,letters,format='normal'){const first=String(numbers||'').toUpperCase(),last=String(letters||'').toUpperCase();return format==='inverted'?[first,last].filter(Boolean).join(' '):fullPlate(first,last)}
function formatSelector(){return '<label class="interest-format-setting">Formato da placa<select data-interest-format aria-label="Formato da placa"><option value="normal" '+(currentPlateFormat==='normal'?'selected':'')+'>Normal · ABC1D23</option><option value="inverted" '+(currentPlateFormat==='inverted'?'selected':'')+'>Invertida · 1D23 ABC</option></select></label>'}
function formatDate(value){if(!value)return'—';const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleDateString('pt-BR')}
function place(value){return String(value||'').trim()||'—'}

async function fetchRows(client,status,term='',offset=0,all=false){
 const columns='id,vehicle_id,created_by,city_id,plate_numbers,plate_letters,model,year,color,incident_type,plate_city,occurrence_location,status,closed_reason,closed_at,created_at';
 const pageSize=all?500:PAGE_SIZE,out=[];
 for(let from=offset;from<100000;from+=pageSize){
  let query=client.from(TABLE).select(columns).eq('status',status).order('created_at',{ascending:false});
  const search=safeTerm(term);
  if(search){const pattern='%'+search+'%';query=query.or(['plate_numbers','plate_letters','model','year','color','plate_city','occurrence_location'].map(column=>column+'.ilike.'+pattern).join(','))}
  const {data,error}=await query.range(from,from+pageSize-1);
  if(error)throw error;
  const batch=data||[];out.push(...batch);
  if(!all||batch.length<pageSize)break;
 }
 return out
}
function rowCard(row,userId,hiddenForMe=false){
 const plate=plateDisplay(row.plate_numbers,row.plate_letters);
 const canManage=String(row.created_by)===String(userId);
 const shared=['furto','roubo'].includes(row.incident_type);
 const actions=row.status==='active'?'<div class="interest-card-actions">'+(shared?'<button type="button" class="button secondary small" data-interest-personal-toggle="'+esc(row.id)+'">'+(hiddenForMe?'Ativar para mim':'Ocultar para mim')+'</button>':'')+(canManage?'<button type="button" class="button secondary small" data-interest-edit="'+esc(row.id)+'">Editar</button><button type="button" class="button danger small" data-interest-discharge="'+esc(row.id)+'">Baixar para todos</button>':'')+'</div>':row.status==='baixado'?'<p class="interest-discharge-note"><strong>Motivo da baixa:</strong> '+esc(String(row.closed_reason||'—').toUpperCase())+' <span>· '+esc(formatDate(row.closed_at))+'</span></p>':'';
 const discharge=row.status==='active'&&canManage?'<form class="interest-discharge-form" data-interest-discharge-form="'+esc(row.id)+'" hidden><label>Motivo da baixa<input name="reason" maxlength="400" required placeholder="INFORME POR QUE SAIU DA LISTA"></label><div><button type="button" class="button secondary small" data-interest-discharge-cancel>CANCELAR</button><button type="submit" class="button danger small">CONFIRMAR BAIXA</button></div></form>':'';
 return '<article class="interest-row-card"><div class="interest-row-head"><span class="interest-event-badge event-'+esc(row.incident_type)+'">'+eventLetter(row.incident_type)+'</span><div class="interest-row-main"><strong>'+esc(String(plate||'PLACA NÃO INFORMADA').toUpperCase())+'</strong><span>'+esc(String(row.model||'MODELO NÃO INFORMADO').toUpperCase())+(row.year?' · '+esc(String(row.year).toUpperCase()):'')+(row.color?' · '+esc(String(row.color).toUpperCase()):'')+'</span></div><span class="interest-status '+(hiddenForMe?'is-closed':row.status==='active'?'is-active':'is-closed')+'">'+(hiddenForMe?'OCULTO PARA MIM':statusLabel(row.status).toUpperCase())+'</span></div><div class="interest-row-meta"><span><b>OCORRÊNCIA:</b> '+esc(eventLabel(row.incident_type).toUpperCase())+'</span><span><b>PLACA:</b> '+esc(String(place(row.plate_city)).toUpperCase())+'</span><span><b>LOCAL:</b> '+esc(String(place(row.occurrence_location)).toUpperCase())+'</span></div>'+actions+discharge+'</article>'
}
function formMarkup(cityName){
 return '<section class="interest-entry card" id="interestEntry" hidden><div class="interest-entry-heading"><div><h2 id="interestFormTitle">Adicionar veículo</h2><p class="muted">Preencha só o essencial. Cidade e local podem ficar em branco.</p></div><button type="button" class="close" data-interest-cancel aria-label="Fechar">×</button></div><form id="interestForm" class="interest-form"><div class="interest-type-row"><label>Ocorrência<select name="incident_type" required><option value="">Selecione</option><option value="furto">Furto</option><option value="roubo">Roubo</option><option value="outra">Outra ocorrência</option></select></label><p id="interestIncidentError" class="interest-validation-note" role="alert" hidden>Selecione a ocorrência antes de salvar o veículo.</p><p>Furto e roubo ficam disponíveis para as cidades autorizadas. “Outra ocorrência” fica visível somente para quem cadastrou.</p></div><div class="interest-vehicle-lookup"><label>Localizar veículo já cadastrado (opcional)</label><div class="interest-search-row"><input id="interestVehicleQuery" type="search" maxlength="30" placeholder="Digite a placa ou modelo"><button type="button" class="button secondary" data-interest-vehicle-search aria-label="Buscar veículo">⌕</button></div><div id="interestVehicleResults" class="interest-vehicle-results" aria-live="polite"></div></div><input type="hidden" name="vehicle_id" id="interestVehicleId"><div class="interest-plate-fields"><label class="interest-full">Placa <small data-interest-format-help>PADRÃO NORMAL: ABC1D23</small><input id="interestPlateInput" maxlength="12" autocomplete="off" placeholder="ABC1D23" aria-label="Placa no formato normal"></label><input type="hidden" name="plate_numbers"><input type="hidden" name="plate_letters"><button type="button" class="button secondary interest-plate-lookup" data-interest-plate-search>Buscar na frota</button></div><div class="interest-form-grid"><label>Modelo<input name="model" maxlength="100" placeholder="Ex.: CG 160"></label><label>Ano<input name="year" maxlength="4" inputmode="numeric" placeholder="Ex.: 25"></label><label>Cor<input name="color" maxlength="40" placeholder="Ex.: preta"></label><label>Cidade da placa<input name="plate_city" maxlength="100" placeholder="'+esc(cityName)+'"></label><label class="interest-full">Local da ocorrência<input name="occurrence_location" maxlength="160" placeholder="'+esc(cityName)+'"></label></div><p id="interestSelectedVehicle" class="interest-selected-vehicle" hidden></p><div class="interest-form-actions"><button type="button" class="button secondary" data-interest-cancel>Cancelar</button><button type="submit" class="button">Salvar veículo de interesse</button></div></form></section>'
}
function vehicleMiniCard(vehicle){
 const detail=[vehicle.make,vehicle.model,vehicle.color].filter(Boolean).join(' · ')||'Dados complementares não informados';
 return '<div class="interest-vehicle-match"><button type="button" class="interest-vehicle-card" data-open-vehicle="'+esc(vehicle.id)+'" aria-label="Abrir veículo '+esc(vehicle.plate)+'"><span class="interest-vehicle-photo">'+(vehicle.photo_url?'<img src="'+esc(vehicle.photo_url)+'" alt="" loading="lazy" decoding="async">':'<span aria-hidden="true">🚘</span>')+'</span><span class="interest-vehicle-copy"><strong>'+esc(vehicle.plate)+'</strong><small>'+esc(detail)+'</small><small>Toque para abrir o cadastro ↗</small></span></button><button type="button" class="button small" data-interest-use-vehicle="'+esc(vehicle.id)+'">Usar</button></div>'
}
export async function renderVehicleInterestPage(client,{cityId,cityName,userId,resolvePhoto}={}){
 if(!client||!cityId||!userId)throw new Error('Não foi possível validar sua cidade e seu acesso.');
 loadPersonalPreferences(userId);
 const status=currentFilter==='baixado'?'baixado':'active';
 const allRecords=await fetchRows(client,status,currentTerm,0,true);
 const scopedRecords=currentFilter==='hidden'?allRecords.filter(row=>personalActiveIds.has(String(row.id))):currentFilter==='active'?allRecords.filter(row=>!personalActiveIds.has(String(row.id))):allRecords;
 const totalRecords=scopedRecords.length;
 const records=scopedRecords.slice(currentOffset,currentOffset+PAGE_SIZE);
 rowsById=new Map(allRecords.map(row=>[String(row.id),row]));
 const pageNumber=Math.floor(currentOffset/PAGE_SIZE)+1;
 const cards=records.length?records.map(row=>rowCard(row,userId,personalActiveIds.has(String(row.id)))).join(''):'<div class="empty">'+(currentFilter==='active'?'NENHUM VEÍCULO ATIVO PARA VOCÊ.':'NENHUM VEÍCULO BAIXADO ENCONTRADO.')+'</div>';
 const activeRows=status==='active'?allRecords:await fetchRows(client,'active',currentTerm,0,true);
 const visibleCount=activeRows.filter(row=>!personalActiveIds.has(String(row.id))).length;
 const hiddenCountValue=activeRows.filter(row=>personalActiveIds.has(String(row.id))).length;
 const activeCount=visibleCount.toLocaleString('pt-BR');
 const hiddenCount=hiddenCountValue.toLocaleString('pt-BR');
 let closedCount='—';
 if(status==='baixado')closedCount=allRecords.length.toLocaleString('pt-BR');
 else try{const result=await client.from(TABLE).select('id',{count:'exact',head:true}).eq('status','baixado');if(!result.error)closedCount=Number(result.count||0).toLocaleString('pt-BR')}catch{}
 const caption=currentFilter==='active'?'Ativos para você. Furto e roubo continuam disponíveis às demais cidades e operadores.':currentFilter==='hidden'?'Ocultos somente na sua visualização; os registros continuam ativos para todos.':'Baixados pelo responsável, com motivo registrado.';
 return '<section class="vehicle-interest-page"><header class="interest-page-heading"><div><p class="eyebrow">'+esc(String(cityName||'CIDADE ATUAL').toUpperCase())+'</p><h1>VEÍCULOS DE INTERESSE DO SERVIÇO</h1><p class="muted">LISTA RÁPIDA PARA CONSULTA EM CAMPO. ROUBO E FURTO FICAM DISPONÍVEIS EM TODAS AS CIDADES.</p></div><button class="button" type="button" data-interest-add>＋ ADICIONAR</button></header><div class="interest-toolbar"><div class="interest-status-tabs" role="tablist"><button class="interest-tab '+(currentFilter==='active'?'active':'')+'" type="button" data-interest-filter="active">ATIVOS PARA MIM <span>'+activeCount+'</span></button><button class="interest-tab '+(currentFilter==='hidden'?'active':'')+'" type="button" data-interest-filter="hidden">OCULTOS PARA MIM <span>'+hiddenCount+'</span></button><button class="interest-tab '+(currentFilter==='baixado'?'active':'')+'" type="button" data-interest-filter="baixado">BAIXADOS <span>'+closedCount+'</span></button></div><div class="interest-toolbar-actions">'+formatSelector()+'<div class="interest-pdf-actions"><button class="button interest-pdf-button" type="button" data-interest-share-pdf>⇧ COMPARTILHAR PDF DOS ATIVOS</button><button class="button secondary interest-pdf-save" type="button" data-interest-save-pdf>↓ SALVAR EM DISCO</button><small>PDF compacto 10 × 14 cm · placa em destaque 20 pt</small></div></div></div>'+formMarkup(cityName)+'<div class="interest-search"><label for="interestSearch">PESQUISAR VEÍCULOS</label><div class="interest-search-row"><input id="interestSearch" type="search" value="'+esc(currentTerm)+'" maxlength="70" placeholder="PLACA, MODELO OU LOCAL"><button class="button search-button" type="button" data-interest-search aria-label="Pesquisar">⌕</button></div></div><p class="interest-list-caption">'+records.length.toLocaleString('pt-BR')+' REGISTRO(S) NESTA PÁGINA · '+esc(caption.toUpperCase())+'</p><div class="interest-list">'+cards+'</div><nav class="interest-pagination" aria-label="Paginação"><button type="button" class="button secondary small" data-interest-page="-1" '+(currentOffset===0?'disabled':'')+' aria-label="Página anterior">←</button><span>PÁGINA '+pageNumber+' · '+totalRecords.toLocaleString('pt-BR')+' REGISTRO(S)</span><button type="button" class="button secondary small" data-interest-page="1" '+(currentOffset+records.length>=totalRecords?'disabled':'')+' aria-label="Próxima página">→</button></nav><div id="interestToast" class="interest-feedback" role="status" aria-live="polite"></div></section>'
}
function formValue(form,name){return String(form.elements.namedItem(name)?.value||'').trim()}
function uppercasePageInputs(root){root.querySelectorAll('#interestForm input:not([type=hidden]),#interestForm textarea').forEach(input=>{if(input.dataset.uppercaseBound)return;input.dataset.uppercaseBound='1';input.addEventListener('input',()=>{const start=input.selectionStart,end=input.selectionEnd;input.value=input.value.toLocaleUpperCase('pt-BR');try{input.setSelectionRange(start,end)}catch{}})})}
function setFormValue(form,name,value){const input=form.elements.namedItem(name);if(input)input.value=value??''}
function setFeedback(message,isError=false){const target=document.querySelector('#interestToast');if(target){target.textContent=message;target.classList.toggle('is-error',isError);target.classList.add('show')}}
function resetEntry(){
 const form=document.querySelector('#interestForm'),entry=document.querySelector('#interestEntry');if(form)form.reset();if(entry)entry.hidden=true;
 const selected=document.querySelector('#interestSelectedVehicle');if(selected)selected.hidden=true;
 const results=document.querySelector('#interestVehicleResults');if(results)results.innerHTML='';
 const id=document.querySelector('#interestVehicleId');if(id)id.value='';
 editingId='';selectedVehicle=null;vehicleMatches=[];
 const title=document.querySelector('#interestFormTitle');if(title)title.textContent='Adicionar veículo'
}
async function searchVehicles(client,{term,cityId,resolvePhoto}){
 const clean=safeTerm(term);if(clean.length<2)return[];
 const pattern='%'+clean+'%';
 const result=await client.from('vehicles').select('id,plate,make,model,color,photo_path,city_id').is('archived_at',null).eq('city_id',cityId).or('plate.ilike.'+pattern+',make.ilike.'+pattern+',model.ilike.'+pattern).order('plate').limit(8);
 if(result.error)throw result.error;
 const vehicles=result.data||[];
 await Promise.all(vehicles.map(async vehicle=>{try{vehicle.photo_url=vehicle.photo_path?await resolvePhoto?.(vehicle.photo_path):''}catch{vehicle.photo_url=''}}));
 return vehicles
}
async function lookupPlate(client,{numbers,letters,cityId,resolvePhoto}){
 const plate=fullPlate(numbers,letters);
 if(String(numbers||'').trim().length<1||String(letters||'').trim().length<1)return{plate,vehicle:null};
 const variants=[plate,plate.slice(0,3)+'-'+plate.slice(3),plate.slice(0,3)+' '+plate.slice(3)];
 const result=await client.from('vehicles').select('id,plate,make,model,color,photo_path,photo_paths,city_id').is('archived_at',null).eq('city_id',cityId).in('plate',variants).limit(5);
 if(result.error)throw result.error;
 const vehicle=(result.data||[]).find(item=>String(item.plate||'').toUpperCase().replace(/[^A-Z0-9]/g,'')===plate)||null;
 if(vehicle)try{const photoPath=vehicle.photo_path||(Array.isArray(vehicle.photo_paths)?vehicle.photo_paths[0]:'');vehicle.photo_url=photoPath?await resolvePhoto?.(photoPath):''}catch{vehicle.photo_url=''}
 return{plate,vehicle}
}
function showVehicleResults(items,message=''){
 const results=document.querySelector('#interestVehicleResults');if(!results)return;
 results.innerHTML=items.length?items.map(vehicleMiniCard).join(''):'<p class="muted">'+esc(message||'Nenhum veículo correspondente foi encontrado nesta cidade. Você ainda pode preencher os dados manualmente.')+'</p>'
}
function clearVehicleSelection(keepMessage=false){
 selectedVehicle=null;const id=document.querySelector('#interestVehicleId');if(id)id.value='';
 const selected=document.querySelector('#interestSelectedVehicle');if(selected){selected.hidden=true;selected.innerHTML=''}
 if(!keepMessage){const results=document.querySelector('#interestVehicleResults');if(results)results.innerHTML=''}
}
function useVehicle(vehicle){
 selectedVehicle=vehicle;const form=document.querySelector('#interestForm');if(!form)return;
 const parts=plateParts(vehicle.plate);setFormValue(form,'plate_numbers',parts.numbers);setFormValue(form,'plate_letters',parts.letters);const plateInput=document.querySelector('#interestPlateInput');if(plateInput)plateInput.value=plateDisplay(parts.numbers,parts.letters);
 setFormValue(form,'model',[vehicle.make,vehicle.model].filter(Boolean).join(' ').trim());
 setFormValue(form,'color',vehicle.color||'');setFormValue(form,'vehicle_id',vehicle.id);
 const selected=document.querySelector('#interestSelectedVehicle');if(selected){selected.hidden=false;selected.innerHTML='Veículo vinculado: <strong>'+esc(vehicle.plate)+'</strong> · '+esc([vehicle.make,vehicle.model].filter(Boolean).join(' '))+' <button type="button" class="button secondary small" data-interest-clear-vehicle>Desvincular</button>'}
}
function beginEdit(row){
 const entry=document.querySelector('#interestEntry'),form=document.querySelector('#interestForm');if(!row||!entry||!form)return;
 entry.hidden=false;editingId=String(row.id);selectedVehicle=row.vehicle_id?{id:row.vehicle_id,plate:fullPlate(row.plate_numbers,row.plate_letters),make:'',model:row.model,color:row.color}:null;
 setFormValue(form,'incident_type',row.incident_type);setFormValue(form,'plate_numbers',row.plate_numbers);setFormValue(form,'plate_letters',row.plate_letters);const plateInput=document.querySelector('#interestPlateInput');if(plateInput)plateInput.value=plateDisplay(row.plate_numbers,row.plate_letters);
 setFormValue(form,'model',row.model);setFormValue(form,'year',row.year);setFormValue(form,'color',row.color);setFormValue(form,'plate_city',row.plate_city);setFormValue(form,'occurrence_location',row.occurrence_location);setFormValue(form,'vehicle_id',row.vehicle_id||'');
 const title=document.querySelector('#interestFormTitle');if(title)title.textContent='Editar veículo ativo';
 const submit=form.querySelector('[type=submit]');if(submit)submit.textContent='Salvar alterações';
 entry.scrollIntoView({behavior:'smooth',block:'start'})
}
async function activePdfFile(client,cityName,userId){
 loadPersonalPreferences(userId);
 const rows=(await fetchRows(client,'active','',0,true)).filter(row=>!personalActiveIds.has(String(row.id)));
 if(!rows.length)throw new Error('Não há veículos ativos para gerar o PDF.');
 const bytes=buildVehicleInterestPdf({rows,cityName,generatedAt:new Date(),plateFormat:currentPlateFormat}),blob=new Blob([bytes],{type:'application/pdf'}),date=new Date().toISOString().slice(0,10);
 return new File([blob],'veiculos-interesse-'+date+'.pdf',{type:'application/pdf'})
}
async function shareActivePdf(client,cityName,userId){
 const file=await activePdfFile(client,cityName,userId);
 if(navigator.share&&navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Veículos de interesse do serviço',text:'Tabela de veículos ativos'});setFeedback('PDF compartilhado.');return}catch(error){if(error?.name==='AbortError')return}}
 downloadPdfFile(file);setFeedback('O compartilhamento não está disponível neste aparelho. O PDF foi salvo para compartilhar manualmente.')
}
function downloadPdfFile(file){
 const url=URL.createObjectURL(file),anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;anchor.style.display='none';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
}
async function saveActivePdfToDisk(client,cityName,userId){
 const file=await activePdfFile(client,cityName,userId);downloadPdfFile(file);setFeedback('PDF salvo no dispositivo.')
}
export function wireVehicleInterestActions(client,{cityId,cityName,userId,resolvePhoto,onRefresh}={}){
 const root=document.querySelector('#mainContent');if(!root)return;
 root.__vehicleInterestAbort?.abort?.();const controller=new AbortController();root.__vehicleInterestAbort=controller;const options={signal:controller.signal};uppercasePageInputs(root);
 root.addEventListener('change',event=>{const incident=event.target.closest('#interestForm [name="incident_type"]');if(incident){const notice=root.querySelector('#interestIncidentError');if(notice)notice.hidden=Boolean(incident.value);if(incident.value)incident.setCustomValidity('');}const selector=event.target.closest('[data-interest-format]');if(!selector)return;currentPlateFormat=selector.value==='inverted'?'inverted':'normal';localStorage.setItem('vehicle-interest-plate-format',currentPlateFormat);root.querySelectorAll('[data-interest-format]').forEach(item=>item.value=currentPlateFormat)},options);
 root.addEventListener('invalid',event=>{if(event.target?.name!=='incident_type')return;const notice=root.querySelector('#interestIncidentError');if(notice){notice.hidden=false;notice.scrollIntoView({behavior:'smooth',block:'center'})}event.target.setCustomValidity('Selecione a ocorrência para salvar o veículo.');setFeedback('Selecione a ocorrência antes de salvar o veículo.',true)},true);
 root.addEventListener('click',async event=>{
  const target=event.target.closest?.('[data-interest-add],[data-interest-cancel],[data-interest-filter],[data-interest-search],[data-interest-page],[data-interest-edit],[data-interest-discharge],[data-interest-discharge-cancel],[data-interest-personal-toggle],[data-interest-vehicle-search],[data-interest-plate-search],[data-interest-use-vehicle],[data-interest-clear-vehicle],[data-interest-share-pdf],[data-interest-save-pdf],[data-interest-format]');
  if(!target)return;
  try{
   if(target.hasAttribute('data-interest-add')){const entry=root.querySelector('#interestEntry');entry.hidden=false;entry.scrollIntoView({behavior:'smooth',block:'start'});return}
   if(target.hasAttribute('data-interest-cancel')){resetEntry();return}
   if(target.hasAttribute('data-interest-filter')){currentFilter=target.dataset.interestFilter;currentOffset=0;await onRefresh();return}
   if(target.hasAttribute('data-interest-personal-toggle')){const id=String(target.dataset.interestPersonalToggle);if(personalActiveIds.has(id))personalActiveIds.delete(id);else personalActiveIds.add(id);savePersonalPreferences(userId);await onRefresh();setFeedback(personalActiveIds.has(id)?'Veículo ocultado somente para você.':'Veículo ativado somente para você.');return}
   if(target.hasAttribute('data-interest-search')){currentTerm=safeTerm(root.querySelector('#interestSearch')?.value);currentOffset=0;await onRefresh();return}
   if(target.hasAttribute('data-interest-page')){currentOffset=Math.max(0,currentOffset+Number(target.dataset.interestPage)*PAGE_SIZE);await onRefresh();return}
   if(target.hasAttribute('data-interest-edit')){const row=rowsById.get(String(target.dataset.interestEdit));beginEdit(row);return}
   if(target.hasAttribute('data-interest-discharge')){const row=root.querySelector('[data-interest-discharge-form="'+CSS.escape(target.dataset.interestDischarge)+'"]');if(row){row.hidden=false;row.querySelector('input')?.focus()}return}
   if(target.hasAttribute('data-interest-discharge-cancel')){const form=target.closest('form');if(form)form.hidden=true;return}
   if(target.hasAttribute('data-interest-vehicle-search')){
    const query=root.querySelector('#interestVehicleQuery')?.value||'';const results=root.querySelector('#interestVehicleResults');if(results)results.innerHTML='<p class="muted">Buscando…</p>';
    vehicleMatches=await searchVehicles(client,{term:query,cityId,resolvePhoto});showVehicleResults(vehicleMatches,'Digite pelo menos 2 caracteres.');return
   }
   if(target.hasAttribute('data-interest-plate-search')){
    if(lookupBusy)return;lookupBusy=true;target.disabled=true;const form=root.querySelector('#interestForm');
    try{const parsed=parseInterestPlate(root.querySelector('#interestPlateInput')?.value);if(parsed){setFormValue(form,'plate_numbers',parsed.numbers);setFormValue(form,'plate_letters',parsed.letters)}const result=await lookupPlate(client,{numbers:formValue(form,'plate_numbers'),letters:formValue(form,'plate_letters'),cityId,resolvePhoto});if(result.vehicle){vehicleMatches=[result.vehicle];showVehicleResults(vehicleMatches);setFeedback('Veículo correspondente localizado na frota.');}else{clearVehicleSelection();showVehicleResults([],'Não encontramos essa placa na frota desta cidade. Confira os caracteres ou continue com o registro manual.')} }finally{lookupBusy=false;target.disabled=false}return
   }
   if(target.hasAttribute('data-interest-use-vehicle')){const vehicle=vehicleMatches.find(item=>String(item.id)===String(target.dataset.interestUseVehicle))||vehicleMatches[0];if(vehicle){useVehicle(vehicle);setFeedback('Cadastro do veículo vinculado.');}return}
   if(target.hasAttribute('data-interest-clear-vehicle')){clearVehicleSelection();setFormValue(root.querySelector('#interestForm'),'vehicle_id','');return}
   if(target.hasAttribute('data-interest-share-pdf')){if(operationBusy)return;operationBusy=true;target.disabled=true;await shareActivePdf(client,cityName,userId);operationBusy=false;target.disabled=false;return}\n   if(target.hasAttribute('data-interest-save-pdf')){if(operationBusy)return;operationBusy=true;target.disabled=true;await saveActivePdfToDisk(client,cityName,userId);operationBusy=false;target.disabled=false;return}
  }catch(error){operationBusy=false;setFeedback(error?.message||'Não foi possível concluir a operação. Verifique sua conexão e tente novamente.',true);if(target)target.disabled=false}
 },options);
 root.addEventListener('submit',async event=>{
  const form=event.target;
  if(form?.id==='interestForm'){
   event.preventDefault();if(operationBusy)return;operationBusy=true;
   const submit=form.querySelector('[type=submit]');if(submit){submit.disabled=true;submit.textContent='Salvando…'}
   try{
    const parsedPlate=parseInterestPlate(root.querySelector('#interestPlateInput')?.value);if(parsedPlate){setFormValue(form,'plate_numbers',parsedPlate.numbers);setFormValue(form,'plate_letters',parsedPlate.letters)}const payload={plate_numbers:normalizePart(formValue(form,'plate_numbers')),plate_letters:String(formValue(form,'plate_letters')).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,3),model:formValue(form,'model').toLocaleUpperCase('pt-BR'),year:formValue(form,'year').toLocaleUpperCase('pt-BR'),color:formValue(form,'color').toLocaleUpperCase('pt-BR'),incident_type:formValue(form,'incident_type'),plate_city:formValue(form,'plate_city').toLocaleUpperCase('pt-BR'),occurrence_location:formValue(form,'occurrence_location').toLocaleUpperCase('pt-BR'),vehicle_id:formValue(form,'vehicle_id')||null};
    if(!payload.plate_numbers||!payload.plate_letters||!payload.incident_type)throw new Error('Informe os quatro caracteres da primeira parte da placa, os três da segunda parte e o tipo da ocorrência.');
    if(editingId){const result=await client.from(TABLE).update(payload).eq('id',editingId).select('id').maybeSingle();if(result.error)throw result.error;if(!result.data)throw new Error('Não foi possível confirmar a alteração. Atualize a lista e tente novamente.');setFeedback('Veículo atualizado.')}
    else{const result=await client.from(TABLE).insert({...payload,city_id:cityId,created_by:userId}).select('id').single();if(result.error)throw result.error;setFeedback('Veículo adicionado à lista.')}
    resetEntry();currentFilter='active';currentOffset=0;await onRefresh()
   }catch(error){setFeedback(error?.message||'Não foi possível salvar. Tente novamente.',true)}finally{operationBusy=false;if(submit){submit.disabled=false;submit.textContent=editingId?'Salvar alterações':'Salvar veículo de interesse'}}
   return
  }
  if(form?.matches('[data-interest-discharge-form]')){
   event.preventDefault();if(operationBusy)return;const id=form.dataset.interestDischargeForm,reason=String(new FormData(form).get('reason')||'').trim().toLocaleUpperCase('pt-BR');if(!reason){setFeedback('Informe o motivo da baixa.',true);return}
   if(!confirm('Baixar este veículo da lista ativa? O registro será preservado com o motivo informado.'))return;
   operationBusy=true;const button=form.querySelector('[type=submit]');if(button){button.disabled=true;button.textContent='Baixando…'}
   try{const result=await client.from(TABLE).update({status:'baixado',closed_reason:reason}).eq('id',id).select('id').maybeSingle();if(result.error)throw result.error;if(!result.data)throw new Error('Não foi possível concluir a baixa. Atualize a lista e tente novamente.');setFeedback('Veículo baixado e preservado com o motivo.');await onRefresh()}
   catch(error){setFeedback(error?.message||'Não foi possível baixar o veículo.',true)}finally{operationBusy=false}
  }
 },options);
 const search=root.querySelector('#interestVehicleQuery');search?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();root.querySelector('[data-interest-vehicle-search]')?.click()}},options);
 const plateSearchForm=root.querySelector('#interestForm');let plateLookupTimer=0,plateLookupValue='';
 const plateInput=root.querySelector('#interestPlateInput');
 plateInput?.addEventListener('input',()=>{
  const parsed=parseInterestPlate(plateInput.value);
  if(!parsed){setFormValue(plateSearchForm,'plate_numbers','');setFormValue(plateSearchForm,'plate_letters','');clearVehicleSelection();return}
  setFormValue(plateSearchForm,'plate_numbers',parsed.numbers);setFormValue(plateSearchForm,'plate_letters',parsed.letters);
  const key=fullPlate(parsed.numbers,parsed.letters);if(key===plateLookupValue)return;
  clearTimeout(plateLookupTimer);plateLookupTimer=setTimeout(()=>{plateLookupValue=key;root.querySelector('[data-interest-plate-search]')?.click()},450)
 },options);
 plateInput?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();clearTimeout(plateLookupTimer);plateLookupValue='';root.querySelector('[data-interest-plate-search]')?.click()}},options);
 root.querySelector('#interestSearch')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();root.querySelector('[data-interest-search]')?.click()}},options);
}
