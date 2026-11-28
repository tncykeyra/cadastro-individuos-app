# Migração integral para React

## Objetivo
Tornar React a arquitetura padrão de todos os módulos da aplicação, removendo a dependência da interface legada em HTML imperativo. Não basta envolver HTML antigo em componentes React: telas, estado, navegação, formulários e interações devem ser implementados com componentes React reais.

## Restrições obrigatórias
- Preservar integralmente o projeto Supabase, tabelas, RPCs, políticas RLS, autenticação Google, perfis, permissões e isolamento por cidade.
- Não executar migrações SQL nem alterar dados de produção como parte da migração de interface.
- Preservar IDs, relacionamentos, fotos, históricos, regras de negócio e rotinas existentes.
- Manter a paleta cinza original e os temas claro/escuro.
- Padronizar menu, ícones, tipografia, cartões, campos e botões em desktop e mobile.
- Não publicar uma etapa incompleta como padrão; ativar o novo React somente após validação funcional.
- Não reintroduzir seletor para voltar à interface clássica, salvo decisão explícita do responsável.

## Inventário inicial observado em main
- A entrada publicada ainda carrega src/main.js a partir de index.html.
- react-preview.html carrega src/react/main.jsx como prévia isolada.
- src/react/App.jsx é uma implementação parcial e independente: autenticação, painel, consultas simplificadas de indivíduos/veículos e detalhes somente leitura; contém módulos legados para veículos de interesse/fiscalização e itens desabilitados para outras áreas.
- Existem componentes React de apoio e pontes para HTML legado (LegacyPageWorkspace, PeopleWorkspace, VehiclesWorkspace, Sidebar), que não equivalem à migração integral.
- A aplicação legada contém fluxos de cadastro/edição, vínculos, fotos, mandados, OCR, histórico, usuários, cidades, fiscalização, veículos de interesse, ferramentas inteligentes, relatórios e exportação.

## Frentes de migração
1. Arquitetura e shell: entrada única React, roteamento interno, layout responsivo, menu lateral/mobile, temas, sessão e contexto de cidade.
2. Indivíduos: listagem, busca, paginação, cadastro, edição, ficha completa, fotos, vínculos e associações.
3. Veículos: listagem, busca, cadastro, edição, ficha, fotos, vínculos e associações.
4. Mandados: listagem, filtros, importação, OCR, revisão, duplicidades, detalhes, PDF e rotinas de atualização.
5. Inteligência e fiscalização: cadastro inteligente, revisão inteligente, veículos de interesse e fiscalização.
6. Administração: usuários, autorização, perfis, cidades, acessos e atividades pendentes.
7. Auditoria e saída: histórico, restauração de versões, PDFs, exportações, compartilhamento e relatórios.
8. Remoção de pontes legadas e ativação do React como única interface de produção.

## Critérios de aceite por módulo
- Todas as operações existentes preservadas e testadas (criar, consultar, editar, associar, desfazer/arquivar quando aplicável).
- Permissões verificadas para operador, administrador e master.
- Isolamento por cidade validado.
- Estados de carregamento, vazio, erro, confirmação e sucesso implementados.
- Fotos, OCR, anexos, impressão/PDF e compartilhamento validados nos fluxos correspondentes.
- Layout responsivo validado em mobile e desktop, incluindo navegação por gesto quando aplicável.
- Testes automatizados e build de produção aprovados.
- Sem regressão no Supabase e sem dados fictícios.

## Progresso da migração

### Concluído nesta branch
- Listagens de Indivíduos e Veículos em componentes React nativos.
- Ficha de Veículo em JSX nativo: galeria de fotos, dados de identificação, aviso de sugestão de placa, pessoas associadas e ações de compartilhar, editar, excluir, associar e desativar vínculo.
- Estrutura principal da ficha de Indivíduo em JSX nativo: galeria, identificação, CPF/RG, matrícula, vulgo, aniversário, endereços, anotações, informações de ocorrência e veículos associados.
- A ficha nativa de Indivíduo recebe os dados e resultados das consultas já existentes. Mantém os fluxos atuais de edição, compartilhamento, exclusão autorizada, associações, alertas de mandados, sugestões de identidade e verificação entre cidades.
- Corrigida a estrutura JSX da ficha nativa de Indivíduo após identificar falha de compilação. Build de produção e cinco workflows de validação passaram no commit `d0b0fb866f1b4f08c8397f4a6f4d522cfd4c3958`.
- A ficha nativa reutiliza os serviços e as rotinas de negócio existentes. As ações continuam conectadas aos manipuladores atuais.
- Nenhuma tabela, RPC, política RLS, registro ou arquivo do Supabase foi alterado.
- O fallback de erro mantém uma ação de retorno caso o carregamento do componente React falhe.

### Ainda pendente
- Formulários React nativos de indivíduos e veículos, incluindo validação de duplicidade, etapas, fotos, câmera e OCR.
- Concluir a migração nativa das áreas de vínculos, sugestões, alertas de mandados e verificações entre cidades da ficha de Indivíduos; os blocos de conteúdo dessas áreas ainda usam a renderização compatível atual.
- Migração integral de Mandados/OCR, Inteligência, Fiscalização, Veículos de interesse, Administração, Histórico e relatórios.
- Testes funcionais em navegador desktop e mobile para esta nova ficha, além dos testes automatizados.

## Estratégia de entrega
Migrar por módulos em branches/PRs pequenos baseados na main atual. Manter cada etapa isolada e testável. Só concluir a migração e ativar o React como padrão depois que todos os critérios de aceite forem atendidos. O deploy final deve ser validado no GitHub Pages.