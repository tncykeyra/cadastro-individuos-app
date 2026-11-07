import { buildVehicleInterestPdf } from './vehicle-interest-pdf.js';

const PAGE_SIZE=40;
const TABLE='service_vehicle_interest';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const statusLabel=status=>status==='baixado'?'Baixado':'Ativo';
const eventLabel=type=>type==='furto'?'Furto':type==='roubo'?'Roubo':'Outra ocorrência';
const eventLetter=type=>type==='furto'?'F':type==='roubo'?'R':'O';
const normalizePart=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
const safeTerm=value=>String(value||'').trim().slice(0,70).replace(/[,%()]/g,' ').replace(/\s+/g,' ');
let rowsById=new Map(),currentFilter='active',currentOffset=0,currentTerm='',editingId='',selectedVehicle=null,vehicleMatches=[],lookupBusy=false,operationBusy=false;

function fullPlate(numbers,letters){return (String(letters||'').replace(/[^A-Z0-9]/gi,'')+String(numbers||'').replace(/[^A-Z0-9]/gi,'')).toUpperCase()}
function plateParts(plate){const normalized=String(plate||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return{numbers:normalized.slice(0,4),letters:normalized.slice(4,7)}}
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
function rowCard(row){
 const plate=fullPlate(row.plate_numbers,row.plate_letters),loc=[row.plate_city,row.occurrence_location].filter(Boolean).join(' · ');
 const actions=row.status==='active'?'<div class="interest-card-actions"><button type="button" class="button secondary small" data-interest-edit="'+esc(row.id)+'">Editar</button><button type="button" class="button danger small" data-interest-discharge="'+esc(row.id)+'">Baixar</button></div>':'<p class="interest-discharge-note"><strong>Motivo da baixa:</strong> '+esc(row.closed_reason||'—')+' <span>· '+esc(formatDate(row.closed_at))+'</span></p>';
 const discharge=row.status==='active'?'<form class="interest-discharge-form" data-interest-discharge-form="'+esc(row.id)+'" hidden><label>Motivo da baixa<input name="reason" maxlength="400" required placeholder="Informe por que saiu da lista"></label><div><button type="button" class="button secondary small" data-interest-discharge-cancel>Cancelar</button><button type="submit" class="button danger small">Confirmar baixa</button></div></form>':'';
 return '<article class="interest-row-card"><div class="interest-row-head"><label class="interest-select" title="Incluir no PDF"><input type="checkbox" data-interest-pdf-select="'+esc(row.id)+'" '+(row.status==='active'?'':'disabled')+'><span class="sr-only">Selecionar para o PDF</span></label><span class="interest-event-badge event-'+esc(row.incident_type)+'">'+eventLetter(row.incident_type)+'</span><div class="interest-row-main"><strong>'+esc(plate||'Placa não informada')+'</strong><span>'+esc(row.model||'Modelo não informado')+(row.year?' · '+esc(row.year):'')+(row.color?' · '+esc(row.color):'')+'</span></div><span class="interest-status '+(row.status==='active'?'is-active':'is-closed')+'">'+statusLabel(row.status)+'</span></div><div class="interest-row-meta"><span><b>Ocorrência:</b> '+esc(eventLabel(row.incident_type))+'</span><span><b>Placa:</b> '+esc(place(row.plate_city))+'</span><span><b>Local:</b> '+esc(place(row.occurrence_location))+'</span></div>'+actions+discharge+'</article>'
}
function formMarkup(cityName){
 return '<section class="interest-entry card" id="interestEntry" hidden><div class="interest-entry-heading"><div><h2 id="interestFormTitle">Adicionar veículo</h2><p class="muted">Preencha só o essencial. Cidade e local podem ficar em branco.</p></div><button type="button" class="close" data-interest-cancel aria-label="Fechar">×</button></div><form id="interestForm" class="interest-form"><div class="interest-type-row"><label>Ocorrência<select name="incident_type" required><option value="">Selecione</option><option value="furto">Furto</option><option value="roubo">Roubo</option><option value="outra">Outra ocorrência</option></select></label><p>Furto e roubo ficam disponíveis para as cidades autorizadas. “Outra ocorrência” fica visível somente para quem cadastrou.</p></div><div class="interest-vehicle-lookup"><label>Localizar veículo já cadastrado (opcional)</label><div class="interest-search-row"><input id="interestVehicleQuery" type="search" maxlength="30" placeholder="Digite a placa ou modelo"><button type="button" class="button secondary" data-interest-vehicle-search aria-label="Buscar veículo">⌕</button></div><div id="interestVehicleResults" class="interest-vehicle-results" aria-live="polite"></div></div><input type="hidden" name="vehicle_id" id="interestVehicleId"><div class="interest-plate-fields"><label>Números <small>(como aparece na tabela)</small><input name="plate_numbers" maxlength="4" required autocomplete="off" placeholder="0000" aria-label="Parte numérica da placa"></label><span class="interest-plate-separator" aria-hidden="true">—</span><label>Letras<input name="plate_letters" maxlength="3" required autocomplete="off" placeholder="XXX" aria-label="Parte de letras da placa"></label><button type="button" class="button secondary interest-plate-lookup" data-interest-plate-search>Buscar na frota</button></div><div class="interest-form-grid"><label>Modelo<input name="model" maxlength="100" placeholder="Ex.: CG 160"></label><label>Ano<input name="year" maxlength="4" inputmode="numeric" placeholder="Ex.: 25"></label><label>Cor<input name="color" maxlength="40" placeholder="Ex.: preta"></label><label>Cidade da placa<input name="plate_city" maxlength="100" placeholder="'+esc(cityName)+'"></label><label class="interest-full">Local da ocorrência<input name="occurrence_location" maxlength="160" placeholder="'+esc(cityName)+'"></label></div><p id="interestSelectedVehicle" class="interest-selected-vehicle" hidden></p><div class="interest-form-actions"><button type="button" class="button secondary" data-interest-cancel>Cancelar</button><button type="submit" class="button">Salvar veículo de interesse</button></div></form></section>'
}
function vehicleMiniCard(vehicle){
 const detail=[vehicle.make,vehicle.model,vehicle.color].filter(Boolean).join(' · ')||'Dados complementares não informados';
 return '<div class="interest-vehicle-match"><button type="button" class="interest-vehicle-card" data-open-vehicle="'+esc(vehicle.id)+'" aria-label="Abrir veículo '+esc(vehicle.plate)+'"><span class="interest-vehicle-photo">'+(vehicle.photo_url?'<img src="'+esc(vehicle.photo_url)+'" alt="" loading="lazy" decoding="async">':'<span aria-hidden="true">🚘</span>')+'</span><span class="interest-vehicle-copy"><strong>'+esc(vehicle.plate)+'</strong><small>'+esc(detail)+'</small><small>Toque para abrir o cadastro ↗</small></span></button><button type="button" class="button small" data-interest-use-vehicle="'+esc(vehicle.id)+'">Usar</button></div>'
}
export async function renderVehicleInterestPage(client,{cityId,cityName,userId,resolvePhoto}={}){
 if(!client||!cityId||!userId)throw new Error('Não foi possível validar sua cidade e seu acesso.');
 const records=await fetchRows(client,currentFilter,currentTerm,currentOffset);
 rowsById=new Map(records.map(row=>[String(row.id),row]));
 const pages=Math.max(1,Math.ceil(records.length/PAGE_SIZE)),pageNumber=Math.floor(currentOffset/PAGE_SIZE)+1;
 const cards=records.length?records.map(rowCard).join(''):'<div class="empty">'+(currentFilter==='active'?'Nenhum veículo ativo na tabela.':'Nenhum veículo baixado encontrado.')+'</div>';
 const counts=await Promise.all(['active','baixado'].map(async status=>{try{return(await fetchRows(client,status,'',0,true)).length}catch{return null}}));
 const activeCount=counts[0]===null?'—':counts[0].toLocaleString('pt-BR'),closedCount=counts[1]===null?'—':counts[1].toLocaleString('pt-BR');
 return '<section class="vehicle-interest-page"><header class="interest-page-heading"><div><p class="eyebrow">'+esc(cityName||'Cidade atual')+'</p><h1>Veículos de interesse do serviço</h1><p class="muted">Lista rápida para consulta em campo. Furto e roubo ficam disponíveis em todas as cidades.</p></div><button class="button" type="button" data-interest-add>＋ Adicionar</button></header><div class="interest-toolbar"><div class="interest-status-tabs" role="tablist"><button class="interest-tab '+(currentFilter==='active'?'active':'')+'" type="button" data-interest-filter="active">Ativos <span>'+activeCount+'</span></button><button class="interest-tab '+(currentFilter==='baixado'?'active':'')+'" type="button" data-interest-filter="baixado">Baixados <span>'+closedCount+'</span></button></div><button class="button interest-pdf-button" type="button" data-interest-share-pdf>⇧ Compartilhar PDF dos ativos</button></div>'+formMarkup(cityName)+'<div class="interest-search"><label for="interestSearch">Pesquisar veículos</label><div class="interest-search-row"><input id="interestSearch" type="search" value="'+esc(currentTerm)+'" maxlength="70" placeholder="Placa, modelo ou local"><button class="button search-button" type="button" data-interest-search aria-label="Pesquisar">⌕</button></div></div><p class="interest-list-caption">'+records.length.toLocaleString('pt-BR')+' registro(s) nesta página · '+(currentFilter==='active'?'somente veículos ativos entram no PDF.':'baixados preservados com o motivo.')+'</p><div class="interest-list">'+cards+'</div><nav class="interest-pagination" aria-label="Paginação"><button type="button" class="button secondary small" data-interest-page="-1" '+(currentOffset===0?'disabled':'')+' aria-label="Página anterior">←</button><span>Página '+pageNumber+(records.length===PAGE_SIZE?' · há mais resultados':'')+'</span><button type="button" class="button secondary small" data-interest-page="1" '+(records.length<PAGE_SIZE?'disabled':'')+' aria-label="Próxima página">→</button></nav><div id="interestToast" class="interest-feedback" role="status" aria-live="polite"></div></section>'
}
function formValue(form,name){return String(form.elements.namedItem(name)?.value||'').trim()}
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
 const result=await client.from('vehicles').select('id,plate,make,model,color,photo_path,city_id').is('archived_at',null).eq('city_id',cityId).eq('plate',plate).limit(1).maybeSingle();
 if(result.error)throw result.error;
 const vehicle=result.data;
 if(vehicle)try{vehicle.photo_url=vehicle.photo_path?await resolvePhoto?.(vehicle.photo_path):''}catch{vehicle.photo_url=''}
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
 const parts=plateParts(vehicle.plate);setFormValue(form,'plate_numbers',parts.numbers);setFormValue(form,'plate_letters',parts.letters);
 setFormValue(form,'model',[vehicle.make,vehicle.model].filter(Boolean).join(' ').trim());
 setFormValue(form,'color',vehicle.color||'');setFormValue(form,'vehicle_id',vehicle.id);
 const selected=document.querySelector('#interestSelectedVehicle');if(selected){selected.hidden=false;selected.innerHTML='Veículo vinculado: <strong>'+esc(vehicle.plate)+'</strong> · '+esc([vehicle.make,vehicle.model].filter(Boolean).join(' '))+' <button type="button" class="button secondary small" data-interest-clear-vehicle>Desvincular</button>'}
}
function beginEdit(row){
 const entry=document.querySelector('#interestEntry'),form=document.querySelector('#interestForm');if(!row||!entry||!form)return;
 entry.hidden=false;editingId=String(row.id);selectedVehicle=row.vehicle_id?{id:row.vehicle_id,plate:fullPlate(row.plate_numbers,row.plate_letters),make:'',model:row.model,color:row.color}:null;
 setFormValue(form,'incident_type',row.incident_type);setFormValue(form,'plate_numbers',row.plate_numbers);setFormValue(form,'plate_letters',row.plate_letters);
 setFormValue(form,'model',row.model);setFormValue(form,'year',row.year);setFormValue(form,'color',row.color);setFormValue(form,'plate_city',row.plate_city);setFormValue(form,'occurrence_location',row.occurrence_location);setFormValue(form,'vehicle_id',row.vehicle_id||'');
 const title=document.querySelector('#interestFormTitle');if(title)title.textContent='Editar veículo ativo';
 const submit=form.querySelector('[type=submit]');if(submit)submit.textContent='Salvar alterações';
 entry.scrollIntoView({behavior:'smooth',block:'start'})
}
function selectedRows(){return [...document.querySelectorAll('[data-interest-pdf-select]:checked')].map(input=>rowsById.get(String(input.dataset.interestPdfSelect))).filter(row=>row&&row.status==='active')}
async function shareActivePdf(client,cityName){
 const rows=await fetchRows(client,'active','',0,true);
 if(!rows.length){setFeedback('Não há veículos ativos para gerar o PDF.',true);return}
 const bytes=buildVehicleInterestPdf({rows,cityName,generatedAt:new Date()}),blob=new Blob([bytes],{type:'application/pdf'}),date=new Date().toISOString().slice(0,10),file=new File([blob],'veiculos-interesse-'+date+'.pdf',{type:'application/pdf'});
 if(navigator.share&&navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Veículos de interesse do serviço',text:'Tabela de veículos ativos'});setFeedback('PDF compartilhado.');return}catch(error){if(error?.name==='AbortError')return}}
 const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;anchor.style.display='none';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);setFeedback('PDF dos veículos ativos baixado para compartilhar.')
}
export function wireVehicleInterestActions(client,{cityId,cityName,userId,resolvePhoto,onRefresh}={}){
 const root=document.querySelector('#mainContent');if(!root)return;
 root.__vehicleInterestAbort?.abort?.();const controller=new AbortController();root.__vehicleInterestAbort=controller;const options={signal:controller.signal};
 root.addEventListener('click',async event=>{
  const target=event.target.closest?.('[data-interest-add],[data-interest-cancel],[data-interest-filter],[data-interest-search],[data-interest-page],[data-interest-edit],[data-interest-discharge],[data-interest-discharge-cancel],[data-interest-vehicle-search],[data-interest-plate-search],[data-interest-use-vehicle],[data-interest-clear-vehicle],[data-interest-share-pdf]');
  if(!target)return;
  try{
   if(target.hasAttribute('data-interest-add')){const entry=root.querySelector('#interestEntry');entry.hidden=false;entry.scrollIntoView({behavior:'smooth',block:'start'});return}
   if(target.hasAttribute('data-interest-cancel')){resetEntry();return}
   if(target.hasAttribute('data-interest-filter')){currentFilter=target.dataset.interestFilter;currentOffset=0;await onRefresh();return}
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
    try{const result=await lookupPlate(client,{numbers:formValue(form,'plate_numbers'),letters:formValue(form,'plate_letters'),cityId,resolvePhoto});if(result.vehicle){showVehicleResults([result.vehicle]);setFeedback('Veículo correspondente localizado na frota.');}else{clearVehicleSelection();showVehicleResults([],'Não encontramos essa placa na frota desta cidade. Confira os caracteres ou continue com o registro manual.')} }finally{lookupBusy=false;target.disabled=false}return
   }
   if(target.hasAttribute('data-interest-use-vehicle')){const vehicle=vehicleMatches.find(item=>String(item.id)===String(target.dataset.interestUseVehicle))||vehicleMatches[0];if(vehicle){useVehicle(vehicle);setFeedback('Cadastro do veículo vinculado.');}return}
   if(target.hasAttribute('data-interest-clear-vehicle')){clearVehicleSelection();setFormValue(root.querySelector('#interestForm'),'vehicle_id','');return}
   if(target.hasAttribute('data-interest-share-pdf')){if(operationBusy)return;operationBusy=true;target.disabled=true;await shareActivePdf(client,cityName);operationBusy=false;target.disabled=false;return}
  }catch(error){operationBusy=false;setFeedback(error?.message||'Não foi possível concluir a operação. Verifique sua conexão e tente novamente.',true);if(target)target.disabled=false}
 },options);
 root.addEventListener('submit',async event=>{
  const form=event.target;
  if(form?.id==='interestForm'){
   event.preventDefault();if(operationBusy)return;operationBusy=true;
   const submit=form.querySelector('[type=submit]');if(submit){submit.disabled=true;submit.textContent='Salvando…'}
   try{
    const payload={plate_numbers:normalizePart(formValue(form,'plate_numbers')),plate_letters:String(formValue(form,'plate_letters')).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,3),model:formValue(form,'model'),year:formValue(form,'year'),color:formValue(form,'color'),incident_type:formValue(form,'incident_type'),plate_city:formValue(form,'plate_city'),occurrence_location:formValue(form,'occurrence_location'),vehicle_id:formValue(form,'vehicle_id')||null};
    if(!payload.plate_numbers||!payload.plate_letters||!payload.incident_type)throw new Error('Informe os quatro caracteres da primeira parte da placa, os três da segunda parte e o tipo da ocorrência.');
    if(editingId){const result=await client.from(TABLE).update(payload).eq('id',editingId).select('id').maybeSingle();if(result.error)throw result.error;if(!result.data)throw new Error('Não foi possível confirmar a alteração. Atualize a lista e tente novamente.');setFeedback('Veículo atualizado.')}
    else{const result=await client.from(TABLE).insert({...payload,city_id:cityId,created_by:userId}).select('id').single();if(result.error)throw result.error;setFeedback('Veículo adicionado à lista.')}
    resetEntry();currentFilter='active';currentOffset=0;await onRefresh()
   }catch(error){setFeedback(error?.message||'Não foi possível salvar. Tente novamente.',true)}finally{operationBusy=false;if(submit){submit.disabled=false;submit.textContent=editingId?'Salvar alterações':'Salvar veículo de interesse'}}
   return
  }
  if(form?.matches('[data-interest-discharge-form]')){
   event.preventDefault();if(operationBusy)return;const id=form.dataset.interestDischargeForm,reason=String(new FormData(form).get('reason')||'').trim();if(!reason){setFeedback('Informe o motivo da baixa.',true);return}
   if(!confirm('Baixar este veículo da lista ativa? O registro será preservado com o motivo informado.'))return;
   operationBusy=true;const button=form.querySelector('[type=submit]');if(button){button.disabled=true;button.textContent='Baixando…'}
   try{const result=await client.from(TABLE).update({status:'baixado',closed_reason:reason}).eq('id',id).select('id').maybeSingle();if(result.error)throw result.error;if(!result.data)throw new Error('Não foi possível concluir a baixa. Atualize a lista e tente novamente.');setFeedback('Veículo baixado e preservado com o motivo.');await onRefresh()}
   catch(error){setFeedback(error?.message||'Não foi possível baixar o veículo.',true)}finally{operationBusy=false}
  }
 },options);
 const search=root.querySelector('#interestVehicleQuery');search?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();root.querySelector('[data-interest-vehicle-search]')?.click()}},options);
 const plateSearchForm=root.querySelector('#interestForm');plateSearchForm?.querySelectorAll('[name=plate_numbers],[name=plate_letters]').forEach(input=>input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();root.querySelector('[data-interest-plate-search]')?.click()}},options));
 root.querySelector('#interestSearch')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();root.querySelector('[data-interest-search]')?.click()}},options);
}
