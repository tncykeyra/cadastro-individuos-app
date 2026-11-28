import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Button } from './ui-system.jsx';
import './vehicles-workspace.css';

function ShareIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.7 6.8-4.1M8.6 13.3l6.8 4.1"/></svg>;
}
function EditIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4.2-.8L19 8.4a2.1 2.1 0 0 0-3-3L5.2 16.2 4 20Z"/></svg>;
}
function DeleteIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>;
}
function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7M7 12h14"/></svg>;
}
function LinkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>;
}


function reactButtonAttributes(button) {
  const props = {};
  for (const attribute of [...button.attributes]) {
    const name = attribute.name;
    const value = attribute.value;
    if (name === 'class') props.className = value;
    else if (name === 'tabindex') props.tabIndex = Number(value);
    else if (name === 'autofocus') props.autoFocus = true;
    else if (name === 'disabled' || name === 'hidden' || name === 'formnovalidate') {
      props[name === 'formnovalidate' ? 'formNoValidate' : name] = true;
    } else if (name === 'style') {
      props.style = Object.fromEntries(value.split(';').map(rule => rule.trim()).filter(Boolean).map(rule => {
        const separator = rule.indexOf(':');
        const key = rule.slice(0, separator).trim().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        return [key, rule.slice(separator + 1).trim()];
      }));
    } else props[name] = value;
  }
  props['data-react-owned'] = 'true';
  return props;
}

function mountReactButtons(host, roots) {
  if (!host) return;
  const buttons = [...host.querySelectorAll('button:not([data-react-owned])')];
  for (const button of buttons) {
    const props = reactButtonAttributes(button);
    const markup = button.innerHTML;
    const mount = document.createElement('span');
    mount.className = 'react-button-mount';
    button.replaceWith(mount);
    const root = createRoot(mount);
    flushSync(() => root.render(
      <button {...props} dangerouslySetInnerHTML={{ __html: markup }} />
    ));
    roots.push(root);
  }
}

function ReactButtonContent({ contentHtml }) {
  const hostRef = useRef(null);
  useEffect(() => {
    const roots = [];
    mountReactButtons(hostRef.current, roots);
    return () => roots.forEach(root => root.unmount());
  }, [contentHtml]);
  return <div ref={hostRef} className="vehicles-react-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />;
}

function VehicleDetailActionMount({ contentHtml, recordId, canDelete }) {
  const hostRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const roots = [];
    const mount = (selector, element) => {
      const target = host.querySelector(selector);
      if (!target) return;
      const root = createRoot(target);
      flushSync(() => root.render(element));
      roots.push(root);
    };
    mount('[data-vehicle-react-back]',
      <button className="vehicle-detail-action vehicle-back-action" type="button" data-back data-react-owned="true">
        <BackIcon/><span>Voltar para veículos</span>
      </button>
    );
    mount('[data-vehicle-react-actions]',
      <div className="vehicle-detail-actions">
        <button className="vehicle-detail-action vehicle-share-action" type="button" data-react-owned="true"
          data-record-pdf={'vehicles:' + recordId} aria-label="Compartilhar ficha do veículo"
          title="Compartilhar ficha do veículo">
          <span className="vehicle-action-icon"><ShareIcon/></span>
          <span className="vehicle-action-label">Compartilhar</span>
        </button>
        <button className="vehicle-detail-action vehicle-edit-action" type="button" data-react-owned="true" data-edit-vehicle={recordId}>
          <EditIcon/><span>Editar</span>
        </button>
        {canDelete && <button className="vehicle-detail-action vehicle-delete-action" type="button" data-react-owned="true" data-delete-record={'vehicles:' + recordId}>
          <DeleteIcon/><span>Excluir</span>
        </button>}
      </div>
    );
    mount('[data-vehicle-react-association]',
      <>
        <h2>Pessoas associadas</h2>
        <button className="vehicle-detail-action vehicle-associate-action" type="button" data-react-owned="true" data-link-vehicle={recordId}>
          <LinkIcon/><span>Associar pessoa</span>
        </button>
      </>
    );
    mountReactButtons(host, roots);
    return () => roots.forEach(root => root.unmount());
  }, [contentHtml, recordId, canDelete]);

  return <div ref={hostRef} className="vehicles-react-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />;
}

