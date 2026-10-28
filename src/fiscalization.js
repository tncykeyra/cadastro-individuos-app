const BUCKET = 'fiscalization-guides';
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function signedImages(client, paths) {
  if (!paths?.length) return new Map();
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  return new Map((data || []).map(item => [item.path, item.error ? '' : item.signedUrl || '']));
}

function imageMarkup(paths, urls, title) {
  if (!paths?.length) return '';
  return '<div class="fiscalization-images">' + paths.map((path, i) => {
    const url = urls.get(path) || '';
    return url ? '<button class="fiscalization-image-button" type="button" data-fiscalization-image="' + esc(url) + '" aria-label="Ampliar imagem ' + (i + 1) + ' de ' + esc(title) + '"><img loading="lazy" src="' + esc(url) + '" alt="' + esc(title) + ' — imagem ' + (i + 1) + '"></button>' : '';
  }).join('') + '</div>';
}

function guideCard(guide, urls, admin) {
  return '<article class="fiscalization-card" data-guide-category="' + esc(guide.category || 'Geral') + '"><div class="fiscalization-card-heading"><div><span class="fiscalization-category">' + esc(guide.category) + '</span><h2>' + esc(guide.title) + '</h2></div>' +
    (admin ? '<button type="button" class="button secondary small" data-fiscalization-edit="' + esc(guide.id) + '">Editar</button>' : '') +
    '</div>' + (guide.summary ? '<p class="fiscalization-summary">' + esc(guide.summary) + '</p>' : '') +
    '<details class="fiscalization-details"><summary>Ver orientação e detalhes</summary><div class="fiscalization-content">' + esc(guide.content).replace(/\n/g, '<br>') + '</div>' +
    (guide.source_note ? '<p class="fiscalization-source"><strong>Fonte/observação:</strong> ' + esc(guide.source_note) + '</p>' : '') +
    (guide.reference_url ? '<a class="fiscalization-reference" href="' + esc(guide.reference_url) + '" target="_blank" rel="noopener noreferrer">Consultar referência oficial ↗</a>' : '') +
    imageMarkup(guide.image_paths || [], urls, guide.title) + '</details></article>';
}

function editorDialog(guide, admin) {
  if (!admin) return '';
  const g = guide || {};
  const paths = g.image_paths || [];
  return '<dialog class="record-dialog fiscalization-dialog" id="fiscalizationDialog"><form id="fiscalizationForm" class="dialog-inner" data-guide-id="' + esc(g.id || '') + '">' +
    '<div class="dialog-head"><h2>' + (g.id ? 'Editar material' : 'Novo material') + '</h2><button class="close" type="button" data-fiscalization-close aria-label="Fechar">×</button></div>' +
    '<div class="form-grid"><div class="field"><label for="guideCategory">Categoria</label><input id="guideCategory" name="category" maxlength="80" required value="' + esc(g.category || '') + '" placeholder="Ex.: Veículos"></div>' +
    '<div class="field"><label for="guideTitle">Título</label><input id="guideTitle" name="title" maxlength="140" required value="' + esc(g.title || '') + '"></div>' +
    '<div class="field full"><label for="guideSummary">Resumo</label><textarea id="guideSummary" name="summary" maxlength="600" rows="2">' + esc(g.summary || '') + '</textarea></div>' +
    '<div class="field full"><label for="guideContent">Informações</label><textarea id="guideContent" name="content" required rows="9">' + esc(g.content || '') + '</textarea></div>' +
    '<div class="field full"><label for="guideSource">Fonte ou observação</label><input id="guideSource" name="source_note" maxlength="600" value="' + esc(g.source_note || '') + '" placeholder="Ex.: material interno; confirmar regra vigente"></div>' +
    '<div class="field full"><label for="guideUrl">Link oficial (opcional)</label><input id="guideUrl" name="reference_url" type="url" maxlength="1000" value="' + esc(g.reference_url || '') + '" placeholder="https://..."></div>' +
    '<div class="field full"><label for="guideImages">Adicionar imagens (até ' + MAX_IMAGES + ' por material)</label><input id="guideImages" name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple><small>JPEG, PNG ou WEBP; até 8 MB por imagem. Imagens existentes podem ser mantidas ou removidas abaixo.</small></div>' +
    (paths.length ? '<fieldset class="field full fiscalization-existing-images"><legend>Imagens anexadas</legend><div class="fiscalization-edit-images">' + paths.map((path, i) => '<label><input type="checkbox" name="keep_image" value="' + esc(path) + '" checked><span>Manter imagem ' + (i + 1) + '</span></label>').join('') + '</div></fieldset>' : '') +
    '<label class="field full fiscalization-disclaimer"><span><strong>Material de apoio interno.</strong> Confira as normas vigentes e os procedimentos oficiais antes de aplicar.</span></label></div>' +
    '<div class="dialog-actions"><button class="button secondary" type="button" data-fiscalization-close>Cancelar</button><button class="button" type="submit">Salvar material</button></div></form></dialog>';
}

