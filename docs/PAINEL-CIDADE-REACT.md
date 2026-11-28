# Prévia do Painel da Cidade em React

Esta branch contém uma modernização isolada do Painel da Cidade. A aplicação principal continua usando a entrada e o build atuais.

## Iniciar no Windows

1. Instale Node.js LTS.
2. Baixe esta branch: https://github.com/tncykeyra/cadastro-individuos-app/tree/painel-cidade-react
3. Extraia o ZIP.
4. Execute `INICIAR-TESTE-REACT.bat`.
5. Informe a URL do projeto Supabase e somente a chave pública Publishable/anon.
6. A prévia será aberta em `http://localhost:5173/react-preview.html`.

No Supabase, adicione esta URL em Authentication > URL Configuration > Redirect URLs:

`http://localhost:5173/react-preview.html`

## Validação manual

- Entre com uma conta de teste autorizada.
- Confira se a cidade ativa e o perfil exibidos correspondem à conta.
- Confira os quatro indicadores e use Atualizar dados.
- Teste os atalhos de indivíduos, veículos e módulos disponíveis.
- Redimensione a janela para testar celular e desktop.
- Confirme que o restante do aplicativo continua abrindo pela página normal.

## Segurança e isolamento

- A prévia usa a autenticação e as permissões já configuradas no Supabase.
- Use somente a chave pública Publishable/anon. Nunca use `service_role` ou chave secreta.
- Não faça alterações nem exclusões de registros durante a avaliação.
- A página de prévia não é a entrada de produção.
- `npm run build` continua validando o aplicativo atual.
- `npm run build:react` compila a prévia em `dist-react-preview`, separada do build oficial.
- Nenhuma alteração deve ser incorporada à `main` ou publicada sem aprovação explícita.
