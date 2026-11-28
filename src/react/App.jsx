import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseConfigured } from './supabase.js';
import { renderVehicleInterestPage, wireVehicleInterestActions } from '../vehicle-interest.js';
import { renderFiscalizationPage, wireFiscalizationActions } from '../fiscalization.js';
import './react.css';

const number = (value) => Number(value || 0).toLocaleString('pt-BR');
const date = (value) => value ? new Date(value + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const cleanError = (error) => error?.message || 'Não foi possível concluir a operação. Tente novamente.';

function Brand() {
  return <div className="react-brand"><div className="react-brand-mark">CI</div><div><strong>Cadastro de Indivíduos</strong><small>Consulta e gestão operacional</small></div></div>;
}

function Login({ onLogin, busy, error }) {
  return (
    <main className="react-auth-page">
      <section className="react-auth-card">
        <Brand />
        <span className="react-eyebrow">ACESSO RESTRITO</span>
        <h1>Entre no sistema</h1>
        <p>Use a mesma conta Google autorizada no aplicativo atual.</p>
        {error && <div className="react-alert error" role="alert">{error}</div>}
        <button className="react-primary react-login-button" type="button" onClick={onLogin} disabled={busy}>
          <span aria-hidden="true">G</span>{busy ? 'Conectando…' : 'Continuar com Google'}
        </button>
        <small className="react-auth-foot">Acesso protegido pelas permissões já configuradas no Supabase.</small>
      </section>
    </main>
  );
}

function DashboardIcon({ name }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const drawings = {
    people: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19v-1.2a5.5 5.5 0 0 1 11 0V19" /><path d="M16 5.5a3 3 0 0 1 0 5.8M17 14a4.5 4.5 0 0 1 3.5 4.4V19" /></>,
    vehicle: <><path d="m4 11 1.6-4.2A2 2 0 0 1 7.5 5.5h9a2 2 0 0 1 1.9 1.3L20 11" /><path d="M3 11h18v6H3zM6 17v2m12-2v2M6 14h.01M18 14h.01" /></>,
    document: <><path d="M7 3.5h7l4 4V20H7z" /><path d="M14 3.5V8h4M10 12h5m-5 3h5" /></>,
    shield: <><path d="M12 3 19 6v5c0 4.5-2.8 7.7-7 10-4.2-2.3-7-5.5-7-10V6z" /><path d="m9 12 2 2 4-4" /></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3" /></>,
  };
  return <svg className="react-dashboard-icon" viewBox="0 0 24 24" aria-hidden="true" {...common}>{drawings[name] || drawings.document}</svg>;
}

function Metric({ icon, label, value, detail }) {
  return (
    <article className="react-metric">
      <div className="react-metric-top"><span className="react-metric-icon"><DashboardIcon name={icon} /></span><span className="react-metric-kicker">INDICADOR</span></div>
      <span className="react-metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function EmptyState({ title, detail }) {
  return <div className="react-empty"><strong>{title}</strong><span>{detail}</span></div>;
}


function LegacyFeature({ page, activeCity, session, isAdmin }) {
  useEffect(() => {
    const root = document.querySelector('#mainContent');
    if (!root || !supabase || !activeCity?.id) return undefined;
    let alive = true;
    const resolvePhoto = async (path) => {
      if (!path) return '';
      const { data, error } = await supabase.storage.from('people-photos').createSignedUrl(path, 3600);
      return error ? '' : data?.signedUrl || '';
    };
    const loadVehicleInterest = async () => {
      const markup = await renderVehicleInterestPage(supabase, {
        cityId: activeCity.id, cityName: activeCity.name || '', userId: session.user.id, resolvePhoto,
      });
      if (!alive) return;
      root.innerHTML = markup;
      wireVehicleInterestActions(supabase, {
        cityId: activeCity.id, cityName: activeCity.name || '', userId: session.user.id, resolvePhoto,
        onRefresh: loadVehicleInterest,
      });
    };
    const loadFiscalization = async () => {
      const markup = await renderFiscalizationPage(supabase, isAdmin);
      if (alive) root.innerHTML = markup;
    };
    const start = async () => {
      try {
        if (page === 'vehicleInterest') await loadVehicleInterest();
        if (page === 'fiscalization') {
          await loadFiscalization();
          if (alive) wireFiscalizationActions(supabase, () => isAdmin, loadFiscalization, (message) => window.alert(message));
        }
      } catch (featureError) {
        if (alive) root.innerHTML = '<div class="react-alert error" role="alert">' + String(featureError?.message || 'Não foi possível carregar este módulo.') + '</div>';
      }
    };
    void start();
    return () => {
      alive = false;
      root.__vehicleInterestAbort?.abort?.();
      document.__fiscalizationAbort?.abort?.();
      root.replaceChildren();
    };
  }, [page, activeCity?.id, activeCity?.name, session?.user?.id, isAdmin]);
  return <div id="mainContent" className="react-legacy-host" aria-live="polite"><p className="react-loading-inline">Carregando módulo…</p></div>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [cities, setCities] = useState([]);
  const [activeCity, setActiveCity] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accessBlocked, setAccessBlocked] = useState(false);
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ people: null, cpf: null, vehicles: null, warrants: null });
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('cadastro-criminal-appearance-v1') || 'light'; } catch { return 'light'; }
  });

  const isAdmin = ['admin', 'master'].includes(activeCity?.role) || ['admin', 'master'].includes(profile?.role);
  const displayName = profile?.display_name || session?.user?.user_metadata?.full_name || session?.user?.email || 'Usuário';
  const effectiveRole = ['master', 'admin'].includes(profile?.role) ? profile.role : activeCity?.role;
  const roleLabel = ({ operator: 'Operador', admin: 'Administrador', master: 'Master' })[effectiveRole] || 'Acesso autorizado';

  const loadUser = useCallback(async (currentSession) => {
    setLoading(true);
    setError('');
    setAccessBlocked(false);
    setSession(currentSession || null);
    setProfile(null);
    setCities([]);
    setActiveCity(null);
    setSelected(null);
    setRecords([]);
    if (!currentSession?.user?.id) {
      setLoading(false);
      return;
    }
    try {
      const profileResult = await supabase.from('profiles')
        .select('id,email,display_name,role')
        .eq('id', currentSession.user.id)
        .single();
      if (profileResult.error) throw profileResult.error;
      const userProfile = profileResult.data;
      setProfile(userProfile);
      if (['pending', 'disabled'].includes(userProfile.role)) {
        setError(userProfile.role === 'pending'
          ? 'Sua conta ainda aguarda autorização do administrador.'
          : 'O acesso desta conta está desativado.');
        setAccessBlocked(true);
        setLoading(false);
        return;
      }
      const cityResult = await supabase.rpc('list_my_cities');
      if (cityResult.error) throw cityResult.error;
      let userCities = cityResult.data || [];
      if (!userCities.length) throw new Error('Sua conta ainda não está vinculada a uma cidade.');
      let currentCity = userCities.find((city) => city.active);
      if (!currentCity) {
        currentCity = userCities[0];
        const changed = await supabase.rpc('set_active_city', { p_city_id: currentCity.id });
        if (changed.error) throw changed.error;
        userCities = userCities.map((city) => ({ ...city, active: city.id === currentCity.id }));
      }
      if (!['operator', 'admin', 'master'].includes(currentCity.role) && !['admin', 'master'].includes(userProfile.role)) {
        throw new Error('Sua conta não possui perfil operacional autorizado nesta cidade.');
      }
      setCities(userCities);
      setActiveCity(currentCity);
    } catch (loadError) {
      setError(cleanError(loadError));
      setAccessBlocked(true);
      setProfile(null);
      setCities([]);
      setActiveCity(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return undefined; }
    let alive = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!alive) return;
      if (sessionError) setError(cleanError(sessionError));
      void loadUser(data?.session || null);
    });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!alive || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      setTimeout(() => { if (alive) void loadUser(nextSession); }, 0);
    });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, [loadUser]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('cadastro-criminal-appearance-v1', theme); } catch { /* armazenamento opcional */ }
  }, [theme]);

  const loadDashboard = useCallback(async () => {
    if (!activeCity?.id) return;
    setBusy(true);
    setError('');
    const [people, cpf, vehicles, warrants] = await Promise.all([
      supabase.from('people').select('id', { count: 'exact', head: true }).eq('city_id', activeCity.id).is('archived_at', null),
      supabase.from('people').select('id', { count: 'exact', head: true }).eq('city_id', activeCity.id).is('archived_at', null).not('cpf_digits', 'is', null).neq('cpf_digits', ''),
      supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('city_id', activeCity.id).is('archived_at', null),
      supabase.rpc('count_active_arrest_warrants'),
    ]);
    const failed = [people, cpf, vehicles, warrants].find((result) => result.error);
    if (failed) setError(cleanError(failed.error));
    else setStats({ people: people.count, cpf: cpf.count, vehicles: vehicles.count, warrants: warrants.data });
    setBusy(false);
  }, [activeCity]);

  const loadRecords = useCallback(async (kind, term) => {
    if (!activeCity?.id) return;
    setBusy(true);
    setError('');
    setSelected(null);
    try {
      let result;
      if (term.trim()) {
        result = await supabase.rpc(kind === 'people' ? 'search_people_list' : 'search_vehicles_list', {
          search_term: term.trim(),
          result_limit: 100,
        });
      } else {
        const columns = kind === 'people'
          ? 'id,full_name,cpf_digits,rg,alias,photo_path'
          : 'id,plate,make,model,color,photo_path';
        result = await supabase.from(kind).select(columns)
          .eq('city_id', activeCity.id).is('archived_at', null)
          .order(kind === 'people' ? 'full_name' : 'plate').limit(50);
      }
      if (result.error) throw result.error;
      setRecords(result.data || []);
    } catch (loadError) {
      setRecords([]);
      setError(cleanError(loadError));
    } finally {
      setBusy(false);
    }
  }, [activeCity]);

  useEffect(() => {
    if (!session || !activeCity) return;
    if (page === 'dashboard') void loadDashboard();
    if (page === 'people' || page === 'vehicles') void loadRecords(page, search);
  }, [session, activeCity, page, loadDashboard, loadRecords]);

  useEffect(() => {
    if (!session || !activeCity || !['people', 'vehicles'].includes(page)) return undefined;
    const timer = setTimeout(() => void loadRecords(page, search), 300);
    return () => clearTimeout(timer);
  }, [search, page, session, activeCity, loadRecords]);

  const openDetail = async (id) => {
    setBusy(true);
    setError('');
    try {
      const kind = page === 'people' ? 'people' : 'vehicles';
      const columns = kind === 'people'
        ? 'id,full_name,cpf_digits,rg,registration,alias,birthday,address_primary,address_secondary,notes,occurrence_notes,occurrence_reference,created_at'
        : 'id,plate,make,model,color,notes,created_at';
      const result = await supabase.from(kind).select(columns).eq('id', id).eq('city_id', activeCity.id).is('archived_at', null).single();
      if (result.error) throw result.error;
      setSelected({ kind, data: result.data });
    } catch (detailError) {
      setError(cleanError(detailError));
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    if (!supabase) return;
    setBusy(true);
    setError('');
    const { error: loginError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname, queryParams: { prompt: 'select_account' } },
    });
    if (loginError) { setError(cleanError(loginError)); setBusy(false); }
  };

  const changeCity = async (cityId) => {
    if (!cityId || cityId === activeCity?.id) return;
    setBusy(true);
    const { error: cityError } = await supabase.rpc('set_active_city', { p_city_id: cityId });
    if (cityError) setError(cleanError(cityError));
    else {
      const city = cities.find((item) => item.id === cityId);
      setActiveCity(city);
      setSelected(null);
      setPage('dashboard');
      setSearch('');
    }
    setBusy(false);
  };

  const visibleRecords = useMemo(() => records, [records]);
  const cpfCoverage = stats.people > 0 && stats.cpf !== null ? Math.min(100, Math.round((stats.cpf / stats.people) * 100)) : 0;

  if (!supabaseConfigured) {
    return <main className="react-auth-page"><section className="react-auth-card"><Brand /><span className="react-eyebrow">CONFIGURAÇÃO NECESSÁRIA</span><h1>Conecte o Supabase</h1><p>Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente de execução. Use somente a chave pública publishable/anon.</p><div className="react-alert">Nenhuma chave foi incluída no código. A versão React ainda não está conectada.</div></section></main>;
  }
  if (loading) return <main className="react-auth-page"><section className="react-auth-card"><Brand /><p>Validando sua sessão e suas permissões…</p></section></main>;
  if (accessBlocked) return <main className="react-auth-page"><section className="react-auth-card"><Brand /><span className="react-eyebrow">ACESSO NÃO LIBERADO</span><h1>Não foi possível acessar</h1><div className="react-alert error" role="alert">{error}</div><button className="react-primary react-login-button" type="button" onClick={() => void supabase.auth.signOut()}>Sair da conta</button></section></main>;
  if (!session || !activeCity) return <Login onLogin={login} busy={busy} error={error} />;

  return (
    <div className="react-shell">
      <aside className="react-sidebar">
        <Brand />
        <nav aria-label="Navegação principal">
          <span className="react-nav-caption">MENU PRINCIPAL</span>
          <button className={'react-nav-item ' + (page === 'dashboard' ? 'active' : '')} onClick={() => { setPage('dashboard'); setSelected(null); }}><span>▦</span>Painel da cidade</button>
          <button className={'react-nav-item ' + (page === 'people' ? 'active' : '')} onClick={() => { setPage('people'); setSelected(null); setSearch(''); }}><span>♙</span>Indivíduos</button>
          <button className={'react-nav-item ' + (page === 'vehicles' ? 'active' : '')} onClick={() => { setPage('vehicles'); setSelected(null); setSearch(''); }}><span>⌑</span>Veículos</button>
          <button className={'react-nav-item ' + (page === 'vehicleInterest' ? 'active' : '')} onClick={() => { setPage('vehicleInterest'); setSelected(null); }}><span>🚘</span>Veículos de interesse</button>
          {activeCity.id === '10000000-0000-4000-8000-000000000001' && <button className={'react-nav-item ' + (page === 'fiscalization' ? 'active' : '')} onClick={() => { setPage('fiscalization'); setSelected(null); }}><span>🚦</span>Fiscalização</button>}
          <button className="react-nav-item" disabled title="Próxima etapa da migração"><span>⚖</span>Mandados <small>em migração</small></button>
          <button className="react-nav-item" disabled title="Próxima etapa da migração"><span>✦</span>Cadastro inteligente <small>em migração</small></button>
          {isAdmin && <><button className="react-nav-item" disabled title="Próxima etapa da migração"><span>⌕</span>Revisão inteligente <small>em migração</small></button><button className="react-nav-item" disabled title="Próxima etapa da migração"><span>↺</span>Histórico <small>em migração</small></button><button className="react-nav-item" disabled title="Próxima etapa da migração"><span>♧</span>Usuários <small>em migração</small></button></>}
          {profile?.role === 'master' && <button className="react-nav-item" disabled title="Próxima etapa da migração"><span>⌖</span>Cidades e acessos <small>em migração</small></button>}
        </nav>
        <div className="react-sidebar-footer">Acesso restrito · Uso autorizado</div>
      </aside>

      <main className="react-main">
        <header className="react-topbar">
          <div><span className="react-eyebrow">ÁREA DE TRABALHO</span><strong>{{ dashboard: 'Painel da cidade', people: 'Indivíduos', vehicles: 'Veículos', vehicleInterest: 'Veículos de interesse', fiscalization: 'Fiscalização' }[page] || 'Cadastro de Indivíduos'}</strong></div>
          <div className="react-top-actions">
            {cities.length > 1 && <select aria-label="Cidade ativa" value={activeCity.id} onChange={(event) => void changeCity(event.target.value)} disabled={busy}>{cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select>}
            <button className="react-icon-button" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Alternar tema">{theme === 'dark' ? '☀' : '◐'}</button>
            <div className="react-user"><span className="react-avatar">{displayName.slice(0, 1).toUpperCase()}</span><span><strong>{displayName}</strong><small>{activeCity.name} · {activeCity.role}</small></span></div>
            <button className="react-logout" type="button" onClick={() => void supabase.auth.signOut()}>Sair</button>
          </div>
        </header>

        <section className="react-content">
          {error && <div className="react-alert error" role="alert">{error}</div>}
          <div className="react-page-heading">
            <div className="react-heading-copy"><span className="react-eyebrow">{page === 'dashboard' ? 'CENTRAL OPERACIONAL' : activeCity.name.toUpperCase()}</span><h1>{selected ? 'Detalhes do cadastro' : ({ dashboard: 'Painel da cidade', people: 'Indivíduos cadastrados', vehicles: 'Veículos cadastrados', vehicleInterest: 'Veículos de interesse', fiscalization: 'Materiais de fiscalização' }[page] || 'Cadastro de Indivíduos')}</h1><p>{page === 'dashboard' ? 'Acompanhe os principais indicadores e acesse os módulos da unidade.' : 'Consulta protegida pelo mesmo acesso do sistema atual.'}</p></div>
            {page === 'dashboard' && <button className="react-refresh-button" type="button" onClick={() => void loadDashboard()} disabled={busy} aria-busy={busy}><DashboardIcon name="refresh" />{busy ? 'Atualizando…' : 'Atualizar dados'}</button>}
          </div>

          {(page === 'vehicleInterest' || page === 'fiscalization') && <LegacyFeature page={page} activeCity={activeCity} session={session} isAdmin={isAdmin} />}
          {page === 'dashboard' && (
            <div className="react-dashboard">
              <section className="react-welcome">
                <div className="react-welcome-copy"><span className="react-welcome-eyebrow">UNIDADE ATIVA</span><h2>{activeCity.name}</h2><p>Painel de acompanhamento dos registros vinculados a esta cidade.</p></div>
                <div className="react-welcome-meta"><span>PERFIL DE ACESSO</span><strong>{roleLabel}</strong>{cities.length > 1 && <small>{cities.length} cidades disponíveis</small>}</div>
              </section>

              <div className="react-metrics">
                <Metric icon="people" label="Indivíduos cadastrados" value={stats.people === null ? '—' : number(stats.people)} detail="Registros ativos na cidade" />
                <Metric icon="document" label="Indivíduos com CPF" value={stats.cpf === null ? '—' : number(stats.cpf)} detail="CPF informado no cadastro" />
                <Metric icon="vehicle" label="Veículos cadastrados" value={stats.vehicles === null ? '—' : number(stats.vehicles)} detail="Registros ativos na cidade" />
                <Metric icon="shield" label="Mandados ativos" value={stats.warrants === null ? '—' : number(stats.warrants)} detail="Contagem pelo procedimento existente" />
              </div>

              <div className="react-dashboard-grid">
                <section className="react-panel react-coverage-panel">
                  <div className="react-section-heading"><div><span className="react-eyebrow">QUALIDADE CADASTRAL</span><h2>Preenchimento de CPF</h2></div><span className="react-count">{stats.cpf === null ? '—' : number(stats.cpf) + ' de ' + number(stats.people || 0)}</span></div>
                  <div className="react-coverage-value"><strong>{stats.people === null ? '—' : cpfCoverage + '%'}</strong><span>dos indivíduos ativos possuem CPF informado</span></div>
                  <div className="react-progress-track" role="progressbar" aria-label="Percentual de indivíduos com CPF informado" aria-valuemin="0" aria-valuemax="100" aria-valuenow={stats.people === null ? 0 : cpfCoverage}><span style={{ width: cpfCoverage + '%' }} /></div>
                  <p>{stats.people === null ? 'Aguardando consulta dos indicadores.' : stats.people === 0 ? 'Ainda não há indivíduos ativos cadastrados nesta cidade.' : 'Indicador calculado com os registros ativos da cidade.'}</p>
                </section>

                <section className="react-panel react-shortcuts-panel">
                  <div className="react-section-heading"><div><span className="react-eyebrow">NAVEGAÇÃO</span><h2>Acesso rápido</h2></div></div>
                  <div className="react-quick-grid">
                    <button className="react-quick-action" onClick={() => setPage('people')}><span className="react-quick-icon"><DashboardIcon name="people" /></span><span><strong>Indivíduos</strong><small>Pesquisar cadastros</small></span><DashboardIcon name="arrow" /></button>
                    <button className="react-quick-action" onClick={() => setPage('vehicles')}><span className="react-quick-icon"><DashboardIcon name="vehicle" /></span><span><strong>Veículos</strong><small>Consultar registros</small></span><DashboardIcon name="arrow" /></button>
                    <button className="react-quick-action" onClick={() => setPage('vehicleInterest')}><span className="react-quick-icon"><DashboardIcon name="shield" /></span><span><strong>Veículos de interesse</strong><small>Consultar módulo</small></span><DashboardIcon name="arrow" /></button>
                    {activeCity.id === '10000000-0000-4000-8000-000000000001' && <button className="react-quick-action" onClick={() => setPage('fiscalization')}><span className="react-quick-icon"><DashboardIcon name="document" /></span><span><strong>Fiscalização</strong><small>Acessar materiais</small></span><DashboardIcon name="arrow" /></button>}
                  </div>
                </section>
              </div>
              <p className="react-dashboard-footnote">Os indicadores respeitam a cidade ativa e as permissões da sessão autenticada.</p>
            </div>
          )}

          {(page === 'people' || page === 'vehicles') && !selected && <section className="react-panel"><div className="react-list-heading"><div><span className="react-eyebrow">PESQUISA</span><h2>{page === 'people' ? 'Localizar indivíduo' : 'Localizar veículo'}</h2></div><span className="react-count">{number(visibleRecords.length)} resultado(s)</span></div><input className="react-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={page === 'people' ? 'Nome, CPF, RG ou matrícula' : 'Placa, marca, modelo ou cor'} aria-label="Pesquisar registros" /><p className="react-helper">A pesquisa respeita a cidade ativa e as regras de acesso do banco.</p>{busy && <p className="react-loading-inline">Consultando…</p>}{!busy && visibleRecords.length === 0 && <EmptyState title="Nenhum registro encontrado" detail="Confira os termos da pesquisa ou tente novamente." />}{visibleRecords.length > 0 && <div className="react-record-list">{visibleRecords.map((record) => <button className="react-record-row" key={record.id} onClick={() => void openDetail(record.id)}><span className="react-record-avatar">{page === 'people' ? '♙' : '⌑'}</span><span className="react-record-copy"><strong>{page === 'people' ? record.full_name : record.plate}</strong><small>{page === 'people' ? ['CPF: ' + (record.cpf_digits || '—'), 'RG: ' + (record.rg || '—')].join(' · ') : [record.make, record.model, record.color].filter(Boolean).join(' · ') || 'Dados complementares não informados'}</small></span><span className="react-record-arrow">›</span></button>)}</div>}</section>}

          {selected && <section className="react-panel react-detail"><button className="react-back" onClick={() => setSelected(null)}>← Voltar à lista</button><span className="react-eyebrow">CONSULTA INDIVIDUAL</span><h2>{selected.kind === 'people' ? selected.data.full_name : selected.data.plate}</h2><div className="react-detail-grid">{Object.entries(selected.data).filter(([key, value]) => !['id', 'created_at'].includes(key) && value !== null && value !== '').map(([key, value]) => <div className="react-detail-field" key={key}><small>{({ full_name: 'Nome completo', cpf_digits: 'CPF', rg: 'RG', registration: 'Matrícula', alias: 'Apelido / vulgo', birthday: 'Nascimento', address_primary: 'Endereço principal', address_secondary: 'Endereço secundário', occurrence_notes: 'Crimes / anotações de ocorrência', occurrence_reference: 'Referência da ocorrência', notes: 'Anotações', plate: 'Placa', make: 'Marca', model: 'Modelo', color: 'Cor' })[key] || key}</small><strong>{key === 'birthday' ? date(value) : String(value)}</strong></div>)}</div><small className="react-detail-date">Cadastro criado em {selected.data.created_at ? new Date(selected.data.created_at).toLocaleString('pt-BR') : '—'}</small></section>}
          {!['vehicleInterest', 'fiscalization'].includes(page) && <p className="react-readonly-note">Etapa de consulta: esta interface não cria, edita, arquiva nem exclui registros.</p>}
        </section>
      </main>
    </div>
  );
}
