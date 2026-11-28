# Plano de padronização e migração React

## Objetivo

Migrar a interface do Cadastro Criminal para React por etapas verificáveis, sem substituir os fluxos operacionais por uma segunda implementação incompleta. O React deve assumir progressivamente a apresentação e os componentes visuais; os serviços, regras de negócio, consultas e gravações existentes continuam como fonte de verdade até a migração específica de cada módulo.

## Base de interface compartilhada — versão 2.44.1

- Componente único `src/react/ui/Button.jsx`, com suporte a atributos HTML, eventos, referências, conteúdo renderizado e estados de carregamento.
- Notificações globais montadas em React por `src/react/ui/ToastViewport.jsx`, com fila limitada, leitura acessível e descarte automático. A API `toast()` existente passa a emitir eventos para o viewport React.
- Sistema visual compartilhado em `src/react/ui-system.css`: foco acessível, estados desabilitados, transições, tamanhos, variantes, campos e acabamento consistente.
- Componentes React existentes atualizados para usar o botão compartilhado: menu lateral, painel React, indivíduos, veículos, mandados e prévia React.
- Classes e atributos `data-*` existentes foram mantidos. O CSS não altera os seletores de delegação de eventos.
- A navegação inferior, o menu lateral e os controles dos módulos continuam com seus identificadores atuais.
- Nenhuma migration, tabela, RPC, política RLS ou regra de autorização foi alterada.

## Áreas já integradas com React no aplicativo de produção

- Menu lateral e navegação principal.
- Painel da cidade, com retorno ao painel clássico.
- Listagem e ficha de indivíduos, com retorno à interface clássica.
- Listagem e ficha de veículos, com retorno à interface clássica.
- Área de mandados, com retorno à interface clássica.

## Tipografia desktop — versão 2.47.0

- Aumenta a escala tipográfica apenas em telas com largura a partir de 900px, com incremento adicional em monitores a partir de 1400px.
- Melhora a leitura de navegação, títulos, textos, tabelas, metadados, formulários e botões, sem alterar a escala do mobile.
- A alteração é feita em folha de estilo isolada e não muda cores, regras de negócio, permissões ou dados.

## Cidades e acessos em React nativo — versão 2.46.0

- A tela master de Cidades e acessos foi convertida em componente React nativo, com estado controlado para seleção de usuário, cidades e perfil por cidade.
- A interface permite expandir os usuários vinculados, ativar cidades, criar cidades, atribuir ou substituir vínculos e remover acessos. As operações usam as consultas e RPCs já existentes.
- A verificação de administrador master permanece no controlador antes da leitura e montagem da tela. Nenhuma tabela, RPC, política RLS ou migration foi alterada.
- O retorno à interface clássica mantém disponível o fluxo anterior.
- O layout é responsivo para desktop e mobile e utiliza o botão compartilhado do sistema visual.

## Camada React transversal — versão 2.45.0

- As páginas genéricas que ainda eram inseridas diretamente pelo controlador legado agora são montadas dentro de `LegacyPageWorkspace`, sob uma raiz React.
- Os botões dessas páginas e do diálogo principal são renderizados pelo componente compartilhado `Button`, com preservação de classes, IDs, atributos `data-*`, atributos de formulário e delegação de eventos já existente.
- Painel da cidade, indivíduos, veículos e mandados mantêm seus workspaces React específicos. A raiz genérica é desmontada antes de cada troca para evitar raízes React concorrentes.
- A camada não altera consultas, gravações, autenticação, RPCs, políticas RLS ou contratos do Supabase.
- Esta é uma ponte de compatibilidade: formulários, tabelas e regras de negócio das páginas ainda serão convertidos em componentes React nativos por módulo. Não representa a conclusão da migração estrutural.

## Áreas que ainda precisam de migração estrutural

A aplicação ainda possui fluxos de apresentação imperativa em `src/main.js` e módulos auxiliares. A padronização visual não deve ser confundida com migração integral de tela. Os próximos lotes devem migrar, com testes funcionais próprios:

1. Autenticação, primeiro acesso, conta pendente e recuperação de acesso.
2. Cadastro Inteligente, revisão inteligente e manutenção inteligente.
3. Usuários, permissões, autorizações e gestão de cidades.
4. Histórico e revisão administrativa.
5. Veículos de interesse e Fiscalização.
6. Formulários, diálogos, importações, exportações, galeria e ferramentas transversais ainda montados por HTML.
7. Estados globais de carregamento, erro, sucesso, confirmação e notificações.

## Regras obrigatórias para cada etapa

- Não remover nem renomear IDs, atributos `data-*`, nomes de campos, eventos ou contratos de formulários sem migração compatível.
- Não duplicar regras de negócio nem criar fluxos Supabase paralelos.
- Preservar validações, OCR, importação CSV/PDF, exportação XLSX/PDF, fotos, associações, vínculos, histórico e permissões.
- Manter acessibilidade: foco visível, rótulos, estados de carregamento e respeito a `prefers-reduced-motion`.
- Validar desktop e mobile, modo claro e escuro, perfis operador/administrador/master e isolamento por cidade.
- Cada lote deve passar por testes automatizados e build antes do merge e do deploy.
- Manter os modos clássicos reversíveis até a validação operacional de cada módulo.

## Estado

A versão 2.45.0 amplia a montagem React para as páginas genéricas e padroniza seus botões. A versão 2.44.1 iniciou a migração transversal com o viewport global de notificações em React. Os diálogos, galerias, formulários, importações e exportações ainda exigem migração por fluxo, com validação própria. Esta entrega não declara concluída a etapa 6 nem a migração estrutural de todas as telas. A migração restante deve seguir os lotes acima, evitando uma troca ampla que possa interromper o serviço.
