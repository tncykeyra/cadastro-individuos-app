const ascii=value=>new TextEncoder().encode(value);
function joinBytes(parts){const length=parts.reduce((sum,part)=>sum+part.length,0),joined=new Uint8Array(length);let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.length}return joined}
const winAnsi=new Map([[0x20ac,0x80],[0x201a,0x82],[0x0192,0x83],[0x201e,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x02c6,0x88],[0x2030,0x89],[0x0160,0x8a],[0x2039,0x8b],[0x0152,0x8c],[0x017d,0x8e],[0x2018,0x91],[0x2019,0x92],[0x201c,0x93],[0x201d,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02dc,0x98],[0x2122,0x99],[0x0161,0x9a],[0x203a,0x9b],[0x0153,0x9c],[0x017e,0x9e],[0x0178,0x9f]]);
function hex(value){return [...String(value??'').normalize('NFC')].map(char=>{const point=char.codePointAt(0),byte=point<=255?point:(winAnsi.get(point)??63);return byte.toString(16).padStart(2,'0')}).join('').toUpperCase()}
function text(value,x,y,size=8,color='0.12 0.15 0.17'){return 'BT /F1 '+size+' Tf '+color+' rg 1 0 0 1 '+x.toFixed(2)+' '+y.toFixed(2)+' Tm <'+hex(value)+'> Tj ET\n'}
function streamObject(stream){return ascii('<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream')}
function wrap(value,max){const words=String(value??'').trim().split(/\s+/),lines=[];let line='';for(let word of words){if(!word)continue;while(word.length>max){if(line){lines.push(line);line=''}lines.push(word.slice(0,max));word=word.slice(max)}if(!line)line=word;else if((line+' '+word).length<=max)line+=' '+word;else{lines.push(line);line=word}}if(line)lines.push(line);return lines.length?lines:['—']}
const TYPE_LABEL={furto:'FURTO',roubo:'ROUBO',outra:'OUTRA'};
const PAGE_WIDTH=283.46, PAGE_HEIGHT=396.85, MARGIN=12, CONTENT_WIDTH=PAGE_WIDTH-MARGIN*2, BOTTOM=14;
function plateValue(row,plateFormat){const letters=String(row.plate_letters||'').toLocaleUpperCase('pt-BR'),numbers=String(row.plate_numbers||'').toLocaleUpperCase('pt-BR');return plateFormat==='inverted'?[numbers,letters].filter(Boolean).join(' '):letters+numbers}
const TYPE_SHORT={furto:'F',roubo:'R',outra:'O'};
const PLATE_COLUMN=MARGIN+90,DETAILS_X=PLATE_COLUMN+6,DETAILS_WIDTH=PAGE_WIDTH-MARGIN-DETAILS_X;
function helveticaWidthUnits(value){
 return [...String(value??'')].reduce((sum,char)=>{
  if(char===' ')return sum+0.278;
  if(/[MW]/.test(char))return sum+0.833;
  if(/[il!.,:;|'’]/.test(char))return sum+0.278;
  if(/[0-9]/.test(char))return sum+0.556;
  if(/[-–/]/.test(char))return sum+0.333;
  if(/[mw]/.test(char))return sum+0.778;
  const upper=char.toLocaleUpperCase('pt-BR');
  if(/[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(upper))return sum+0.667;
  return sum+0.5
 },0)
}
function plateFontSize(value){
 const available=PLATE_COLUMN-(MARGIN+5)-7;
 return Math.max(7,Math.min(20,available/Math.max(helveticaWidthUnits(value),0.5)))
}
function fittedDetailLines(value){
 const baseSize=6.5,minimumSize=5.4,units=helveticaWidthUnits(value);
 const fittingSize=units?Math.min(baseSize,DETAILS_WIDTH/units):baseSize;
 if(fittingSize>=minimumSize)return [{text:value,size:fittingSize}];
 const maxChars=Math.max(12,Math.floor(DETAILS_WIDTH/(minimumSize*0.7)));
 return wrap(value,maxChars).map(line=>({text:line,size:minimumSize}))
}
function prepareCard(row,plateFormat){
 const modelBits=[row.model,row.year?'ANO '+row.year:'',row.color?'COR '+row.color:''].filter(Boolean).join(' · ').toLocaleUpperCase('pt-BR');
 const facts=['F/R: '+(TYPE_SHORT[row.incident_type]||'O'),'CIDADE: '+(row.plate_city||'—').toLocaleUpperCase('pt-BR'),'LOCAL: '+(row.occurrence_location||'—').toLocaleUpperCase('pt-BR')].join(' · ');
 return {plate:plateValue(row,plateFormat)||'PLACA NÃO INFORMADA',details:[modelBits||'MODELO NÃO INFORMADO',facts]}
}
function cardHeight(card){const lines=card.details.flatMap(fittedDetailLines);return Math.max(24.5,8+lines.length*7)}
function pdfPages(rows,cityName,generatedAt,plateFormat='normal'){
 const input=rows.length?rows:[{plate_numbers:'—',plate_letters:'—',model:'NENHUM VEÍCULO ATIVO',year:'',color:'',incident_type:'outra',plate_city:'',occurrence_location:''}];
 const cards=input.map(row=>prepareCard(row,plateFormat)),headerBottom=PAGE_HEIGHT-52,tableHeaderHeight=16,tableStart=headerBottom-tableHeaderHeight;
 const pages=[];let page=[],used=0,available=tableStart-tableHeaderHeight-BOTTOM;
 for(const card of cards){const height=cardHeight(card);if(page.length&&used+height>available){pages.push(page);page=[];used=0}page.push(card);used+=height}
 if(page.length)pages.push(page);
 return pages.map((pageCards,pageIndex)=>{let commands='';commands+='0.23 0.28 0.31 rg 0 '+(PAGE_HEIGHT-4).toFixed(2)+' '+PAGE_WIDTH+' 4 re f\n';
  commands+=text('VEÍCULOS DE INTERESSE',MARGIN,PAGE_HEIGHT-20,11,'0.10 0.13 0.15');
  commands+=text((cityName||'CIDADE NÃO INFORMADA').toLocaleUpperCase('pt-BR'),MARGIN,PAGE_HEIGHT-33,8,'0.30 0.34 0.36');
  commands+=text(new Date(generatedAt).toLocaleDateString('pt-BR')+' · F FURTO  /  R ROUBO  /  O OUTRA',MARGIN,PAGE_HEIGHT-44,6.5,'0.34 0.38 0.40');
  commands+='0.23 0.28 0.31 rg '+MARGIN.toFixed(2)+' '+(tableStart-tableHeaderHeight).toFixed(2)+' '+CONTENT_WIDTH.toFixed(2)+' '+tableHeaderHeight.toFixed(2)+' re f\n';
  const plateColumn=PLATE_COLUMN,detailsX=DETAILS_X;
  commands+=text('PLACA',MARGIN+5,tableStart-11,6.5,'1 1 1');
  commands+=text('MODELO · ANO · COR · F/R · CIDADE/LOCAL',detailsX,tableStart-11,6.5,'1 1 1');
  let y=tableStart-tableHeaderHeight;
  for(const card of pageCards){const height=cardHeight(card),top=y,bottom=top-height;
   commands+='0.69 0.72 0.74 RG 0.6 w '+MARGIN.toFixed(2)+' '+bottom.toFixed(2)+' '+CONTENT_WIDTH.toFixed(2)+' '+height.toFixed(2)+' re S\n';
   commands+='0.69 0.72 0.74 RG 0.5 w '+plateColumn.toFixed(2)+' '+bottom.toFixed(2)+' m '+plateColumn.toFixed(2)+' '+top.toFixed(2)+' l S\n';
   commands+=text(card.plate,MARGIN+5,top-(height/2)-6,plateFontSize(card.plate),'0.08 0.10 0.11');
   let lineY=top-8;
   for(const line of card.details.flatMap(fittedDetailLines)){commands+=text(line.text,detailsX,lineY,line.size,'0.14 0.17 0.19');lineY-=7}
   y-=height
  }
  commands+=text(String(pageIndex+1)+'/'+String(pages.length),PAGE_WIDTH-MARGIN-18,BOTTOM/2,6,'0.42 0.45 0.47');
  return commands
})
}
export function buildVehicleInterestPdf({rows=[],cityName='',generatedAt=new Date(),plateFormat='normal'}={}){
 const pages=pdfPages(rows,cityName,generatedAt,plateFormat),objects=[];objects[1]=ascii('<< /Type /Catalog /Pages 2 0 R >>');objects[2]=null;objects[3]=ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
 const pageIds=[];
 for(const commands of pages){const pageId=objects.length;pageIds.push(pageId);objects.push(null);const contentId=objects.length;objects.push(streamObject(commands));objects[pageId]=ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+PAGE_WIDTH+' '+PAGE_HEIGHT+'] /Resources << /Font << /F1 3 0 R >> >> /Contents '+contentId+' 0 R >>')}
 objects[2]=ascii('<< /Type /Pages /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] /Count '+pageIds.length+' >>');
 const parts=[ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')],offsets=[0];let offset=parts[0].length;
 for(let id=1;id<objects.length;id++){const object=joinBytes([ascii(id+' 0 obj\n'),objects[id],ascii('\nendobj\n')]);offsets[id]=offset;parts.push(object);offset+=object.length}
 const xrefOffset=offset;let xref='xref\n0 '+objects.length+'\n0000000000 65535 f \n';for(let id=1;id<objects.length;id++)xref+=String(offsets[id]).padStart(10,'0')+' 00000 n \n';parts.push(ascii(xref+'trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xrefOffset+'\n%%EOF'));
 return joinBytes(parts)
}
