const ascii=value=>new TextEncoder().encode(value);
function joinBytes(parts){const length=parts.reduce((sum,part)=>sum+part.length,0),joined=new Uint8Array(length);let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.length}return joined}
const winAnsi=new Map([[0x20ac,0x80],[0x201a,0x82],[0x0192,0x83],[0x201e,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x02c6,0x88],[0x2030,0x89],[0x0160,0x8a],[0x2039,0x8b],[0x0152,0x8c],[0x017d,0x8e],[0x2018,0x91],[0x2019,0x92],[0x201c,0x93],[0x201d,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02dc,0x98],[0x2122,0x99],[0x0161,0x9a],[0x203a,0x9b],[0x0153,0x9c],[0x017e,0x9e],[0x0178,0x9f]]);
function hex(value){return [...String(value??'').normalize('NFC')].map(char=>{const point=char.codePointAt(0),byte=point<=255?point:(winAnsi.get(point)??63);return byte.toString(16).padStart(2,'0')}).join('').toUpperCase()}
function text(value,x,y,size=8,color='0.12 0.15 0.17'){return 'BT /F1 '+size+' Tf '+color+' rg 1 0 0 1 '+x.toFixed(2)+' '+y.toFixed(2)+' Tm <'+hex(value)+'> Tj ET\n'}
function streamObject(stream){return ascii('<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream')}
function wrap(value,max){const words=String(value??'').trim().split(/\s+/),lines=[];let line='';for(let word of words){if(!word)continue;while(word.length>max){if(line){lines.push(line);line=''}lines.push(word.slice(0,max));word=word.slice(max)}if(!line)line=word;else if((line+' '+word).length<=max)line+=' '+word;else{lines.push(line);line=word}}if(line)lines.push(line);return lines.length?lines:['—']}
const TYPE_LABEL={furto:'F',roubo:'R',outra:'O'};
const baseColumns=[
 {key:'plate_numbers',label:'NÚMEROS',width:49},
 {key:'plate_letters',label:'LETRAS',width:42},
 {key:'model',label:'MODELO',width:89},
 {key:'year',label:'ANO',width:38},
 {key:'color',label:'COR',width:50},
 {key:'incident_type',label:'F/R',width:34},
 {key:'plate_city',label:'CIDADE DA PLACA',width:110},
 {key:'occurrence_location',label:'LOCAL DA OCORRÊNCIA',width:115}
];
const tableWidth=baseColumns.reduce((sum,column)=>sum+column.width,0);
function pdfPages(rows,cityName,generatedAt,plateFormat='normal'){
 const columns=plateFormat==='inverted'?baseColumns:[{...baseColumns[1],key:'plate_letters',label:'LETRAS'},{...baseColumns[0],key:'plate_numbers',label:'NÚMEROS'},...baseColumns.slice(2)];
 const chunks=[],input=rows.length?rows:[{plate_numbers:'—',plate_letters:'—',model:'Nenhum veículo ativo',year:'',color:'',incident_type:'',plate_city:'',occurrence_location:''}];
 let current=[],cursor=0;
 while(cursor<input.length){const pageRows=[];let top=744;const headerHeight=28;top-=headerHeight;let y=top;
  while(cursor<input.length){const row=input[cursor],cells=columns.map(column=>(column.key==='incident_type'?TYPE_LABEL[row.incident_type]||'':row[column.key]||'—').toLocaleUpperCase('pt-BR')),wrapped=cells.map((value,index)=>wrap(value,Math.max(4,Math.floor((columns[index].width-8)/4.1)))),lineCount=Math.max(1,...wrapped.map(lines=>lines.length)),height=Math.max(22,Math.min(70,lineCount*8.5+7));if(y-height<430&&pageRows.length)break;
   pageRows.push({wrapped,height});y-=height;cursor++
  }
  chunks.push(pageRows)
 }
 return chunks.map((pageRows,pageIndex)=>{let commands='';const left=(595-tableWidth)/2;
  commands+='0.23 0.28 0.31 rg 34 807 527 3 re f\n';
  commands+=text('CADASTRO CRIMINAL · VEÍCULOS DE INTERESSE',left,789,14,'0.12 0.15 0.17');
  commands+=text((cityName||'Cidade não informada').toLocaleUpperCase('pt-BR')+' · '+new Date(generatedAt).toLocaleDateString('pt-BR'),left,770,8.5,'0.35 0.39 0.41');
  commands+=text('ATIVOS · FURTO (F), ROUBO (R) E OUTRAS OCORRÊNCIAS (O)',left,755,8,'0.25 0.29 0.31');
  let x=left,y=744;
  for(let i=0;i<columns.length;i++){const col=columns[i];commands+='0.24 0.29 0.31 rg '+x.toFixed(2)+' '+(y-28).toFixed(2)+' '+col.width+' 28 re f\n';const lines=wrap(col.label,Math.max(5,Math.floor((col.width-8)/4.1)));lines.forEach((line,index)=>{commands+=text(line,x+4,y-11-index*8,7.2,'1 1 1')});commands+='0.68 0.71 0.73 RG 0.6 w '+x.toFixed(2)+' '+(y-28).toFixed(2)+' '+col.width+' 28 re S\n';x+=col.width}
  y-=28;
  for(let rowIndex=0;rowIndex<pageRows.length;rowIndex++){const row=pageRows[rowIndex];x=left;if(rowIndex%2===1)commands+='0.94 0.95 0.95 rg '+left.toFixed(2)+' '+(y-row.height).toFixed(2)+' '+tableWidth+' '+row.height.toFixed(2)+' re f\n';
   for(let columnIndex=0;columnIndex<columns.length;columnIndex++){const col=columns[columnIndex],lines=row.wrapped[columnIndex],lineHeight=8.5,firstY=y-8;lines.forEach((line,lineIndex)=>{commands+=text(line,x+4,firstY-lineIndex*lineHeight,7.7,'0.11 0.14 0.16')});commands+='0.68 0.71 0.73 RG 0.55 w '+x.toFixed(2)+' '+(y-row.height).toFixed(2)+' '+col.width+' '+row.height.toFixed(2)+' re S\n';x+=col.width}
   y-=row.height
  }
  commands+=text('Página '+(pageIndex+1)+' de '+chunks.length,left,415,8,'0.42 0.45 0.47');
  return commands
 })
}
export function buildVehicleInterestPdf({rows=[],cityName='',generatedAt=new Date(),plateFormat='normal'}={}){
 const pages=pdfPages(rows,cityName,generatedAt,plateFormat),objects=[];objects[1]=ascii('<< /Type /Catalog /Pages 2 0 R >>');objects[2]=null;objects[3]=ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
 const pageIds=[];
 for(const commands of pages){const pageId=objects.length;pageIds.push(pageId);objects.push(null);const contentId=objects.length;objects.push(streamObject(commands));objects[pageId]=ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents '+contentId+' 0 R >>')}
 objects[2]=ascii('<< /Type /Pages /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] /Count '+pageIds.length+' >>');
 const parts=[ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')],offsets=[0];let offset=parts[0].length;
 for(let id=1;id<objects.length;id++){const object=joinBytes([ascii(id+' 0 obj\n'),objects[id],ascii('\nendobj\n')]);offsets[id]=offset;parts.push(object);offset+=object.length}
 const xrefOffset=offset;let xref='xref\n0 '+objects.length+'\n0000000000 65535 f \n';for(let id=1;id<objects.length;id++)xref+=String(offsets[id]).padStart(10,'0')+' 00000 n \n';parts.push(ascii(xref+'trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xrefOffset+'\n%%EOF'));
 return joinBytes(parts)
}
