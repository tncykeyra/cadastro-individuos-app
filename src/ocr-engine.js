import { createWorker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
let workerPromise = null;
let activeWorker = null;
let progressCallback = () => {};

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('por+eng', 1, {
      cacheMethod: 'write',
      logger: message => {
        const phases = { 'loading tesseract core': 'Carregando o mecanismo OCR no aparelho…', 'initializing tesseract': 'Inicializando o mecanismo OCR…', 'loading language traineddata': 'Carregando os idiomas português e inglês…', 'initializing api': 'Preparando o leitor local…', 'recognizing text': 'Reconhecendo texto…' };
        const status = phases[message?.status];
        if (status) progressCallback(Math.round((message.progress || 0) * 100), status);
      }
    }).then(worker => { activeWorker = worker; return worker; }).catch(error => { workerPromise = null; throw error; });
  }
  return workerPromise;
}
export async function cancelOcrWorker() {
  const worker = activeWorker;
  activeWorker = null; workerPromise = null; progressCallback = () => {};
  if (worker) await worker.terminate();
}

function canvasBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível preparar a página do PDF.')), type));
}

async function imageQualityWarnings(blob) {
  const warnings = [];
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0, laplacian = 0, samples = 0;
    const luminance = (x, y) => {
      const index = (y * canvas.width + x) * 4;
      return pixels[index] * .299 + pixels[index + 1] * .587 + pixels[index + 2] * .114;
    };
    for (let y = 1; y < canvas.height - 1; y += 2) for (let x = 1; x < canvas.width - 1; x += 2) {
      const center = luminance(x, y), value = Math.abs(4 * center - luminance(x - 1, y) - luminance(x + 1, y) - luminance(x, y - 1) - luminance(x, y + 1));
      total += center; laplacian += value; samples++;
    }
    if (samples && total / samples < 45) warnings.push('Iluminação baixa; considere fotografar novamente.');
    if (samples && laplacian / samples < 8) warnings.push('A imagem pode estar desfocada; confira se os textos estão nítidos.');
  } catch { /* o aviso de qualidade nunca impede a leitura */ }
  return warnings;
}

function flattenOcrLines(blocks) {
  const lines = [];
  for (const block of blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) {
    if (line?.text && line?.bbox) lines.push({ text: String(line.text), bbox: line.bbox });
  }
  return lines;
}

function regionalTargets(blocks) {
  const patterns = [
    ['name', /\b(?:NOME DO CONDUTOR|NOME COMPLETO|NOME E SOBRENOME|NOME)\b/],
    ['cpf', /\bCPF\b/],
    ['rg', /\b(?:RG|IDENTIDADE|DOC\.?\s*IDENTIDADE)\b/],
    ['birth', /\b(?:DATA DE NASCIMENTO|NASCIMENTO|NASC\.?)\b/],
    ['filiation', /\b(?:FILIA[CÇ][AÃ]O|NOME DA M[AÃ]E)\b/]
  ];
  const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const found = new Map();
  for (const line of flattenOcrLines(blocks)) {
    const text = normalized(line.text);
    for (const [key, pattern] of patterns) if (!found.has(key) && pattern.test(text)) found.set(key, line.bbox);
  }
  return [...found.entries()];
}

async function enhancedContrastVariant(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
    if (Math.max(bitmap.width, bitmap.height) > 2600) return null;
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = image.data;
    for (let index = 0; index < pixels.length; index += 4) {
      const gray = pixels[index] * .299 + pixels[index + 1] * .587 + pixels[index + 2] * .114;
      const adjusted = Math.max(0, Math.min(255, (gray - 128) * 1.12 + 132));
      pixels[index] = pixels[index + 1] = pixels[index + 2] = adjusted;
    }
    context.putImageData(image, 0, 0);
    const enhanced = await canvasBlob(canvas, 'image/png');
    canvas.width = 0; canvas.height = 0;
    return enhanced;
  } catch { return null; }
  finally { bitmap?.close?.(); }
}

