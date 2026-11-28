import React from 'react';
import './warrants-workspace.css';

const format = value => Number(value || 0).toLocaleString('pt-BR');

function Metric({ label, value, detail }) {
  return <article className="warrants-react-metric">
    <span>{label}</span>
    <strong>{format(value)}</strong>
    <small>{detail}</small>
  </article>;
}

export default function WarrantsWorkspace({ contentHtml, stats, admin, onSwitchClassic }) {
  return <div className="warrants-react-shell">
    <header className="warrants-react-hero">
      <div>
        <span className="warrants-react-eyebrow">GESTÃO DE ORDENS JUDICIAIS</span>
        <h1>Mandados de prisão</h1>
        <p>Consulta, inclusão e revisão administrativa em uma área única. Confira a situação de cada registro na fonte oficial.</p>
      </div>
      <div className="warrants-react-hero-side">
        <span className="warrants-react-role">{admin ? 'Área administrativa' : 'Consulta operacional'}</span>
        <button className="warrants-react-switch" type="button" onClick={onSwitchClassic}>Voltar à interface clássica</button>
      </div>
    </header>

    <section className="warrants-react-metrics" aria-label="Resumo dos mandados">
      <Metric label="Registros exibidos" value={stats?.total} detail="Conforme seu perfil de acesso" />
      <Metric label="Pendentes" value={stats?.active} detail="Situação registrada no sistema" />
      <Metric label="Baixa informada" value={stats?.reported} detail="Aguardando confirmação administrativa" />
      <Metric label="Baixados ou encerrados" value={stats?.closed} detail="Não contabilizados como ativos" />
    </section>

    <div className="warrants-react-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />
    <footer className="warrants-react-footnote">Os indicadores refletem os registros disponíveis nesta sessão. Confirme a situação jurídica na fonte oficial antes de qualquer providência.</footer>
  </div>;
}
