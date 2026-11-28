# Plano de padronização e migração React

## Objetivo

Migrar a interface do Cadastro Criminal para React por etapas verificáveis, sem substituir os fluxos operacionais por uma segunda implementação incompleta. O React deve assumir progressivamente a apresentação e os componentes visuais; os serviços, regras de negócio, consultas e gravações existentes continuam como fonte de verdade até a migração específica de cada módulo.

## Base de interface compartilhada — versão 2.44.0

- Componente único `src/react/ui/Button.jsx`, com suporte a atributos HTML, eventos, referências, conteúdo renderizado e estados de carregamento.
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

Esta versão entrega a base compartilhada de interface e padroniza os controles React existentes. Ela não declara concluída a migração estrutural de todas as telas. A migração restante deve seguir os lotes acima, evitando uma troca ampla que possa interromper o serviço.