async function readOne(worker, blob, onProgress = () => {}, isCancelled = () => false) {
  const quality = await imageQualityWarnings(blob);
  let recognized = await worker.recognize(blob, { rotateAuto: true }, { text: true, blocks: true });
  let data = recognized.data;
  let sourceBlob = blob;
  if ((Number(data.confidence) || 0) < 62 && !isCancelled()) {
    onProgress('Fazendo uma segunda leitura local para melhorar a legibilidade…');
    const enhanced = await enhancedContrastVariant(blob);
    if (enhanced && !isCancelled()) {
      const alternate = await worker.recognize(enhanced, { rotateAuto: true }, { text: true, blocks: true });
      if ((Number(alternate.data.confidence) || 0) > (Number(data.confidence) || 0) + 1) {
        data = alternate.data;
        sourceBlob = enhanced;
      }
    }
  }
  const regional = [];
  if ((Number(data.confidence) || 0) < 86 && !isCancelled()) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(sourceBlob);
      const targets = regionalTargets(data.blocks).slice(0, 3);
      for (const [key, box] of targets) {
        if (isCancelled()) break;
        const height = Math.max(1, box.y1 - box.y0);
        const top = Math.max(0, Math.floor(box.y0 - height * .7));
        const bottom = Math.min(bitmap.height, Math.ceil(box.y1 + Math.max(height * 6, bitmap.height * .035)));
        const left = Math.max(0, Math.floor(box.x0 - bitmap.width * .01));
        const width = Math.max(1, bitmap.width - left);
        const regionHeight = Math.max(1, bottom - top);
        if (width < 80 || regionHeight < 24) continue;
        onProgress('Conferindo uma região do documento (' + key + ')…');
        const result = await worker.recognize(sourceBlob, {
          rotateAuto: true,
          rectangle: { left, top, width, height: regionHeight },
          tessedit_pageseg_mode: '6'
        }, { text: true });
        if (result.data?.text?.trim()) regional.push(result.data.text.trim());
      }
    } catch { /* releitura regional é complementar; a leitura geral continua disponível */ }
    finally { bitmap?.close?.(); }
  }
  const text = [...new Set(regional)].concat(data.text || '').filter(Boolean).join('\n\n');
  return { text, confidence: Number(data.confidence) || 0, quality };
}

export async function processOcrFiles(files, { onProgress = () => {}, isCancelled = () => false } = {}) {
  const selected = [...(files || [])];
  if (!selected.length) throw new Error('Selecione ao menos um documento.');
  if (selected.length > 10) throw new Error('Selecione no máximo 10 arquivos por leitura.');
  if (selected.reduce((sum, file) => sum + file.size, 0) > 40 * 1024 * 1024) throw new Error('O conjunto deve ter até 40 MB. Leia documentos maiores em partes para evitar travar o celular.');
  let totalPages = 0;
  for (const file of selected) {
    if (file.size > 20 * 1024 * 1024) throw new Error('Cada arquivo deve ter até 20 MB.');
    const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    const image = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name || '');
    if (!pdf && !image) throw new Error('Formato não permitido. Use JPG, PNG, WebP ou PDF.');
  }
  const pages = [];
  let completed = 0, total = selected.length;
  const notify = (status, percent = 0) => onProgress({ status, percent: Math.round(percent), completed, total });
  progressCallback = (percent, status) => notify(status || 'Reconhecendo texto…', percent);
  const worker = await getWorker();
  try {
  for (let fileIndex = 0; fileIndex < selected.length; fileIndex++) {
    if (isCancelled()) throw new Error('Leitura cancelada.');
    const file = selected[fileIndex];
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (!isPdf) {
      totalPages++;
      if (totalPages > 20) throw new Error('A leitura aceita até 20 imagens/páginas por vez. Separe o restante em outra leitura.');
      notify('Lendo imagem ' + (fileIndex + 1) + ' de ' + total + '…');
      const result = await readOne(worker, file, (status, percent) => notify(status || 'Reconhecendo texto…', percent), isCancelled);
      pages.push({ name: file.name || ('Imagem ' + (fileIndex + 1)), page: 1, text: result.text, confidence: result.confidence, quality: result.quality, blob: file });
      completed++;
      notify('Imagem lida.', 100);
      continue;
    }
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await task.promise;
    if (pdf.numPages > 10) {
      await pdf.destroy();
      throw new Error('Este PDF tem mais de 10 páginas. Separe-o em arquivos menores para evitar travar o celular.');
    }
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      totalPages++;
      if (totalPages > 20) { await pdf.destroy(); throw new Error('A leitura aceita até 20 imagens/páginas por vez. Separe o restante em outra leitura.'); }
      if (isCancelled()) { await pdf.destroy(); throw new Error('Leitura cancelada.'); }
      notify('Preparando página ' + pageNumber + ' de ' + pdf.numPages + '…');
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.2, 1800 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
      const blob = await canvasBlob(canvas);
      canvas.width = 0; canvas.height = 0;
      const result = await readOne(worker, blob, (status, percent) => notify(status || 'Lendo página ' + pageNumber + ' de ' + pdf.numPages + '…', percent), isCancelled);
      pages.push({ name: file.name, page: pageNumber, text: result.text, confidence: result.confidence, quality: result.quality, blob });
      page.cleanup();
      completed++;
    }
    await pdf.destroy();
  }
  const text = pages.map(page => page.text).filter(Boolean).join('\n\n');
  const confidence = pages.length ? pages.reduce((sum, page) => sum + page.confidence, 0) / pages.length : 0;
  return { text, confidence, pages, quality: [...new Set(pages.flatMap(page => page.quality))] };
  } finally { progressCallback = () => {}; }
}

