import { extractDocumentFields, isValidCpf, isValidDocumentDate } from './ocr-domain.js';
import { processOcrFiles, cancelOcrWorker } from './ocr-engine.js';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function maskedCpf(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 ? '***.***.***-' + digits.slice(-2) : '—';
}

function fieldCurrentValue(record, key) {
  if (key === 'cpf_digits') return String(record.cpf_digits || '');
  return String(record[key] || '');
}

function selectedFormValues(dialog, items) {
  const values = {};
  for (const item of items) {
    if (!item.supported) continue;
    const include = dialog.querySelector('[data-ocr-include="' + item.key + '"]');
    const input = dialog.querySelector('[data-ocr-value="' + item.key + '"]');
    const value = String(input?.value || '').trim();
    if (include?.checked && value) values[item.key] = value;
  }
  if (values.cpf_digits) values.cpf_digits = values.cpf_digits.replace(/\D/g, '');
  if (values.plate) values.plate = values.plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return values;
}

export function mountOcrAssistant({ form, kind, existingRecord = null, findMatches = async () => ({ items: [], hard: false }), onApply = () => true, onOpenExisting = () => {}, onAddPhoto = async () => {} }) {
  const grid = form?.querySelector('.form-grid');
  if (!grid) return null;
  const container = document.createElement('div');
  container.className = 'field full ocr-assistant';
  container.innerHTML = '<button type="button" class="button secondary" data-open-ocr>📷 Ler documento / Print com OCR</button><p class="muted">Leitura feita neste dispositivo. Confira os campos antes de aplicar.</p>';
  const anchor = form.querySelector('.form-pages') || grid;
  form.insertBefore(container, anchor);
  const dialog = document.createElement('dialog');
  dialog.className = 'ocr-dialog';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf';
  fileInput.multiple = true;
  fileInput.hidden = true;
  const cameraInput = document.createElement('input');
  cameraInput.type = 'file';
  cameraInput.accept = 'image/jpeg,image/png,image/webp';
  cameraInput.capture = 'environment';
  cameraInput.multiple = true;
  cameraInput.hidden = true;
  document.body.append(dialog, fileInput, cameraInput);
  let pages = [], parsed = null, cancelled = false, running = false, cropMode = false, crop = null, previewUrl = '', selectedSource = 0;
  const close = () => { if (dialog.open) dialog.close(); };
  const releaseUrls = () => { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = ''; };
  const show = html => { dialog.innerHTML = html; if (!dialog.open) dialog.showModal(); dialog.querySelector('[data-ocr-close]')?.addEventListener('click', close); };
  const header = '<div class="ocr-dialog-inner"><div class="dialog-head"><div><h2>Leitura de documento</h2><p>Imagens e textos são processados localmente no aparelho.</p></div><button class="close" type="button" data-ocr-close aria-label="Fechar">×</button></div>';
  const home = () => {
    cropMode = false; crop = null;
    show(header + '<div class="ocr-choice"><button type="button" class="button" data-ocr-camera>📸 Tirar foto com a câmera</button><button type="button" class="button secondary" data-ocr-files>📁 Selecionar arquivo</button></div><p class="muted">Aceita imagens JPG, PNG, WebP e arquivos PDF. Selecione frente e verso juntos quando necessário.</p></div>');
    dialog.querySelector('[data-ocr-camera]').onclick = guidance;
    dialog.querySelector('[data-ocr-files]').onclick = () => fileInput.click();
  };
  const guidance = () => {
    show(header + '<section class="ocr-guidance"><h3>📸 COMO FOTOGRAFAR O DOCUMENTO</h3><ul><li>Coloque o documento em uma superfície plana e bem iluminada.</li><li>Enquadre o documento inteiro, sem cortar as bordas; mantenha a câmera reta.</li><li>Evite sombras, reflexos e desfoque. Fotografe frente e verso quando necessário.</li><li>Para prints, prefira a captura original e não corte nomes, números ou datas.</li></ul><p><strong>⚠️ A leitura automática pode errar. Confira todas as informações antes de salvar.</strong></p><button type="button" class="button" data-ocr-understood>✓ Entendi, continuar</button></section></div>');
    dialog.querySelector('[data-ocr-understood]').onclick = () => { close(); cameraInput.click(); };
  };
  const progressView = () => {
    running = true; cancelled = false; releaseUrls();
    show(header + '<div class="ocr-progress"><strong data-ocr-status>Preparando leitura local…</strong><progress data-ocr-progress max="100" value="0"></progress><p class="muted">A imagem não é enviada ao banco nem a um serviço de IA. Na primeira leitura, o aparelho pode baixar os arquivos do mecanismo OCR.</p><button type="button" class="button secondary" data-ocr-cancel>Cancelar leitura</button></div></div>');
    dialog.querySelector('[data-ocr-cancel]').onclick = () => { cancelled = true; void cancelOcrWorker(); close(); };
  };
  const runFiles = async selected => {
    const list = [...(selected || [])];
    if (!list.length) return;
    if (!dialog.open) dialog.showModal();
    progressView();
    try {
      const result = await processOcrFiles(list, { isCancelled: () => cancelled, onProgress: progress => {
        const status = dialog.querySelector('[data-ocr-status]'), bar = dialog.querySelector('[data-ocr-progress]');
        if (status) status.textContent = progress.status;
        if (bar) bar.value = progress.percent;
      }});
      if (cancelled) return;
      pages = result.pages; parsed = extractDocumentFields(result.text, kind, result.confidence); parsed.warnings.push(...result.quality);
      running = false; selectedSource = 0; crop = null; reviewView();
    } catch (error) {
      running = false;
      if (!cancelled) show(header + '<div class="notice error-box" role="alert">' + escapeHtml(error?.message || 'Não foi possível ler os arquivos.') + '</div><div class="ocr-actions"><button class="button secondary" type="button" data-ocr-retry>← Voltar</button><button class="button" type="button" data-ocr-close>Fechar</button></div></div>');
      dialog.querySelector('[data-ocr-retry]')?.addEventListener('click', home);
    }
  };
  fileInput.addEventListener('change', () => { const files = [...fileInput.files]; fileInput.value = ''; void runFiles(files); });
  cameraInput.addEventListener('change', () => { const files = [...cameraInput.files]; cameraInput.value = ''; void runFiles(files); });
  const sourceMarkup = () => pages.length ? '<section class="ocr-photo-section"><h3>📷 Fotografia do documento</h3><p class="muted">A foto do documento não será adicionada automaticamente. Selecione uma página, arraste sobre a fotografia para recortá-la e adicione-a à galeria apenas se estiver correta.</p><label class="ocr-source-label">Imagem ou página<select data-ocr-source>' + pages.map((page, index) => '<option value="' + index + '"' + (index === selectedSource ? ' selected' : '') + '>' + escapeHtml(page.name + (page.page > 1 ? ' · página ' + page.page : '')) + '</option>').join('') + '</select></label><div class="ocr-crop-wrap" data-ocr-crop-wrap><img data-ocr-image alt="Documento analisado"><div class="ocr-crop-selection" data-ocr-selection hidden></div></div><div class="ocr-actions"><button type="button" class="button secondary small" data-ocr-crop-toggle>✏️ Ajustar recorte</button><button type="button" class="button small" data-ocr-add-photo disabled>✓ Adicionar recorte à galeria</button></div><p class="muted" data-ocr-crop-status aria-live="polite"></p></section>' : '';
  const reviewView = () => {
    cropMode = false; crop = null; releaseUrls();
    const detailRows = parsed.details.map(item => '<div class="ocr-field-row"><label><span>' + escapeHtml(item.label) + '</span><input type="text" data-ocr-value="' + escapeHtml(item.key) + '" value="' + escapeHtml(item.value) + '" maxlength="240"></label>' + (item.supported ? '<label class="ocr-include"><input type="checkbox" data-ocr-include="' + escapeHtml(item.key) + '" checked> Aplicar</label>' : '<span class="ocr-not-saved">Campo ainda não existe no cadastro</span>') + (item.warning ? '<small class="ocr-warning">' + escapeHtml(item.warning) + '</small>' : '') + '</div>').join('');
    const warnings = parsed.warnings.length ? '<div class="notice ocr-notice"><strong>Confira antes de continuar</strong><ul>' + parsed.warnings.map(value => '<li>' + escapeHtml(value) + '</li>').join('') + '</ul></div>' : '';
    show(header + '<div class="ocr-result"><h3>📄 DOCUMENTO ANALISADO</h3><p><strong>Tipo identificado:</strong> ' + escapeHtml(parsed.type) + ' · <strong>Confiança média:</strong> ' + Math.round(parsed.confidence) + '%</p>' + warnings + '<div class="ocr-review-fields">' + (detailRows || '<p class="muted">Nenhuma informação compatível foi encontrada.</p>') + '</div>' + sourceMarkup() + '<div class="ocr-actions"><button type="button" class="button secondary" data-ocr-reread>🔄 Ler novamente</button><button type="button" class="button" data-ocr-confirm>✓ Confirmar informações</button></div><p class="muted" data-ocr-status role="status" aria-live="polite"></p></div></div>');
    dialog.querySelector('[data-ocr-reread]').onclick = home;
    dialog.querySelector('[data-ocr-confirm]').onclick = () => void confirmResults();
    bindCrop();
  };
  const currentValuesFromReview = () => selectedFormValues(dialog, parsed.details);
  const applyValues = async values => {
    if (!Object.keys(values).length) { const status = dialog.querySelector('[data-ocr-status]'); if (status) status.textContent = 'Marque ao menos um campo reconhecido para aplicar.'; return; }
    const applied = await onApply(values);
    if (applied === false || applied === 0) { const status = dialog.querySelector('[data-ocr-status]'); if (status) status.textContent = 'Nenhum campo pôde ser aplicado. Confira as permissões e os dados do formulário.'; return; }
    close();
  };
  const compareView = (candidate, values) => {
    cropMode = false; crop = null;
    const rows = Object.entries(values).map(([key, value]) => {
      const item = parsed.details.find(detail => detail.key === key);
      if (!item) return '';
      const oldValue = fieldCurrentValue(candidate.record, key);
      const differs = oldValue.trim() !== String(value).trim();
      return '<label class="ocr-compare-row"><span><strong>' + escapeHtml(item.label) + '</strong><small>Atual: ' + escapeHtml(oldValue || 'Não informado') + '</small></span><input type="text" data-ocr-compare-value="' + escapeHtml(key) + '" value="' + escapeHtml(value) + '"><input type="checkbox" data-ocr-compare-include="' + escapeHtml(key) + '"' + (differs ? ' checked' : '') + ' aria-label="Aplicar ' + escapeHtml(item.label) + '"></label>';
    }).join('');
    show(header + '<div class="ocr-result"><div class="notice"><strong>Cadastro existente encontrado</strong><p>' + escapeHtml(candidate.reason) + '</p><p>Confira a comparação. Nada será salvo até você usar o botão Salvar no cadastro.</p></div><div class="ocr-compare-list">' + rows + '</div><div class="ocr-actions"><button type="button" class="button secondary" data-ocr-back>← Voltar</button><button type="button" class="button" data-ocr-apply-compare>Aplicar seleções no formulário</button></div></div></div>');
    dialog.querySelector('[data-ocr-back]').onclick = () => renderCandidates(values, lastCandidates, lastHard);
    dialog.querySelector('[data-ocr-apply-compare]').onclick = async () => {
      const selected = {};
      for (const [key] of Object.entries(values)) {
        if (!dialog.querySelector('[data-ocr-compare-include="' + key + '"]')?.checked) continue;
        const value = String(dialog.querySelector('[data-ocr-compare-value="' + key + '"]')?.value || '').trim();
        if (value) selected[key] = value;
      }
      if (!Object.keys(selected).length) { toastMessage(dialog, 'Marque ao menos uma informação para aplicar.'); return; }
      close();
      await onOpenExisting(candidate.record, selected);
    };
  };
  let lastCandidates = [], lastHard = false;
  const renderCandidates = (values, candidates, hard) => {
    lastCandidates = candidates; lastHard = hard;
    const cards = candidates.map((candidate, index) => {
      const record = candidate.record, identity = kind === 'people' ? record.full_name : record.plate;
      const detail = kind === 'people' ? 'CPF: ' + maskedCpf(record.cpf_digits) : [record.make, record.model].filter(Boolean).join(' · ');
      return '<button class="ocr-candidate" type="button" data-ocr-candidate="' + index + '"><strong>' + escapeHtml(identity || 'Cadastro encontrado') + '</strong><span>' + escapeHtml(detail || 'Sem identificadores secundários') + '</span><small>' + escapeHtml(candidate.reason) + '</small><b>Conferir e comparar</b></button>';
    }).join('');
    show(header + '<div class="ocr-result"><div class="notice"><strong>🔎 Cadastro existente ou possível correspondência</strong><p>' + (hard ? 'Um identificador coincide. Escolha o registro para conferir e editar; não será criado outro cadastro.' : 'A correspondência por nome é apenas uma possibilidade. Confira os dados antes de decidir.') + '</p></div><div class="ocr-candidate-list">' + cards + '</div><div class="ocr-actions">' + (!hard ? '<button type="button" class="button secondary" data-ocr-new>É um novo registro; continuar</button>' : '') + '<button type="button" class="button secondary" data-ocr-back>← Voltar à conferência</button></div></div></div>');
    dialog.querySelectorAll('[data-ocr-candidate]').forEach(button => button.onclick = () => {
      const candidate = candidates[Number(button.dataset.ocrCandidate)];
      compareView(candidate, values);
    });
    dialog.querySelector('[data-ocr-new]')?.addEventListener('click', () => void applyValues(values));
    dialog.querySelector('[data-ocr-back]')?.addEventListener('click', reviewView);
  };
  const confirmResults = async () => {
    const values = currentValuesFromReview();
    if (values.cpf_digits && !isValidCpf(values.cpf_digits)) { toastMessage(dialog, 'CPF inválido; corrija o número antes de continuar.'); return; }
    if (values.birthday && !isValidDocumentDate(values.birthday)) { toastMessage(dialog, 'Data de nascimento inválida; corrija antes de continuar.'); return; }
    if (values.plate && !/^(?:[A-Z]{3}[0-9]{4}|[A-Z]{3}[0-9][A-Z][0-9]{2})$/.test(values.plate)) { toastMessage(dialog, 'Placa inválida; use AAA0000 ou AAA0A00.'); return; }
    const status = dialog.querySelector('[data-ocr-status]');
    if (status) status.textContent = 'Verificando possíveis cadastros existentes…';
    const match = await findMatches(values);
    if (match?.error) { if (status) status.textContent = 'Não foi possível consultar o banco. Tente novamente antes de aplicar os dados.'; return; }
    if (match?.items?.length) renderCandidates(values, match.items, Boolean(match.hard));
    else await applyValues(values);
  };
  const bindCrop = () => {
    const image = dialog.querySelector('[data-ocr-image]'), select = dialog.querySelector('[data-ocr-source]');
    if (!image || !select) return;
    const setSource = () => {
      releaseUrls(); crop = null;
      selectedSource = Number(select.value || 0);
      const page = pages[selectedSource];
      if (!page) return;
      previewUrl = URL.createObjectURL(page.blob);
      image.onload = () => { const selection = dialog.querySelector('[data-ocr-selection]'); if (selection) selection.hidden = true; };
      image.src = previewUrl;
      const status = dialog.querySelector('[data-ocr-crop-status]');
      if (status) status.textContent = 'Prévia da página. Para extrair uma foto, selecione a área da fotografia.';
    };
    select.onchange = setSource;
    setSource();
    const toggle = dialog.querySelector('[data-ocr-crop-toggle]');
    const status = dialog.querySelector('[data-ocr-crop-status]');
    const addButton = dialog.querySelector('[data-ocr-add-photo]');
    toggle.onclick = () => { cropMode = !cropMode; toggle.textContent = cropMode ? 'Toque e arraste sobre a foto' : '✏️ Ajustar recorte'; if (status) status.textContent = cropMode ? 'Arraste na imagem para marcar a fotografia. Arraste novamente para corrigir.' : 'A área marcada será pré-visualizada antes de ser adicionada.'; };
    let start = null;
    const point = event => { const rect = image.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; };
    image.addEventListener('pointerdown', event => {
      if (!cropMode) return;
      event.preventDefault(); image.setPointerCapture(event.pointerId); start = point(event); crop = { x: start.x, y: start.y, w: 0, h: 0 };
    });
    image.addEventListener('pointermove', event => {
      if (!start || !cropMode) return;
      const end = point(event); crop = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
      const box = dialog.querySelector('[data-ocr-selection]'), wrapper = image.parentElement;
      if (box && wrapper) { const imageRect = image.getBoundingClientRect(), wrapperRect = wrapper.getBoundingClientRect(); box.hidden = false; box.style.left = ((imageRect.left - wrapperRect.left + crop.x * imageRect.width) / wrapperRect.width * 100) + '%'; box.style.top = ((imageRect.top - wrapperRect.top + crop.y * imageRect.height) / wrapperRect.height * 100) + '%'; box.style.width = (crop.w * imageRect.width / wrapperRect.width * 100) + '%'; box.style.height = (crop.h * imageRect.height / wrapperRect.height * 100) + '%'; }
      if (addButton) addButton.disabled = crop.w < .05 || crop.h < .05;
    });
    const endCrop = () => {
      if (!start) return;
      start = null;
      if (status && crop?.w > .05 && crop?.h > .05) status.textContent = 'Recorte selecionado. Confira e adicione à galeria.';
    };
    image.addEventListener('pointerup', endCrop);
    image.addEventListener('pointercancel', endCrop);
    addButton.onclick = async () => {
      if (!crop || crop.w < .05 || crop.h < .05) { if (status) status.textContent = 'Marque a área da fotografia antes de adicionar.'; return; }
      const current = pages[selectedSource];
      try {
        const bitmap = await createImageBitmap(current.blob);
        const x = Math.round(crop.x * bitmap.width), y = Math.round(crop.y * bitmap.height);
        const width = Math.max(1, Math.round(crop.w * bitmap.width)), height = Math.max(1, Math.round(crop.h * bitmap.height));
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d', { alpha: false }).drawImage(bitmap, x, y, width, height, 0, 0, width, height); bitmap.close?.();
        const blob = await canvasBlob(canvas, 'image/jpeg'); canvas.width = 0; canvas.height = 0;
        const file = new File([blob], 'foto-documento-' + Date.now() + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
        const result = await onAddPhoto(file);
        if (status) status.textContent = result === 'staged' ? 'Recorte adicionado ao formulário. Ele será enviado ao salvar o cadastro; a foto original continua preservada.' : result ? 'Recorte salvo na galeria. A foto original continua preservada.' : 'Não foi possível salvar o recorte. Confira a mensagem do cadastro e tente novamente.';
      } catch (error) { if (status) status.textContent = error?.message || 'Não foi possível preparar o recorte.'; }
    };
  };
  const toastMessage = (target, text) => { const status = target.querySelector('[data-ocr-status]'); if (status) status.textContent = text; };
  dialog.addEventListener('close', () => { const shouldCancel = running; cancelled = true; if (shouldCancel) void cancelOcrWorker(); releaseUrls(); pages = []; parsed = null; running = false; });
  const parentDialog = form.closest('dialog');
  const destroy = () => { if (running) { cancelled = true; void cancelOcrWorker(); } if (dialog.open) dialog.close(); releaseUrls(); dialog.remove(); fileInput.remove(); cameraInput.remove(); container.remove(); parentDialog?.removeEventListener('close', destroy); };
  parentDialog?.addEventListener('close', destroy, { once: true });
  container.querySelector('[data-open-ocr]').addEventListener('click', home);
  return { close, destroy };
}