const ETILOMETER_VIDEOS = [
  { id: 'ENsEuMQh1zg', title: 'Como fazer o teste — modo 1', description: 'Demonstração do procedimento de teste no etilômetro.' },
  { id: 'zdW_IJhq4pY', title: 'Como fazer o teste — modo 2', description: 'Demonstração de uma segunda forma de realizar o teste.' },
  { id: 'EuETJDfjTa8', title: 'Impressão — recusa', description: 'Orientação sobre a impressão relacionada à recusa do teste.' },
  { id: 'gwG0L7FpW7M', title: 'Impressão — teste anterior', description: 'Orientação para imprimir o resultado do teste anterior.' }
];

function videoCard(video) {
  return '<article class="fiscalization-video-card"><div class="fiscalization-video-heading"><span class="fiscalization-video-icon" aria-hidden="true">▶</span><div><span class="fiscalization-category">Etilômetro</span><h2>' + esc(video.title) + '</h2></div></div>' +
    '<p class="fiscalization-summary">' + esc(video.description) + '</p>' +
    '<div class="fiscalization-video-player" data-video-player="' + esc(video.id) + '"><div class="fiscalization-video-placeholder"><span aria-hidden="true">▶</span><p>O vídeo será carregado ao tocar em assistir.</p><button class="button" type="button" data-play-video="' + esc(video.id) + '" data-video-title="' + esc(video.title) + '">▶ Assistir vídeo</button></div></div>' +
    '<a class="fiscalization-reference" href="https://www.youtube.com/watch?v=' + esc(video.id) + '" target="_blank" rel="noopener noreferrer">Abrir no YouTube ↗</a></article>';
}