export default function VehiclesWorkspace({ contentHtml, view, onSwitchClassic, recordId, canDelete = false }) {
  const detail = view === 'detail';
  return (
    <div className={'vehicles-react-shell ' + (detail ? 'is-detail' : 'is-list')}>
      <header className="vehicles-react-hero">
        <div className="vehicles-react-heading">
          <span className="vehicles-react-eyebrow">{detail ? 'CONSULTA INDIVIDUAL' : 'GESTÃO DE FROTA CADASTRADA'}</span>
          <h1>{detail ? 'Ficha do veículo' : 'Veículos'}</h1>
          <p>{detail
            ? 'Consulte os dados de identificação, fotografias e vínculos registrados.'
            : 'Localize, confira e mantenha os registros de veículos da cidade em uma área organizada.'}</p>
        </div>
        <div className="vehicles-react-tools">
          <span className="vehicles-react-context"><span aria-hidden="true" className="vehicles-react-context-dot" /> {detail ? 'Registro selecionado' : 'Base municipal'}</span>
          <Button variant="secondary" size="sm" className="vehicles-react-switch" type="button" onClick={onSwitchClassic}>Voltar à interface clássica</Button>
        </div>
      </header>
      {detail
        ? <VehicleDetailActionMount contentHtml={contentHtml} recordId={recordId} canDelete={canDelete}/>
        : <ReactButtonContent contentHtml={contentHtml} />}
      <footer className="vehicles-react-footnote">Os dados exibidos respeitam a cidade ativa e as permissões da sua conta. A apresentação moderna não altera registros nem vínculos.</footer>
    </div>
  );
}


function AssociationDialogShell({ isPerson, targetFieldHtml, notesFieldHtml }) {
  const heading = isPerson ? 'Associar veículo à pessoa' : 'Associar pessoa ao veículo';
  const eyebrow = isPerson ? 'VÍNCULO DE VEÍCULO' : 'VÍNCULO DE PESSOA';
  const description = isPerson
    ? 'Pesquise pela placa e selecione o veículo que será vinculado a este cadastro.'
    : 'Localize a pessoa pelo nome, CPF ou RG antes de confirmar o vínculo.';
  return (
    <div className="dialog-inner association-react-dialog">
      <div className="association-react-heading">
        <div className="association-react-heading-copy">
          <span className="association-react-eyebrow">{eyebrow}</span>
          <h2>{heading}</h2>
          <p>{description}</p>
        </div>
        <button className="close association-react-close" type="button" data-close aria-label="Fechar">×</button>
      </div>
      <form id="linkForm" className="association-react-form">
        <div className="association-react-search-panel">
          <div className="association-react-step"><span>1</span><div><strong>Localizar cadastro</strong><small>Selecione um registro já existente na base.</small></div></div>
          <div dangerouslySetInnerHTML={{ __html: targetFieldHtml }} />
        </div>
        <div className="association-react-details">
          <div className="association-react-step"><span>2</span><div><strong>Definir vínculo</strong><small>Informe a natureza da relação e, se necessário, uma observação.</small></div></div>
          <div className="field association-react-relation">
            <label htmlFor="relation">Tipo de relação</label>
            <select id="relation" name="relation" defaultValue="driver">
              <option value="driver">Condutor</option>
              <option value="owner">Proprietário</option>
              <option value="associated">Associado</option>
            </select>
          </div>
          <div dangerouslySetInnerHTML={{ __html: notesFieldHtml }} />
        </div>
      </form>
      <div className="dialog-actions association-react-actions">
        <button className="button secondary" data-close type="button">Cancelar</button>
        <button className="button association-react-submit" type="submit" form="linkForm"><span aria-hidden="true">＋</span> Confirmar associação</button>
      </div>
    </div>
  );
}

export function mountAssociationDialog(dialog, props) {
  const root = createRoot(dialog);
  flushSync(() => root.render(<AssociationDialogShell {...props} />));
  return root;
}
