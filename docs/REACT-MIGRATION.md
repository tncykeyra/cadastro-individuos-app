# Migração gradual para React

## Objetivo e isolamento

- A migração acontece exclusivamente na branch `react-migracao-gradual`.
- A branch `main` e a aplicação atualmente publicada permanecem sem alterações.
- A prévia React é aberta separadamente em `react-preview.html`.
- O React usa o mesmo projeto Supabase da aplicação atual, com a chave pública `publishable/anon` e a sessão Google do usuário.
- Não há criação de tabelas, alteração de políticas, migrações SQL ou uso de `service_role`.
- O React não substitui o aplicativo legado nem é o ponto de entrada padrão.

## O que já está funcional nesta etapa

1. Inicialização de um cliente Supabase independente em `src/react/supabase.js`.
2. Login OAuth com Google, persistência de sessão e renovação automática de token.
3. Leitura do perfil autenticado na tabela `profiles`.
4. Validação do vínculo de cidade por `list_my_cities` e seleção da cidade ativa por `set_active_city`, seguindo o comportamento do aplicativo atual.
5. Painel com contagens reais de indivíduos, CPFs, veículos e mandados ativos.
6. Consulta e pesquisa de indivíduos e veículos, incluindo tela de detalhes.
7. Respeito às políticas RLS do banco. As consultas também filtram a cidade ativa quando aplicável.
8. Tema claro/escuro e identidade visual baseada nos tons originais cinza, sem introduzir azul.

## Limite de segurança desta etapa

A primeira entrega é deliberadamente de consulta. A interface React não cria, edita, arquiva ou exclui registros. Isso evita que uma versão ainda em migração altere acidentalmente dados reais. A aplicação original continua sendo a interface operacional para qualquer gravação.

A mesma base de produção é consultada após autenticação. Portanto, os dados exibidos são reais e devem ser tratados como informação de acesso restrito. Não compartilhe capturas de tela com dados pessoais ou operacionais.

## Como abrir a prévia

Na raiz do projeto:

1. Instale as dependências com `npm install`.
2. Crie um arquivo local `.env.local` com as duas variáveis abaixo, usando a URL e a chave pública do mesmo projeto Supabase já utilizado pelo aplicativo atual.
3. Execute `npm run dev:react`.
4. Abra o endereço local informado pelo Vite e acrescente `react-preview.html` ao caminho.

Exemplo de configuração local:

```dotenv
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA_PUBLISHABLE_OU_ANON
```

Nunca use a chave `service_role` no navegador, em arquivo versionado ou em variável `VITE_*`.

O endereço usado na prévia também precisa estar autorizado em **Supabase → Authentication → URL Configuration → Redirect URLs**. Para StackBlitz ou outro ambiente online, configure as mesmas duas variáveis como secrets/variables do ambiente. Não coloque essas chaves em mensagens, commits ou arquivos públicos.

## Próximas etapas

1. Validar o login, a troca de cidade e as consultas em ambiente real.
2. Migrar mandados e seus fluxos de consulta/revisão.
3. Migrar cadastro e edição de indivíduos e veículos, incluindo fotos, vínculos, histórico e regras administrativas.
4. Migrar cadastro inteligente, OCR, PDFs, fiscalização, usuários e manutenção.
5. Comparar cada módulo com a versão legada antes de considerar qualquer substituição.

Nenhum módulo legado deve ser removido antes da equivalência funcional, revisão de segurança e testes de regressão.
