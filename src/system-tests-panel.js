// Painel de leitura da suíte CI. Sem acesso ao banco ou credenciais GitHub.
const WORKFLOW_URL='https://github.com/tncykeyra/cadastro-individuos-app/actions/workflows/testes-automatizados.yml';
const API_URL='https://api.github.com/repos/tncykeyra/cadastro-individuos-app/actions/workflows/testes-automatizados.yml/runs?branch=main&per_page=1';
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export async function renderSystemTests({frame,isMasterAdmin}){
  if(!isMasterAdmin())return;
  frame(`
    <section class="page-section system-tests-page">
      <header class="page-intro">
        <div>
          <p class="eyebrow">ADMINISTRADOR MASTER</p>
          <h1>Saúde do sistema</h1>
          <p class="muted">Acompanhamento da validação automatizada do aplicativo.</p>
        </div>
      </header>

      <section class="card" style="margin-top:18px;padding:clamp(18px,3vw,28px);border:1px solid var(--border-color,#e6e8e9);">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:18px">
          <span style="font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--text-muted,#687176)">RESULTADO DA ÚLTIMA EXECUÇÃO NA MAIN</span>
          <span id="systemTestsUpdated" class="muted" style="font-size:12px;margin-left:auto">Verificando…</span>
        </div>

        <div id="systemTestsHero" role="status" aria-live="polite" style="display:flex;align-items:center;gap:16px;padding:20px;border-radius:14px;background:var(--surface-secondary,#f6f7f7);border:1px solid var(--border-color,#e6e8e9)">
          <div id="systemTestsMark" aria-hidden="true" style="width:54px;height:54px;flex:0 0 54px;border-radius:50%;display:grid;place-items:center;background:#e8f5ec;color:#18743a;font-size:30px;font-weight:800">✓</div>
          <div style="min-width:0">
            <div id="systemTestsStatus" style="font-size:clamp(20px,3vw,27px);font-weight:800;line-height:1.2;color:var(--text-color,#30383c)">Consultando resultado…</div>
            <p id="systemTestsMessage" class="muted" style="margin:6px 0 0">Aguarde enquanto consultamos o GitHub Actions.</p>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-top:16px">
          <div style="padding:15px;border:1px solid var(--border-color,#e6e8e9);border-radius:12px">
            <div class="muted" style="font-size:12px;margin-bottom:6px">TESTES AUTOMATIZADOS</div>
            <div style="font-weight:700">Execução da suíte</div>
            <div class="muted" style="font-size:13px;margin-top:4px">Verificação das regras e funções cobertas pelos testes.</div>
          </div>
          <div style="padding:15px;border:1px solid var(--border-color,#e6e8e9);border-radius:12px">
            <div class="muted" style="font-size:12px;margin-bottom:6px">COMPILAÇÃO</div>
            <div style="font-weight:700">Build do aplicativo</div>
            <div class="muted" style="font-size:13px;margin-top:4px">Verificação de geração do pacote de produção.</div>
          </div>
        </div>

        <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border-color,#e6e8e9)">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
            <div><div class="muted" style="font-size:12px">DATA DA EXECUÇÃO</div><div id="systemTestsDate" style="font-weight:600;margin-top:4px">—</div></div>
            <div><div class="muted" style="font-size:12px">COMMIT VALIDADO</div><div id="systemTestsCommit" style="font-weight:600;margin-top:4px;font-family:monospace">—</div></div>
            <div><div class="muted" style="font-size:12px">BRANCH</div><div style="font-weight:600;margin-top:4px">main</div></div>
          </div>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px">
          <a id="systemTestsReport" class="button" href="${WORKFLOW_URL}" target="_blank" rel="noopener noreferrer">Ver execução no GitHub</a>
          <a class="button secondary" href="${WORKFLOW_URL}" target="_blank" rel="noopener noreferrer">Histórico de execuções</a>
        </div>
      </section>

      <p class="muted" style="font-size:12px;line-height:1.5;margin-top:14px">A aprovação confirma que os testes automatizados existentes e a compilação foram concluídos com sucesso. Ela não substitui testes funcionais de todas as telas, permissões, consultas e operações do sistema. Este painel é somente de leitura e não acessa nem altera registros do Supabase.</p>
    </section>
  `);

  const status=document.getElementById('systemTestsStatus');
  const message=document.getElementById('systemTestsMessage');
  const mark=document.getElementById('systemTestsMark');
  const hero=document.getElementById('systemTestsHero');
  const updated=document.getElementById('systemTestsUpdated');
  const dateEl=document.getElementById('systemTestsDate');
  const commitEl=document.getElementById('systemTestsCommit');
  const report=document.getElementById('systemTestsReport');
  try{
    const response=await fetch(API_URL,{headers:{Accept:'application/vnd.github+json'},cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json(),run=data.workflow_runs?.[0];
    if(!status?.isConnected||!isMasterAdmin())return;
    if(!run){
      status.textContent='Nenhuma execução localizada';
      message.textContent='Não encontramos uma execução na branch main.';
      mark.textContent='!';
      mark.style.background='#fff3df';mark.style.color='#8a5700';
      updated.textContent='Sem dados';
      return;
    }
    const completed=run.status==='completed';
    const approved=completed&&run.conclusion==='success';
    const failed=completed&&run.conclusion!=='success';
    status.textContent=approved?'TESTES APROVADOS':failed?'VALIDAÇÃO NÃO APROVADA':'VALIDAÇÃO EM ANDAMENTO';
    message.textContent=approved?'Os testes automatizados e a compilação foram concluídos sem erros.':failed?'A última execução terminou com resultado '+(run.conclusion||'indefinido')+'. Consulte o relatório para identificar o motivo.':'O GitHub Actions ainda está executando as verificações.';
    mark.textContent=approved?'✓':failed?'!':'…';
    mark.style.background=approved?'#e8f5ec':failed?'#fff0ed':'#fff3df';
    mark.style.color=approved?'#18743a':failed?'#a12b20':'#8a5700';
    hero.style.borderColor=approved?'#b9dfc5':failed?'#efc2bc':'#ead5a8';
    updated.textContent=approved?'CONCLUÍDO COM SUCESSO':failed?'EXECUÇÃO CONCLUÍDA':'EM EXECUÇÃO';
    dateEl.textContent=run.created_at?new Date(run.created_at).toLocaleString('pt-BR'):'Não informada';
    commitEl.textContent=String(run.head_sha||'').slice(0,7)||'—';
    if(run.html_url?.startsWith('https://github.com/tncykeyra/cadastro-individuos-app/actions/runs/'))report.href=run.html_url;
  }catch(error){
    if(status?.isConnected){
      status.textContent='Não foi possível consultar o resultado';
      message.textContent='A consulta ao GitHub Actions falhou. Use o link abaixo para verificar o status diretamente.';
      mark.textContent='!';
      mark.style.background='#fff3df';mark.style.color='#8a5700';
      updated.textContent='Consulta indisponível';
    }
  }
}
