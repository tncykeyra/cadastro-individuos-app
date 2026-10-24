# Cadastro protegido (PWA)

Aplicativo web responsivo para cadastro e pesquisa de indivíduos e veículos, com vínculos entre eles. Pode ser instalado no celular e no computador após publicação em HTTPS.

## O que está preparado

- Login por e-mail e senha; redefinição e senha inicial por convite.
- Perfis `admin`, `operator`, `pending` e `disabled`. Novas contas ficam pendentes até aprovação.
- Cadastro de pessoas, veículos e vínculos muitos-para-muitos (proprietário, condutor ou associado).
- Busca por nome, CPF, RG, matrícula, apelido, endereço, anotações, placa, marca, modelo, cor e pessoas/veículos associados.
- Operadores podem criar e atualizar registros e vínculos. O banco não concede permissão para apagar registros. Só o administrador arquiva/restaura.
- Histórico de versões anteriores e atuais. Só administradores podem consultar e restaurar uma versão; a restauração também gera um novo evento.
- Fotos ficam em bucket privado. O service worker guarda somente arquivos da interface; respostas do banco não são armazenadas offline.

## Configurar o Supabase

1. Crie um projeto Supabase e escolha **South America (São Paulo), `sa-east-1`**, se disponível para esse projeto.
2. No **SQL Editor**, execute `supabase/migrations/001_secure_core.sql`. Isso cria tabelas, perfis, associações, pesquisa, políticas RLS, bucket privado, auditoria e reversão.
3. Em **Authentication → Providers → Email**, deixe o cadastro público desativado. Convide somente pessoas autorizadas. Configure Site URL e Redirect URLs para o endereço HTTPS do app. Use a maior exigência de senha disponível (mínimo de 12 caracteres) e habilite MFA para administradores antes de usar dados reais.
4. Em **Authentication → Users**, convide `cykeyra@hotmail.com`. Ao abrir o convite, o administrador cria a própria senha. O perfil começa pendente.
5. Depois que o convite criar esse perfil, rode uma vez no SQL Editor para dar ao primeiro usuário o perfil de administrador:

   ```sql
   update public.profiles
   set role = 'admin', updated_at = now()
   where lower(email) = lower('cykeyra@hotmail.com');
   ```

6. No app, administradores gerenciam acessos na tela **Usuários**: **Cadastrar e-mail** envia um convite para a pessoa definir a senha; **Cadastrar sem convite** cria a conta com senha provisória e obriga a troca no primeiro acesso. Depois, aprove o perfil como **Operador**.
7. Para publicar automaticamente a função de usuários, adicione o secret `SUPABASE_ACCESS_TOKEN` nas configurações de Actions do GitHub. O fluxo `.github/workflows/deploy-supabase-users.yml` publica a função ao atualizar seu código. O convite por e-mail exige que o provedor SMTP do Supabase consiga enviar mensagens; se falhar, o app oferece um link de uso único ou o cadastro sem convite.
8. Execute uma vez os arquivos `supabase/migrations/004_admin_only_person_name.sql` e `supabase/migrations/005_search_name_tokens.sql` no SQL Editor do projeto para aplicar a regra de nomes e a busca por todas as partes do nome.
9. Copie a Project URL e a chave **publishable** (ou a chave pública anon legada) para um arquivo local `.env`, usando `.env.example` como modelo. Nunca coloque uma chave `service_role` ou secret no navegador, no GitHub ou neste projeto.

## Publicar no GitHub Pages

O workflow `.github/workflows/deploy-pages.yml` compila o app e publica só os arquivos estáticos. Ele não tenta criar nem alterar workflows via `GITHUB_TOKEN`.

1. Crie o repositório GitHub `cadastro-individuos-app` e envie estes arquivos para a branch `main`.
2. Em **Settings → Secrets and variables → Actions**, crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com a URL e a chave pública do projeto.
3. Em **Settings → Pages**, escolha **GitHub Actions** como origem. O próximo push em `main` inicia a publicação.
4. Depois da primeira publicação, configure `https://SEU-USUARIO.github.io/cadastro-individuos-app/` como Site URL e Redirect URL no Supabase.
5. Acesse o endereço HTTPS no celular ou computador e escolha ‘Instalar aplicativo’ ou ‘Adicionar à tela inicial’ no navegador.

Não há dados fictícios ou dados dos prints no banco. O site contém apenas a interface e pode ser público; os registros continuam protegidos por login e regras do banco.

## Rodar localmente

Requer Node.js 20 ou superior. Copie `.env.example` para `.env`, preencha as duas variáveis públicas, e execute `npm install` e `npm run dev`. O app não funciona aberto por `file://`; use o servidor local ou HTTPS.

## Antes de usar dados reais

Os prints contêm CPF, endereços, fotos e informações sobre ocorrências. Não cadastre dados reais até que o responsável confirme finalidade, autorização de tratamento, retenção, correção e eliminação. A LGPD prevê um regime específico para dados tratados exclusivamente para segurança pública/investigação penal e impõe condições ao tratamento privado; confirme o enquadramento com a área jurídica ou encarregado antes de operar a base real.
