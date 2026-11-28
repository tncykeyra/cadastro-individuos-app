# Modernização React — aba Mandados

## Escopo
A aba Mandados recebe uma camada de apresentação React, com resumo de registros exibidos, pendentes, baixas informadas e registros encerrados. A lista, os formulários, as importações CSV/PDF, o cruzamento de planilhas, as revisões administrativas, as ações e as consultas continuam usando os fluxos legados já existentes.

## Reversão pelo aplicativo
- A interface React é a opção padrão.
- No cabeçalho, use **Voltar à interface clássica** para retornar à apresentação anterior.
- Na interface clássica, use **Experimentar painel moderno** para reativar React.
- A escolha fica salva no armazenamento local do navegador. Ela não é sincronizada entre dispositivos.

## Segurança e dados
- Não foram alterados tabelas, políticas RLS, RPCs, permissões ou dados do Supabase.
- A interface de revisão continua restrita aos administradores conforme as regras existentes.
- Os indicadores refletem apenas os registros já carregados e visíveis ao perfil. A situação jurídica deve ser confirmada na fonte oficial.
