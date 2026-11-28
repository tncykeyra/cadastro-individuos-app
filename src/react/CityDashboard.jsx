import React from 'react';
import Button from './ui/Button.jsx';
import './city-dashboard.css';

const number = (value) => value === null || value === undefined ? '—' : Number(value || 0).toLocaleString('pt-BR');
const percent = (value, total) => Number(total) > 0 ? Math.min(100, Math.round((Number(value || 0) / Number(total)) * 100)) : 0;

function Icon({ type }) {
  const paths = {
    people: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19v-1.2a5.5 5.5 0 0 1 11 0V19"/><path d="M16 5.5a3 3 0 0 1 0 5.8M17 14a4.5 4.5 0 0 1 3.5 4.4V19"/></>,
    photo: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></>,
    vehicle: <><path d="m4 11 1.6-4.2A2 2 0 0 1 7.5 5.5h9a2 2 0 0 1 1.9 1.3L20 11"/><path d="M3 11h18v6H3zM6 17v2m12-2v2M6 14h.01M18 14h.01"/></>,
    warrant: <><path d="M12 3 19 6v5c0 4.5-2.8 7.7-7 10-4.2-2.3-7-5.5-7-10V6z"/><path d="m9 12 2 2 4-4"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6"/></>,
    file: <><path d="M7 3.5h7l4 4V20H7z"/><path d="M14 3.5V8h4M10 12h5m-5 3h5"/></>,
  };
  return <svg className="city-react-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type] || paths.file}</svg>;
}

function Metric({ icon, label, value, detail, onClick }) {
  const Tag = onClick ? 'button' : 'article';
  return <Tag className={'city-react-metric' + (onClick ? ' is-action' : '')} onClick={onClick || undefined} type={onClick ? 'button' : undefined}>
    <div className="city-react-metric-top"><span className="city-react-metric-icon"><Icon type={icon}/></span><span className="city-react-kicker">INDICADOR</span></div>
    <span className="city-react-metric-label">{label}</span><strong>{number(value)}</strong><small>{detail}</small>
  </Tag>;
}

export default function CityDashboard({
  cityName, roleLabel, stats, photoStats, pendingIdentityCount, pendingVehiclePlateCount,
  busy = false, error = '', onRefresh, onNavigate, onSwitchClassic,
}) {
  const coverage = percent(stats?.cpf, stats?.people);
  const shortcuts = [
    { key: 'people', icon: 'people', title: 'Indivíduos', description: 'Pesquisar cadastros' },
    { key: 'vehicles', icon: 'vehicle', title: 'Veículos', description: 'Consultar registros' },
    { key: 'warrants', icon: 'warrant', title: 'Mandados', description: 'Consultar mandados ativos' },
  ];
  return <div className="city-react-dashboard">
    <section className="city-react-welcome">
      <div><span className="city-react-welcome-eyebrow">UNIDADE ATIVA</span><h1>{cityName || 'Cidade ativa'}</h1><p>Painel de acompanhamento dos registros vinculados a esta cidade.</p></div>
      <div className="city-react-role"><span>PERFIL DE ACESSO</span><strong>{roleLabel || 'Acesso autorizado'}</strong></div>
    </section>

    {error && <div className="city-react-error" role="alert">{error}</div>}

    <div className="city-react-heading">
      <div><span className="city-react-eyebrow">VISÃO GERAL</span><h2>Resumo operacional</h2><p>Indicadores dos registros ativos da unidade.</p></div>
      <Button className="city-react-refresh" type="button" onClick={onRefresh} disabled={busy}><Icon type="refresh"/>{busy ? 'Atualizando…' : 'Atualizar dados'}</Button>
    </div>

    <div className="city-react-metrics">
      <Metric icon="people" label="Indivíduos cadastrados" value={stats?.people} detail="Registros ativos na cidade" onClick={() => onNavigate('people')}/>
      <Metric icon="photo" label="Indivíduos com foto" value={photoStats?.complete ? photoStats.count : null} detail="Fotos vinculadas aos cadastros" onClick={() => onNavigate('people')}/>
      <Metric icon="vehicle" label="Veículos cadastrados" value={stats?.vehicles} detail="Registros ativos na cidade" onClick={() => onNavigate('vehicles')}/>
      <Metric icon="warrant" label="Mandados ativos" value={stats?.warrants} detail="Contagem pelo procedimento atual" onClick={() => onNavigate('warrants')}/>
    </div>

    <div className="city-react-lower-grid">
      <section className="city-react-panel">
        <div className="city-react-panel-heading"><div><span className="city-react-eyebrow">QUALIDADE CADASTRAL</span><h2>Preenchimento de CPF</h2></div><span className="city-react-pill">{stats?.cpf === null || stats?.cpf === undefined ? '—' : number(stats.cpf) + ' de ' + number(stats.people || 0)}</span></div>
        <div className="city-react-coverage"><strong>{stats?.people === null || stats?.people === undefined ? '—' : coverage + '%'}</strong><span>dos indivíduos ativos possuem CPF informado</span></div>
        <div className="city-react-progress" role="progressbar" aria-label="Percentual de indivíduos com CPF informado" aria-valuemin="0" aria-valuemax="100" aria-valuenow={stats?.people == null ? 0 : coverage}><span style={{width: coverage + '%'}}/></div>
        <p className="city-react-muted">{stats?.people == null ? 'Aguardando consulta dos indicadores.' : stats.people === 0 ? 'Ainda não há indivíduos ativos cadastrados.' : 'Percentual calculado com os registros ativos da cidade.'}</p>
        <div className="city-react-secondary-stats"><div><span>Com CPF</span><strong>{number(stats?.cpf)}</strong></div><div><span>Sem CPF informado</span><strong>{stats?.people == null || stats?.cpf == null ? '—' : number(Math.max(0, stats.people - stats.cpf))}</strong></div></div>
      </section>

      <section className="city-react-panel">
        <div className="city-react-panel-heading"><div><span className="city-react-eyebrow">NAVEGAÇÃO</span><h2>Acesso rápido</h2></div></div>
        <div className="city-react-shortcuts">{shortcuts.map(item => <Button key={item.key} className="city-react-shortcut" type="button" onClick={() => onNavigate(item.key)}><span className="city-react-shortcut-icon"><Icon type={item.icon}/></span><span><strong>{item.title}</strong><small>{item.description}</small></span><Icon type="arrow"/></Button>)}</div>
      </section>
    </div>

    {(Number(pendingIdentityCount) > 0 || Number(pendingVehiclePlateCount) > 0) && <section className="city-react-alerts" aria-label="Pendências administrativas">
      {Number(pendingIdentityCount) > 0 && <Button type="button" onClick={() => onNavigate('team','identity')}><span>!</span><span><strong>Sugestões de nome e CPF</strong><small>{number(pendingIdentityCount)} aguardando revisão administrativa</small></span><Icon type="arrow"/></Button>}
      {Number(pendingVehiclePlateCount) > 0 && <Button type="button" onClick={() => onNavigate('team','identity')}><span>!</span><span><strong>Sugestões de placa de veículo</strong><small>{number(pendingVehiclePlateCount)} aguardando revisão administrativa</small></span><Icon type="arrow"/></Button>}
    </section>}

    <footer className="city-react-footer"><span>Os indicadores respeitam a cidade ativa e as permissões da sessão autenticada.</span><Button type="button" onClick={onSwitchClassic}>Voltar ao painel clássico</Button></footer>
  </div>;
}