export async function renderFiscalizationPage(client, isAdmin) {
  const { data, error } = await client.from('fiscalization_guides')
    .select('id,category,title,summary,content,source_note,reference_url,image_paths,sort_order,updated_at')
    .order('sort_order', { ascending: true }).order('category', { ascending: true }).order('title', { ascending: true });
  if (error) throw error;
  const guides = data || [];
  const paths = [...new Set(guides.flatMap(item => item.image_paths || []))];
  const urls = await signedImages(client, paths);
  const groups = new Map();
  for (const guide of guides) {
    const key = guide.category || 'Geral';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(guide);
  }
  const content = groups.size ? [...groups].map(([category, items]) =>
    '<section class="fiscalization-group" data-guide-group="' + esc(category) + '"><h2>' + esc(category) + '</h2><div class="fiscalization-list">' +
    items.map(guide => guideCard(guide, urls, isAdmin)).join('') + '</div></section>').join('') :
    '<div class="empty" data-guides-empty>Nenhum material cadastrado.</div>';
  const categoryFilters = ['Todos', ...groups.keys()].map((category, index) =>
    '<button type="button" class="fiscalization-filter' + (index === 0 ? ' active' : '') + '" data-category-filter="' + (index === 0 ? 'all' : esc(category)) + '" aria-pressed="' + (index === 0 ? 'true' : 'false') + '">' + esc(category) + '</button>'
  ).join('');
  return '<section class="page-intro"><div><h1>Fiscalização</h1><p>Consulte orientações rápidas e vídeos de apoio para uso em campo.</p></div>' +
    (isAdmin ? '<button type="button" class="button" data-fiscalization-new>＋ Novo material</button>' : '') +
    '</section><div class="fiscalization-tabs" role="tablist" aria-label="Materiais de fiscalização">' +
    '<button type="button" class="fiscalization-tab active" role="tab" id="fiscalizationTabGuides" aria-selected="true" aria-controls="fiscalizationGuidesPanel" data-fiscalization-tab="guides"><span aria-hidden="true">▤</span> Fiscalização</button>' +
    '<button type="button" class="fiscalization-tab" role="tab" id="fiscalizationTabVideos" aria-selected="false" aria-controls="fiscalizationVideosPanel" data-fiscalization-tab="videos"><span aria-hidden="true">▶</span> Etilômetro</button></div>' +
    '<section id="fiscalizationGuidesPanel" class="fiscalization-panel" role="tabpanel" aria-labelledby="fiscalizationTabGuides" data-fiscalization-panel="guides">' +
    '<aside class="notice fiscalization-notice"><strong>Material de apoio interno:</strong> confira as normas vigentes e os procedimentos oficiais antes de aplicar. As orientações e imagens não substituem a fonte oficial.</aside>' +
    '<div class="fiscalization-toolbar"><label for="fiscalizationSearch">Pesquisar orientações</label><div class="search-control"><input id="fiscalizationSearch" class="search" type="search" placeholder="Assunto, artigo ou palavra-chave" autocomplete="off"><span class="fiscalization-search-count" data-guides-count>' + guides.length + ' materiais</span></div></div>' +
    '<div class="fiscalization-filters" aria-label="Filtrar por categoria">' + categoryFilters + '</div>' +
    '<div id="fiscalizationGuides">' + content + '</div><div class="empty" data-guides-empty hidden>Nenhum material corresponde à pesquisa.</div></section>' +
    '<section id="fiscalizationVideosPanel" class="fiscalization-panel" role="tabpanel" aria-labelledby="fiscalizationTabVideos" data-fiscalization-panel="videos" hidden>' +
    '<div class="fiscalization-video-intro"><div><span class="fiscalization-kicker">VÍDEOS DE APOIO</span><h2>Procedimentos do etilômetro</h2><p>Escolha um vídeo para carregar e assistir. O conteúdo é reproduzido no próprio aplicativo.</p></div><span class="fiscalization-video-count">4 vídeos</span></div>' +
    '<div class="fiscalization-video-grid">' + ETILOMETER_VIDEOS.map(videoCard).join('') + '</div>' +
    '<p class="fiscalization-video-note">Os vídeos são hospedados no YouTube e só estabelecem conexão quando você toca em “Assistir vídeo”.</p></section>' +
    editorDialog(null, isAdmin) +
    '<dialog class="photo-dialog" id="fiscalizationImageDialog"><button class="close photo-close" type="button" data-fiscalization-image-close aria-label="Fechar imagem">×</button><img alt="Imagem ampliada"></dialog>';
}

