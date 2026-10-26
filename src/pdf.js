const ascii=value=>new TextEncoder().encode(value);
function joinBytes(parts){const length=parts.reduce((sum,part)=>sum+part.length,0),joined=new Uint8Array(length);let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.length}return joined}
const cp1252=new Map([[0x20ac,0x80],[0x201a,0x82],[0x0192,0x83],[0x201e,0x84],[0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x02c6,0x88],[0x2030,0x89],[0x0160,0x8a],[0x2039,0x8b],[0x0152,0x8c],[0x017d,0x8e],[0x2018,0x91],[0x2019,0x92],[0x201c,0x93],[0x201d,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],[0x02dc,0x98],[0x2122,0x99],[0x0161,0x9a],[0x203a,0x9b],[0x0153,0x9c],[0x017e,0x9e],[0x0178,0x9f]]);
function textHex(value){return [...String(value??'').normalize('NFC')].map(char=>{const point=char.codePointAt(0),byte=point<=255?point:(cp1252.get(point)??63);return byte.toString(16).padStart(2,'0')}).join('').toUpperCase()}
function wrap(value,max=75){const paragraphs=String(value??'').replace(/\r/g,'').split('\n'),lines=[];for(const paragraph of paragraphs){const words=paragraph.trim().split(/\s+/);let line='';for(let word of words){if(!word)continue;while(word.length>max){if(line){lines.push(line);line=''}lines.push(word.slice(0,max));word=word.slice(max)}if(!line)line=word;else if((line+' '+word).length<=max)line+=' '+word;else{lines.push(line);line=word}}if(line){lines.push(line);line=''}if(!paragraph.trim())lines.push('')}return lines.length?lines:['Não informado']}
function drawText(text,x,y,size=12,color='0.16 0.19 0.21'){return 'BT /F1 '+size+' Tf '+color+' rg 1 0 0 1 '+x.toFixed(2)+' '+y.toFixed(2)+' Tm <'+textHex(text)+'> Tj ET\n'}
function imageObject(data){const header=ascii('<< /Type /XObject /Subtype /Image /Width '+data.width+' /Height '+data.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+data.bytes.length+' >>\nstream\n');return joinBytes([header,data.bytes,ascii('\nendstream')])}
function streamObject(stream){return ascii('<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream')}
function samePhotoBytes(a,b){if(a.width!==b.width||a.height!==b.height||a.bytes?.length!==b.bytes?.length)return false;for(let index=0;index<(a.bytes?.length||0);index++)if(a.bytes[index]!==b.bytes[index])return false;return true}
function photoByteHash(photo){let hash=2166136261;for(const byte of photo.bytes||[])hash=Math.imul(hash^byte,16777619);return String(photo.dedupe_group||'record')+':'+(photo.width||0)+'x'+(photo.height||0)+':'+(photo.bytes?.length||0)+':'+(hash>>>0)}
export function buildRecordPdf({title,recordName='',sections=[],photos=[],generatedAt=new Date()}){
 const sortedPhotos=[...photos].sort((a,b)=>Number(Boolean(b.is_cover))-Number(Boolean(a.is_cover))),photoBuckets=new Map(),uniquePhotos=[];for(const photo of sortedPhotos){const key=photoByteHash(photo),bucket=photoBuckets.get(key)||[];if(bucket.some(existing=>samePhotoBytes(existing,photo)))continue;bucket.push(photo);photoBuckets.set(key,bucket);uniquePhotos.push(photo)}photos=uniquePhotos;
 const pages=[],pageWidth=595,pageHeight=842,margin=34,contentWidth=pageWidth-margin*2,bottom=margin+18;
 const cover=photos.find(photo=>photo.is_cover||photo.label==='Foto de capa')||(photos.some(photo=>photo.association_photo)?null:photos[0])||null;
 const remaining=cover?photos.filter(photo=>photo!==cover):[];
 let current=null,y=0;
 const startPage=(first=false,heading='')=>{
  current={commands:'',images:[]};pages.push(current);
  current.commands+='0.24 0.29 0.31 rg '+margin+' 812 '+contentWidth+' 2 re f\n';
  current.commands+=drawText('CADASTRO CRIMINAL',margin,824,9,'0.31 0.35 0.37');
  if(first){
   y=790;
   const titleLines=wrap(title,60);
   for(const line of titleLines.slice(0,3)){current.commands+=drawText(line,margin,y,19,'0.11 0.15 0.17');y-=23}
   if(recordName){const nameLines=wrap(recordName,68);for(const line of nameLines.slice(0,2)){current.commands+=drawText(line,margin,y,16,'0.16 0.19 0.21');y-=20}}
   current.commands+=drawText('Gerado em '+new Date(generatedAt).toLocaleString('pt-BR'),margin,y-1,9.5,'0.38 0.42 0.44');
   y-=18;
  }else{
   current.commands+=drawText(heading||'Continuação da ficha',margin,790,15,'0.20 0.25 0.27');
   y=766;
  }
  current.commands+='0.82 0.84 0.85 RG 0.6 w '+margin+' '+(y-5).toFixed(2)+' m '+(pageWidth-margin)+' '+(y-5).toFixed(2)+' l S\n';
  y-=22;
  return current
 };
 const nextInfoPage=heading=>{startPage(false,heading)};
 const sectionHeading=(name)=>{current.commands+=drawText(name,margin,y,15,'0.24 0.29 0.31');y-=7;current.commands+='0.82 0.84 0.85 RG 0.5 w '+margin+' '+y.toFixed(2)+' m '+(pageWidth-margin)+' '+y.toFixed(2)+' l S\n';y-=17};
 let coverPlaced=false;
 const placeCover=()=>{
  if(!cover||coverPlaced)return;
  const widthLimit=contentWidth*.76,heightLimit=220,scale=Math.min(widthLimit/cover.width,heightLimit/cover.height);
  const width=cover.width*scale,height=cover.height*scale,x=(pageWidth-width)/2;
  if(y-height-18<bottom)nextInfoPage('Foto de capa');
  const top=y-4,imageY=top-height,name='Im'+(current.images.length+1);
  current.commands+='0.86 0.88 0.89 RG 0.6 w '+x.toFixed(2)+' '+imageY.toFixed(2)+' '+width.toFixed(2)+' '+height.toFixed(2)+' re S\n';
  current.images.push({name,photo:cover});
  current.commands+='q '+width.toFixed(2)+' 0 0 '+height.toFixed(2)+' '+x.toFixed(2)+' '+imageY.toFixed(2)+' cm /'+name+' Do Q\n';
  y=imageY-18;coverPlaced=true
 };
 startPage(true);
 for(const section of sections){
  const sectionTitle=section.title||'Informações';
  if(y<bottom+45)nextInfoPage(sectionTitle);
  sectionHeading(sectionTitle);
  if(!coverPlaced)placeCover();
  for(const row of section.rows||[]){
   const labelLines=wrap(row.label||'',72),valueLines=wrap(row.value,76);
   const labelStep=13,valueStep=17;
   const firstPart=labelLines.length*labelStep+4+valueStep;
   if(y-firstPart<bottom){nextInfoPage(sectionTitle+' (continuação)');sectionHeading(sectionTitle+' (continuação)')}
   for(const line of labelLines){if(y-labelStep<bottom){nextInfoPage(sectionTitle+' (continuação)');sectionHeading(sectionTitle+' (continuação)')}current.commands+=drawText(line,margin,y,10.5,'0.30 0.34 0.36');y-=labelStep}
   y-=2;
   for(const line of valueLines){if(y-valueStep<bottom){nextInfoPage(sectionTitle+' (continuação)');sectionHeading(sectionTitle+' (continuação)')}current.commands+=drawText(line,margin,y,13,'0.12 0.15 0.16');y-=valueStep}
   y-=6;
   if(y>bottom){current.commands+='0.91 0.92 0.93 RG 0.35 w '+margin+' '+(y+2).toFixed(2)+' m '+(pageWidth-margin)+' '+(y+2).toFixed(2)+' l S\n';y-=4}
  }
 }
 if(cover&&!coverPlaced){sectionHeading(sections[0]?.title||'Identificação e informações');placeCover()}
 if(remaining.length){
  let offset=0;
  const startPhotoPage=()=>{startPage(false,'Outras fotografias');current.commands+=drawText('Fotografias complementares',margin,y,15,'0.24 0.29 0.31');y-=30};
  startPhotoPage();
  const columns=2,gap=14,cellWidth=(contentWidth-gap)/columns,boxHeight=190,rowHeight=220;
  while(offset<remaining.length){
   if(y-rowHeight<bottom){startPhotoPage()}
   for(let slot=0;slot<columns&&offset<remaining.length;slot++,offset++){
    const photo=remaining[offset],x=margin+slot*(cellWidth+gap),maxWidth=cellWidth-12,maxHeight=boxHeight,scale=Math.min(maxWidth/photo.width,maxHeight/photo.height),width=photo.width*scale,height=photo.height*scale,dx=x+(cellWidth-width)/2,top=y-4,dy=top-height,name='Im'+(current.images.length+1);
    current.commands+='0.88 0.89 0.90 RG 0.5 w '+x.toFixed(2)+' '+(top-boxHeight).toFixed(2)+' '+cellWidth.toFixed(2)+' '+boxHeight+' re S\n';
    current.images.push({name,photo});current.commands+='q '+width.toFixed(2)+' 0 0 '+height.toFixed(2)+' '+dx.toFixed(2)+' '+dy.toFixed(2)+' cm /'+name+' Do Q\n';
    const caption=wrap(photo.label||'Fotografia '+(offset+2),35)[0];current.commands+=drawText(caption,x+5,top-boxHeight-15,10,'0.30 0.34 0.36')
   }
   y-=rowHeight
  }
 }
 for(let index=0;index<pages.length;index++)pages[index].commands+=drawText('Página '+(index+1)+' de '+pages.length, pageWidth-margin-70,18,8,'0.45 0.48 0.50');
 const objects=[];objects[1]=ascii('<< /Type /Catalog /Pages 2 0 R >>');objects[3]=ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');const pageIds=[];objects[2]=null;
 for(let index=0;index<pages.length;index++){const page=pages[index],pageId=objects.length;pageIds.push(pageId);objects.push(null);const imageRefs=page.images.map(item=>({name:item.name,id:objects.length,photo:item.photo}));for(const image of imageRefs)objects.push(imageObject(image.photo));const contentId=objects.length;objects.push(streamObject(page.commands));const xobjects=imageRefs.length?'/XObject << '+imageRefs.map(image=>'/'+image.name+' '+image.id+' 0 R').join(' ')+' >>':'';objects[pageId]=ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+pageWidth+' '+pageHeight+'] /Resources << /Font << /F1 3 0 R >> '+xobjects+' >> /Contents '+contentId+' 0 R >>')}
 objects[2]=ascii('<< /Type /Pages /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] /Count '+pageIds.length+' >>');const parts=[ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')],offsets=[0];let offset=parts[0].length;
 for(let id=1;id<objects.length;id++){const obj=joinBytes([ascii(id+' 0 obj\n'),objects[id],ascii('\nendobj\n')]);offsets[id]=offset;parts.push(obj);offset+=obj.length}
 const xrefOffset=offset;let xref='xref\n0 '+objects.length+'\n0000000000 65535 f \n';for(let id=1;id<objects.length;id++)xref+=String(offsets[id]).padStart(10,'0')+' 00000 n \n';parts.push(ascii(xref+'trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xrefOffset+'\n%%EOF'));
 const result=joinBytes(parts),decoder=new TextDecoder('windows-1252');
 result.previewPages=pages.map(page=>{const texts=[...page.commands.matchAll(/BT \/F1 ([\d.]+) Tf ([\d.]+ [\d.]+ [\d.]+) rg 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm <([0-9A-F]*)> Tj ET/g)].map(match=>({size:Number(match[1]),color:match[2].split(' ').map(Number),x:Number(match[3]),y:Number(match[4]),text:decoder.decode(Uint8Array.from(match[5].match(/.{2}/g)||[],pair=>parseInt(pair,16)))}));const images=[...page.commands.matchAll(/q ([\d.]+) 0 0 ([\d.]+) ([\d.-]+) ([\d.-]+) cm \/(Im\d+) Do Q/g)].map(match=>({width:Number(match[1]),height:Number(match[2]),x:Number(match[3]),y:Number(match[4]),photo:page.images.find(image=>image.name===match[5])?.photo})).filter(image=>image.photo);return{texts,images}});
 return result
}