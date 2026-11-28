import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
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
      root.render(element);
      roots.push(root);
    };
    mount('[data-vehicle-react-back]',
      <button className="vehicle-detail-action vehicle-back-action" type="button" data-back>
        <BackIcon/><span>Voltar para veículos</span>
      </button>
    );
    mount('[data-vehicle-react-actions]',
      <div className="vehicle-detail-actions">
        <button className="vehicle-detail-action vehicle-share-action" type="button"
          data-record-pdf={'vehicles:' + recordId} aria-label="Compartilhar ficha do veículo"
          title="Compartilhar ficha do veículo">
          <span className="vehicle-action-icon"><ShareIcon/></span>
          <span className="vehicle-action-label">Compartilhar</span>
        </button>
        <button className="vehicle-detail-action vehicle-edit-action" type="button" data-edit-vehicle={recordId}>
          <EditIcon/><span>Editar</span>
        </button>
        {canDelete && <button className="vehicle-detail-action vehicle-delete-action" type="button" data-delete-record={'vehicles:' + recordId}>
          <DeleteIcon/><span>Excluir</span>
        </button>}
      </div>
    );
    mount('[data-vehicle-react-association]',
      <>
        <h2>Pessoas associadas</h2>
        <button className="vehicle-detail-action vehicle-associate-action" type="button" data-link-vehicle={recordId}>
          <LinkIcon/><span>Associar pessoa</span>
        </button>
      </>
    );
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
          <button className="vehicles-react-switch" type="button" onClick={onSwitchClassic}>Voltar à interface clássica</button>
        </div>
      </header>
      {detail
        ? <VehicleDetailActionMount contentHtml={contentHtml} recordId={recordId} canDelete={canDelete}/>
        : <div className="vehicles-react-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />}
      <footer className="vehicles-react-footnote">Os dados exibidos respeitam a cidade ativa e as permissões da sua conta. A apresentação moderna não altera registros nem vínculos.</footer>
    </div>
  );
}