export function wireFiscalizationActions(client, canAdmin, refresh, notify) {
  const root = document;
  root.addEventListener('input', event => {
    if (event.target?.id !== 'fiscalizationSearch') return;
    const query = event.target.value.trim().toLocaleLowerCase('pt-BR');
    document.querySelectorAll('#fiscalizationGuides .fiscalization-card').forEach(card => {
      card.hidden = !!query && !card.textContent.toLocaleLowerCase('pt-BR').includes(query);
    });
    document.querySelectorAll('#fiscalizationGuides .fiscalization-group').forEach(group => {
      group.hidden = ![...group.querySelectorAll('.fiscalization-card')].some(card => !card.hidden);
    });
  });
  root.addEventListener('click', async event => {
    const target = event.target;
    const newButton = target.closest?.('[data-fiscalization-new]');
    const editButton = target.closest?.('[data-fiscalization-edit]');
    const closeButton = target.closest?.('[data-fiscalization-close]');
    const imageButton = target.closest?.('[data-fiscalization-image]');
    if (newButton || editButton) {
      if (!canAdmin()) return;
      const form = document.querySelector('#fiscalizationForm');
      if (!form) return;
      if (newButton) {
        document.querySelector('#fiscalizationDialog')?.replaceWith(document.createRange().createContextualFragment(editorDialog(null, true)));
        document.querySelector('#fiscalizationDialog').showModal();
      } else {
        try {
          const { data, error } = await client.from('fiscalization_guides').select('*').eq('id', editButton.dataset.fiscalizationEdit).single();
          if (error) throw error;
          const dialog = document.querySelector('#fiscalizationDialog');
          dialog.replaceWith(document.createRange().createContextualFragment(editorDialog(data, true)));
          document.querySelector('#fiscalizationDialog').showModal();
        } catch (error) { notify(error.message || 'Não foi possível abrir o material.'); }
      }
      return;
    }
    if (closeButton) { document.querySelector('#fiscalizationDialog')?.close(); return; }
    if (imageButton) {
      const dialog = document.querySelector('#fiscalizationImageDialog');
      if (dialog) { dialog.querySelector('img').src = imageButton.dataset.fiscalizationImage; dialog.showModal(); }
      return;
    }
    if (target.closest?.('[data-fiscalization-image-close]')) document.querySelector('#fiscalizationImageDialog')?.close();
  });
  root.addEventListener('submit', async event => {
    if (event.target?.id !== 'fiscalizationForm') return;
    event.preventDefault();
    if (!canAdmin()) { notify('Apenas administradores podem alterar estes materiais.'); return; }
    const form = event.target, submit = form.querySelector('[type="submit"]'), id = form.dataset.guideId || crypto.randomUUID();
    const files = [...(form.elements.images.files || [])];
    const existing = [...form.querySelectorAll('[name="keep_image"]:checked')].map(input => input.value);
    if (existing.length + files.length > MAX_IMAGES) { notify('Cada material pode ter até ' + MAX_IMAGES + ' imagens.'); return; }
    if (files.some(file => !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > MAX_IMAGE_BYTES)) { notify('Use JPEG, PNG ou WEBP de até 8 MB por imagem.'); return; }
    submit.disabled = true;
    const payload = {
      category: form.elements.category.value.trim(), title: form.elements.title.value.trim(),
      summary: form.elements.summary.value.trim(), content: form.elements.content.value.trim(),
      source_note: form.elements.source_note.value.trim(), reference_url: form.elements.reference_url.value.trim() || null,
      image_paths: existing, updated_by: (await client.auth.getUser()).data.user?.id
    };
    try {
      let result;
      if (form.dataset.guideId) result = await client.from('fiscalization_guides').update(payload).eq('id', id).select('id').single();
      else result = await client.from('fiscalization_guides').insert({...payload,id,created_by:payload.updated_by}).select('id').single();
      if (result.error) throw result.error;
      const uploaded = [];
      try {
        for (const file of files) {
          const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
          const path = payload.updated_by + '/' + id + '/' + crypto.randomUUID() + '.' + ext;
          const { error } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
          if (error) throw error;
          uploaded.push(path);
        }
        if (uploaded.length) {
          const finalPaths = [...existing, ...uploaded];
          const { error } = await client.from('fiscalization_guides').update({image_paths:finalPaths,updated_by:payload.updated_by}).eq('id', id);
          if (error) throw error;
        }
      } catch (error) {
        if (uploaded.length) await client.storage.from(BUCKET).remove(uploaded);
        throw error;
      }
      const removed = (form.dataset.guideId ? [...form.querySelectorAll('[name="keep_image"]')].map(input=>input.value).filter(path=>!existing.includes(path)) : []);
      if (removed.length) await client.storage.from(BUCKET).remove(removed);
      notify('Material salvo.');
      document.querySelector('#fiscalizationDialog')?.close();
      await refresh();
    } catch (error) {
      notify(error.message || 'Não foi possível salvar o material.');
    } finally { submit.disabled = false; }
  });
}
