// Seção de testes automatizados incorporada à Manutenção Inteligente.
// Somente consulta o GitHub Actions. Não acessa o Supabase nem usa credenciais GitHub no navegador.
const WORKFLOW_URL='https://github.com/tncykeyra/cadastro-individuos-app/actions/workflows/testes-automatizados.yml';
const API_URL='https://api.github.com/repos/tncykeyra/cadastro-individuos-app/actions/workflows/testes-automatizados.yml/runs?branch=main&per_page=1';

export function renderSystemTestsPanel(){
  return `
    <section class="maintenance-panel maintenance-test-suite" id="maintenanceTestSuite" aria-labelledby="maintenanceTestSuiteTitle">
      <div class="maintenance-panel-head">
        <div>
          <span class="maintenance-eyebrow">QUALIDADE DO APLICATIVO</span>
          <h2 id="maintenanceTestSuiteTitle">Testes automatizados</h2>
          <p>Validação do código e da compilação, separada do diagnóstico de acessos e integrações acima.</p>
        </div>
        <span id="maintenanceTestSuiteBadge" class="maintenance-status unknown"><i aria-hidden="true"></i>Consultando</span>
      </div>
      <div class="maintenance-overview" style="margin:16px 0">
        <article class="maintenance-overview-card" id="maintenanceTestSuiteResult">
          <span class="maintenance-overview-icon" id="maintenanceTestSuiteIcon" aria-hidden="true">…</span>
          <div>
            <small>Última execução na branch main</small>
            <strong id="maintenanceTestSuiteStatus">Consultando GitHub Actions…</strong>
            <small id="maintenanceTestSuiteMessage">Aguarde a consulta do resultado.</small>
          </div>
        </article>
      </div>
      <div class="maintenance-checks" style="margin-top:12px">
        <article class="maintenance-check">
          <span class="maintenance-check-icon" aria-hidden="true">✓</span>
          <div><strong>Testes automatizados</strong><small>Executa a suíte definida no projeto.</small></div>
        </article>
        <article class="maintenance-check">
          <span class="maintenance-check-icon" aria-hidden="true">✓</span>
          <div><strong>Compilação do aplicativo</strong><small>Confere se o pacote de produção pode ser gerado.</small></div>
        </article>
      </div>
      <div class="maintenance-panel-head" style="margin-top:16px">
        <div>
          <p id="maintenanceTestSuiteMeta" class="muted">Data: — · Commit: —</p>
        </div>
      </div>
      <div class="maintenance-actions" style="margin-top:12px">
        <a class="button" href="${WORKFLOW_URL}" target="_blank" rel="noopener noreferrer">▶ Rodar testes agora</a>
        <a id="maintenanceTestSuiteLastRun" class="button secondary" href="${WORKFLOW_URL}" target="_blank" rel="noopener noreferrer">Ver última execução</a>
        <a class="button secondary" href="${WORKFLOW_URL}" target="_blank" rel="noopener noreferrer">Histórico</a>
      </div>
      <p class="maintenance-safety">Para iniciar, o GitHub solicitará uma conta autorizada: selecione a branch main e confirme “Run workflow”. A aprovação da suíte não substitui testes funcionais completos de todas as telas e operações.</p>
    </section>
  `;
}

export async function refreshSystemTestsPanel({isMasterAdmin}={}){
  if(typeof isMasterAdmin!=='function'||!isMasterAdmin())return;
  const root=document.querySelector('#maintenanceTestSuite');
  if(!root)return;
  const status=root.querySelector('#maintenanceTestSuiteStatus');
  const message=root.querySelector('#maintenanceTestSuiteMessage');
  const badge=root.querySelector('#maintenanceTestSuiteBadge');
  const icon=root.querySelector('#maintenanceTestSuiteIcon');
  const meta=root.querySelector('#maintenanceTestSuiteMeta');
  const lastRun=root.querySelector('#maintenanceTestSuiteLastRun');
  try{
    const response=await fetch(API_URL,{headers:{Accept:'application/vnd.github+json'},cache:'no-store'});
    if(!response.ok)throw new Error('GitHub Actions HTTP '+response.status);
    const data=await response.json();
    const run=data.workflow_runs?.[0];
    if(!root.isConnected||!isMasterAdmin())return;
    if(!run){
      status.textContent='Nenhuma execução localizada';
      message.textContent='Ainda não há execução registrada na branch main.';
      badge.innerHTML='<i aria-hidden="true"></i>Sem execução';
      icon.textContent='!';
      meta.textContent='Data: — · Commit: —';
      return;
    }
    const complete=run.status==='completed';
    const approved=complete&&run.conclusion==='success';
    const failed=complete&&run.conclusion!=='success';
    status.textContent=approved?'TESTES APROVADOS':failed?'VALIDAÇÃO NÃO APROVADA':'TESTES EM ANDAMENTO';
    message.textContent=approved?'A suíte automatizada e a compilação terminaram sem erros.':failed?'A execução terminou com resultado '+(run.conclusion||'indefinido')+'. Consulte o relatório.':'O GitHub Actions ainda está executando as verificações.';
    badge.className='maintenance-status '+(approved?'good':failed?'attention':'unknown');
    badge.innerHTML='<i aria-hidden="true"></i>'+(approved?'Aprovado':failed?'Atenção':'Em andamento');
    icon.textContent=approved?'✓':failed?'!':'…';
    meta.textContent='Data: '+(run.created_at?new Date(run.created_at).toLocaleString('pt-BR'):'não informada')+' · Commit: '+String(run.head_sha||'').slice(0,7);
    if(typeof run.html_url==='string'&&run.html_url.startsWith('https://github.com/tncykeyra/cadastro-individuos-app/actions/runs/'))lastRun.href=run.html_url;
  }catch(error){
    if(!root.isConnected)return;
    status.textContent='Status indisponível';
    message.textContent='Não foi possível consultar o GitHub Actions. Use o histórico para conferir manualmente.';
    badge.className='maintenance-status unknown';
    badge.innerHTML='<i aria-hidden="true"></i>Consulta indisponível';
    icon.textContent='!';
  }
}
