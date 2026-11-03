const MAX_PREVIEW_EDGE = 900;
const MAX_OUTPUT_EDGE = 3000;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível abrir esta foto.'));
    };
    image.src = url;
  });
}

function fitSize(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function renderEnhanced(source, target, strength, maxEdge) {
  const size = fitSize(source.naturalWidth || source.width, source.naturalHeight || source.height, maxEdge);
  target.width = size.width;
  target.height = size.height;
  const context = target.getContext('2d', { alpha: false });
  const amount = Number(strength) / 100;
  context.filter = `brightness(${100 + amount * 7}%) contrast(${100 + amount * 15}%) saturate(${100 + amount * 4}%)`;
  context.drawImage(source, 0, 0, size.width, size.height);
  context.filter = 'none';

  // Nitidez leve por máscara de realce, aplicada somente à cópia de prévia/saída.
  if (amount > 0.05 && size.width * size.height <= 5_000_000) {
    const original = context.getImageData(0, 0, size.width, size.height);
    const input = original.data;
    const output = new Uint8ClampedArray(input);
    const mix = amount * 0.22;
    for (let y = 1; y < size.height - 1; y++) {
      for (let x = 1; x < size.width - 1; x++) {
        const i = (y * size.width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const neighbors = input[i - size.width * 4 + c] + input[i + size.width * 4 + c] + input[i - 4 + c] + input[i + 4 + c];
          output[i + c] = input[i + c] + (input[i + c] - neighbors / 4) * mix;
        }
      }
    }
    original.data.set(output);
    context.putImageData(original, 0, 0);
  }
}

function blobFromCanvas(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível gerar a cópia melhorada.')), type, quality);
  });
}

function ensureStyles() {
  if (document.getElementById('photo-enhancer-styles')) return;
  const style = document.createElement('style');
  style.id = 'photo-enhancer-styles';
  style.textContent = `
    .photo-enhancer-backdrop{position:fixed;inset:0;z-index:10050;background:rgba(10,15,18,.72);display:grid;place-items:center;padding:16px;overflow:auto}
    .photo-enhancer-dialog{width:min(760px,100%);max-height:min(92dvh,900px);overflow:auto;background:var(--surface,#fff);color:var(--text,#171a1c);border:1px solid var(--border,#dfe3e5);border-radius:20px;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.32)}
    .photo-enhancer-dialog h2{margin:0 0 6px;font-size:1.25rem}.photo-enhancer-dialog p{margin:0 0 14px;color:var(--muted,#667078);line-height:1.45}
    .photo-enhancer-compare{display:grid;grid-template-columns:1fr 1fr;gap:12px}.photo-enhancer-compare figure{margin:0;min-width:0}.photo-enhancer-compare figcaption{font-size:.85rem;font-weight:700;margin:0 0 6px}
    .photo-enhancer-compare img,.photo-enhancer-compare canvas{display:block;width:100%;height:clamp(180px,38vh,360px);object-fit:contain;background:#15191b;border-radius:12px}
    .photo-enhancer-control{display:flex;align-items:center;gap:12px;margin:16px 0}.photo-enhancer-control input{width:100%;accent-color:#50595e}
    .photo-enhancer-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}.photo-enhancer-actions button{min-height:46px}
    .photo-enhancer-note{font-size:.82rem!important;margin-top:10px!important}
    @media(max-width:560px){.photo-enhancer-backdrop{padding:8px}.photo-enhancer-dialog{padding:14px;border-radius:16px;max-height:94dvh}.photo-enhancer-compare{gap:7px}.photo-enhancer-compare img,.photo-enhancer-compare canvas{height:clamp(145px,30vh,250px)}.photo-enhancer-compare figcaption{font-size:.75rem}.photo-enhancer-actions{display:grid;grid-template-columns:1fr}.photo-enhancer-actions button{width:100%}}
    [data-theme="dark"] .photo-enhancer-dialog{background:#151719;color:#f3f5f6;border-color:#363b3e}
  `;
  document.head.append(style);
}

