import React from 'react';
import './react.css';

const navigation = [
  { label: 'Painel inicial', icon: '▦', active: true },
  { label: 'Indivíduos', icon: '◎' },
  { label: 'Veículos', icon: '▱' },
  { label: 'Mandados', icon: '⌕' },
  { label: 'Consultas', icon: '⌘' },
  { label: 'Configurações', icon: '⚙' },
];

function Metric({ label, value, detail }) {
  return (
    <article className="react-metric">
      <span className="react-metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export default function App() {
  return (
    <div className="react-shell">
      <aside className="react-sidebar">
        <div className="react-brand">
          <div className="react-brand-mark">CI</div>
          <div><strong>Cadastro de Indivíduos</strong><small>Sistema de consulta e gestão</small></div>
        </div>
        <nav aria-label="Navegação principal">
          <span className="react-nav-caption">MENU PRINCIPAL</span>
          {navigation.map((item) => (
            <button className={item.active ? 'react-nav-item active' : 'react-nav-item'} key={item.label} type="button">
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="react-sidebar-footer">Acesso restrito • Uso autorizado</div>
      </aside>

      <main className="react-main">
        <header className="react-topbar">
          <div><span className="react-eyebrow">ÁREA DE TRABALHO</span><strong>Painel inicial</strong></div>
          <div className="react-user"><span className="react-avatar">US</span><span><strong>Usuário do sistema</strong><small>Perfil autenticado</small></span></div>
        </header>
        <section className="react-content">
          <div className="react-page-heading">
            <div><span className="react-eyebrow">VISÃO GERAL</span><h1>Bem-vindo ao sistema</h1><p>Acesse os módulos e ferramentas de consulta.</p></div>
            <span className="react-status">Ambiente de demonstração</span>
          </div>
          <div className="react-metrics">
            <Metric label="Indivíduos cadastrados" value="—" detail="Indicador será conectado ao Supabase" />
            <Metric label="Veículos cadastrados" value="—" detail="Indicador será conectado ao Supabase" />
            <Metric label="Mandados registrados" value="—" detail="Indicador será conectado ao Supabase" />
          </div>
          <section className="react-panel">
            <div><span className="react-eyebrow">ACESSO RÁPIDO</span><h2>Módulos do sistema</h2><p>Os módulos serão migrados individualmente, mantendo os recursos atuais.</p></div>
            <div className="react-module-grid">
              {navigation.slice(1, 5).map((item) => <button type="button" className="react-module" key={item.label}><span>{item.icon}</span><strong>{item.label}</strong><small>A migração deste módulo será realizada em etapa própria.</small></button>)}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
