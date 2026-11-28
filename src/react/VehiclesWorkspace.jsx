import React from 'react';
import './vehicles-workspace.css';

export default function VehiclesWorkspace({ contentHtml, view, onSwitchClassic }) {
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
      <div className="vehicles-react-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />
      <footer className="vehicles-react-footnote">Os dados exibidos respeitam a cidade ativa e as permissões da sua conta. A apresentação moderna não altera registros nem vínculos.</footer>
    </div>
  );
}
