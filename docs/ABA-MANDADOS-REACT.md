# Modernização React — aba Mandados

## Escopo
A aba Mandados utiliza um workspace React e monta os botões de comando como elementos React, tanto na listagem quanto nas seções de inclusão, cruzamento de planilhas e revisão administrativa. A montagem também acompanha controles criados dinamicamente e botões dos diálogos de edição, baixa e exclusão.

Os formulários e campos de entrada mantêm os atributos e identificadores existentes para preservar os validadores, leitura local de PDF/OCR, importação CSV, cruzamento de planilhas, pesquisa, revisão administrativa e gravação no Supabase. Os eventos continuam ligados aos fluxos já testados da aplicação.

## Reversão pelo aplicativo
- A interface React é a opção padrão.
- No cabeçalho, use **Voltar à interface clássica** para retornar à apresentação anterior.
- Na interface clássica, use **Experimentar painel moderno** para reativar React.
- A escolha fica salva no armazenamento local do navegador.

## Segurança e dados
- Não foram alterados tabelas, políticas RLS, RPCs, permissões ou dados do Supabase.
- A revisão administrativa permanece restrita aos administradores.
- A interface preserva os atributos de ação e os handlers existentes. A situação jurídica deve ser confirmada na fonte oficial.
