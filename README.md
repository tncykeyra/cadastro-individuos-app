# Cadastro protegido (PWA)

Aplicativo web responsivo para cadastro e pesquisa de indivíduos e veículos, com vínculos entre eles. Pode ser instalado no celular e no computador após publicação em HTTPS.

## O que está preparado

- Login por e-mail e senha; redefinição e senha inicial por convite.
- Perfis `admin`, `operator`, `pending` e `disabled`. E-mails autorizados recebem automaticamente o papel configurado no primeiro login Google (Operador por padrão); e-mails não autorizados ficam pendentes.
- Cadastro de pessoas, veículos e vínculos muitos-para-muitos (proprietário, condutor ou associado).
- Busca por nome, CPF, RG, matrícula, apelido, endereço, anotações, placa, marca, modelo, cor e pessoas/veículos associados.
- Operadores podem criar registros e atualizar informações e vínculos. Nome e CPF de indivíduos ficam protegidos contra alteração por operadores, inclusive no banco. Só o administrador arquiva/restaura e altera ou exclui fotos.
- Histórico de versões anteriores e atuais. Só administradores podem consultar e restaurar uma versão; a restauração também gera um novo evento.
- Galeria de fotos múltiplas para indivíduos e veículos, com capa, miniaturas, navegação por toque e ampliação. Operadores podem adicionar fotos; somente administradores escolhem a capa, ajustam o enquadramento ou excluem fotos. O service worker guarda somente arquivos da interface; respostas do banco não são armazenadas offline.

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

6. Na tela **Usuários** do app, administradores autorizam o e-mail da Conta Google. O perfil é criado automaticamente como **Operador** no primeiro login; depois, o administrador pode promover, desativar, excluir ou revogar o acesso. O banco bloqueia cadastro por senha: todos entram com **Continuar com Google**. Um e-mail não-Gmail também pode ser usado se estiver vinculado a uma Conta Google.
7. Para publicar automaticamente a função de usuários, adicione o secret `SUPABASE_ACCESS_TOKEN` nas configurações de Actions do GitHub. O fluxo `.github/workflows/deploy-supabase-users.yml` publica a função ao atualizar seu código. O convite por e-mail exige que o provedor SMTP do Supabase consiga enviar mensagens; se falhar, o app oferece um link de uso único ou o cadastro sem convite.
8. Execute uma vez os arquivos `supabase/migrations/004_admin_only_person_name.sql`, `005_search_name_tokens.sql`, `006_authorized_email_auto_role.sql`, `007_admin_photo_management.sql`, `008_operator_identity_fields.sql` e `009_service_role_authorized_emails.sql` no SQL Editor para aplicar as regras de proteção, busca, autorização automática de papéis, gerenciamento de fotos e permissões da função de usuários.
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
