# Migração gradual para React

## Diretrizes

- A migração ocorre na branch `react-migracao-gradual`.
- A branch `main` permanece preservada.
- A interface mantém a paleta original: `#50595e`, `#3e474c`, `#f6f7f7), branco e tons neutros.
- Nenhum módulo legado deve ser removido antes da equivalência funcional e dos testes.
- O Supabase, autenticação, permissões, dados, fotografias e regras de negócio devem ser preservados.
- Não inserir dados pessoais ou operacionais reais em telas de demonstração ou fixtures.

## Primeira etapa

Foi criada uma base isolada de componentes React em `src/react/`. Ela ainda não substitui nem inicializa a aplicação legada. A integração ao ponto de entrada será feita após validação da estrutura e definição da estratégia de convivência entre as telas antigas e novas.

## Próximos passos

1. Instalar dependências e validar a compilação.
2. Criar um ponto de entrada de pré-visualização sem afetar a aplicação principal.
3. Validar responsividade e acessibilidade.
4. Migrar a primeira tela real, mantendo o fluxo legado disponível.
