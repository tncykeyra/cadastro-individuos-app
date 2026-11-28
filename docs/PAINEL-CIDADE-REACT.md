# Painel da Cidade em React — versão integrada

O Painel da Cidade em React é a interface padrão do aplicativo a partir da versão 2.39.0. O painel clássico permanece disponível como alternativa imediata.

## Alternar entre os painéis

- No painel moderno, use **Voltar ao painel clássico** no rodapé.
- No painel clássico, use **Experimentar painel moderno**.
- A escolha fica salva somente neste navegador e neste dispositivo. Cada usuário pode escolher sua interface sem alterar a preferência dos demais.
- Se o carregamento do React falhar, o aplicativo seleciona automaticamente o painel clássico.

## Reversão manual da preferência

A preferência local usa a chave `cadastro-painel-cidade-mode-v1` no armazenamento do navegador:
- `react`: abre o painel moderno.
- `classic`: abre o painel clássico.

Se a interface ficar presa, limpe apenas essa preferência no armazenamento local do site ou use a opção de retorno do painel clássico. Não é necessário apagar dados do aplicativo nem do Supabase.

## Reversão da atualização no GitHub

A implementação está isolada em um PR. O histórico do Git mantém a versão anterior. Se for necessário desfazer a atualização global, use a função **Revert** do GitHub no merge correspondente e publique a reversão após validar os checks. Isso restaura os arquivos anteriores sem apagar os registros do banco.

## Segurança e compatibilidade

- A autenticação, o cliente Supabase, as consultas, as permissões e as regras de acesso continuam sendo controlados pelo aplicativo original.
- A interface React não cria, edita, arquiva ou exclui registros.
- O painel clássico mantém os indicadores e alertas administrativos originais.
- A preferência de interface é local; ela não altera perfis, cidades ou permissões.
- A versão do Service Worker e o cache do aplicativo são atualizados para que os dispositivos recebam os novos arquivos.
