// Painel de leitura da suíte CI. Sem acesso ao banco ou credenciais GitHub.
const WORKFLOW_URL='https://github.com/tncykeyra/cadastro-individuos-app/actions/workflows/testes-automatizados.yml';
const API_URL='https://api.github.com/repos/tncykeyra/cadastro-individuos-app/actions/workflows/testes-automatizados.yml/runs?branch=testes-automatizados&per_page=1';
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export async function renderSystemTests({frame,isMasterAdmin}){
  if(!isMasterAdmin())return;
  frame('<section class="page-section"><header class="page-intro"><div><p class="eyebrow">ADMINISTRADOR MASTER</p><h1>Suíte de testes</h1><p class="muted">Monitoramento dos testes automatizados no GitHub Actions, sem modificar cadastros ou dados do Supabase.</p></div></header><section class="card" style="padding:20px;margin-top:18px"><h2>Última execução na branch de testes</h2><p id="systemTestsStatus" role="status" aria-live="polite">Consultando GitHub Actions…</p><p id="systemTestsDetails" class="muted"></p><a class="button secondary" href="'+WORKFLOW_URL+'" target="_blank" rel="noopener noreferrer">Abrir GitHub Actions</a><p class="muted" style="margin-top:14px">A execução manual é feita no GitHub, com uma conta autorizada. Os testes atuais não executam no navegador. A branch main e a produção não são alteradas por este painel.</p></section></section>');
  const status=document.getElementById('systemTestsStatus'),details=document.getElementById('systemTestsDetails');
  try{
    const response=await fetch(API_URL,{headers:{Accept:'application/vnd.github+json'},cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json(),run=data.workflow_runs?.[0];
    if(!status?.isConnected||!isMasterAdmin())return;
    if(!run){status.textContent='Nenhuma execução encontrada na branch de testes.';return;}
    const result=run.status!=='completed'?'Em andamento':run.conclusion==='success'?'Aprovada':run.conclusion==='failure'?'Reprovada':'Concluída: '+(run.conclusion||'sem resultado');
    status.textContent='Resultado: '+result;
    const date=run.created_at?new Date(run.created_at).toLocaleString('pt-BR'):'não informada';
    details.textContent='Início: '+date+' · Commit: '+String(run.head_sha||'').slice(0,7);
    if(run.html_url?.startsWith('https://github.com/tncykeyra/cadastro-individuos-app/actions/runs/')){
      const link=document.createElement('a');link.href=run.html_url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Ver relatório detalhado';details.append(document.createTextNode(' · '),link);
    }
  }catch(error){if(status?.isConnected){status.textContent='Não foi possível consultar o status automaticamente.';details.textContent='Confira a execução diretamente no GitHub Actions. A consulta pública pode estar temporariamente indisponível.';}}
}