export async function offerPhotoEnhancement(file) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) return file;
  ensureStyles();
  let loaded;
  try { loaded = await loadImage(file); } catch { return file; }
  const { image, url } = loaded;
  const backdrop = document.createElement('div');
  backdrop.className = 'photo-enhancer-backdrop';
  backdrop.innerHTML = `
    <section class="photo-enhancer-dialog" role="dialog" aria-modal="true" aria-labelledby="photo-enhancer-title">
      <h2 id="photo-enhancer-title">Melhorar foto</h2>
      <p>Veja uma cópia com ajustes leves de luz, contraste e nitidez. A foto original permanece intacta.</p>
      <div class="photo-enhancer-compare">
        <figure><figcaption>Original</figcaption><img alt="Foto original"></figure>
        <figure><figcaption>Prévia ajustada</figcaption><canvas aria-label="Prévia da cópia ajustada"></canvas></figure>
      </div>
      <label class="photo-enhancer-control"><span>Intensidade</span><input type="range" min="0" max="100" value="55" aria-label="Intensidade dos ajustes"><output>55%</output></label>
      <div class="photo-enhancer-actions">
        <button type="button" class="button secondary" data-enhancer-keep>Manter original</button>
        <button type="button" class="button" data-enhancer-accept>Aceitar cópia melhorada</button>
      </div>
      <p class="photo-enhancer-note">O ajuste pode melhorar a aparência, mas não recupera detalhes que não estão na imagem.</p>
    </section>`;
  const originalPreview = backdrop.querySelector('img');
  const canvas = backdrop.querySelector('canvas');
  const slider = backdrop.querySelector('input[type="range"]');
  const output = backdrop.querySelector('output');
  originalPreview.src = url;
  const previewSize = fitSize(image.naturalWidth, image.naturalHeight, MAX_PREVIEW_EDGE);
  const previewSource = document.createElement('canvas');
  previewSource.width = previewSize.width;
  previewSource.height = previewSize.height;
  previewSource.getContext('2d', { alpha: false }).drawImage(image, 0, 0, previewSize.width, previewSize.height);
  const drawPreview = () => {
    output.value = slider.value + '%';
    output.textContent = slider.value + '%';
    renderEnhanced(previewSource, canvas, slider.value, MAX_PREVIEW_EDGE);
  };
  drawPreview();
  slider.addEventListener('input', drawPreview);
  document.body.append(backdrop);

  try {
    return await new Promise(resolve => {
      const finish = value => {
        backdrop.remove();
        URL.revokeObjectURL(url);
        resolve(value);
      };
      backdrop.querySelector('[data-enhancer-keep]').addEventListener('click', () => finish(file), { once: true });
      backdrop.querySelector('[data-enhancer-accept]').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Preparando cópia…';
        try {
          const fullCanvas = document.createElement('canvas');
          renderEnhanced(image, fullCanvas, slider.value, MAX_OUTPUT_EDGE);
          const preferredType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? file.type : 'image/jpeg';
          let blob = await blobFromCanvas(fullCanvas, preferredType, 0.94);
          let extension = preferredType === 'image/png' ? 'png' : preferredType === 'image/webp' && blob.type === 'image/webp' ? 'webp' : 'jpg';
          if (blob.type !== preferredType) {
            blob = await blobFromCanvas(fullCanvas, 'image/jpeg', 0.94);
            extension = 'jpg';
          }
          finish(new File([blob], file.name.replace(/\.[^.]+$/, '') + '-melhorada.' + extension, { type: blob.type || preferredType, lastModified: Date.now() }));
        } catch {
          button.disabled = false;
          button.textContent = 'Tentar novamente';
        }
      });
    });
  } finally {
    if (!backdrop.isConnected) URL.revokeObjectURL(url);
  }
}
