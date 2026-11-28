# Suíte de testes automatizados

Esta suíte valida funções puras e regras de negócio do Cadastro de Indivíduos. Ela não acessa o Supabase e não utiliza dados reais de pessoas.

## Executar localmente

Requisito: Node.js 22 ou compatível com o projeto.

```bash
npm install
npm test
npm run build
```

## Cobertura inicial

- Normalização de termos de pesquisa e placas.
- Validação de placas nos padrões antigo e Mercosul.
- Comparação e deduplicação de fotografias por hash.
- Formatação de nomes e normalização de fotos.
- Validação de CPF, CNPJ e datas.
- Extração e mesclagem de filiação.
- Extração de campos de documentos pessoais e veiculares.
- Ordenação de texto extraído de PDF.
- Preservação de campos editados na revisão de mandados.
- Normalização de dados de mandados e números de processo.
- Importação de CSV, filtro de situação e detecção de duplicidades.
- Geração básica do PDF de veículos de interesse.

## Execução no GitHub

O workflow `.github/workflows/testes-automatizados.yml` executa os testes e a compilação em pushes na `main` e na branch de testes, em pull requests direcionados à `main` e por execução manual.

Os testes usam dados sintéticos. Eles não autenticam no Supabase, não consultam registros reais e não executam operações de inclusão, alteração ou exclusão.
