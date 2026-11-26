# Testar a prévia React no Windows

Este procedimento inicia a prévia React localmente. Não altera a versão oficial publicada e não envia a chave do Supabase ao GitHub.

## Requisitos
1. Windows 10 ou 11.
2. Node.js LTS instalado: https://nodejs.org/
3. Acesso ao projeto Supabase usado pelo Cadastro de Indivíduos.

## Passo a passo
1. Abra a branch react-migracao-gradual: https://github.com/tncykeyra/cadastro-individuos-app/tree/react-migracao-gradual
2. Clique em Code > Download ZIP e extraia o arquivo em uma pasta.
3. Dê dois cliques em INICIAR-TESTE-REACT.bat.
4. Informe a Project URL e a chave pública Publishable ou anon do Supabase.
5. O script cria o arquivo .env.local localmente. Não envie esse arquivo ao GitHub.
6. Na primeira execução, as dependências serão instaladas. O Vite abrirá a prévia em http://localhost:5173/react-preview.html.

## Login Google
No Supabase, abra Authentication > URL Configuration > Redirect URLs e adicione exatamente:

`http://localhost:5173/react-preview.html`

Salve. O provedor Google também precisa estar habilitado no Supabase.

## Abrir novamente e encerrar
Para encerrar, volte à janela do terminal e pressione Ctrl+C. Na próxima execução, basta abrir novamente o arquivo BAT.

## Atenção
- Use apenas chave pública Publishable ou anon. Nunca use service_role ou chave secret.
- A prévia usa o mesmo banco e permissões. Evite ações que gravem ou excluam dados durante o teste.
- A migração ainda não possui todas as funcionalidades da aplicação original.
- A branch de migração é separada e este procedimento não publica nem substitui a versão oficial.