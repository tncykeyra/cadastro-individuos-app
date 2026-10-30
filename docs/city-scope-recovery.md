# Recuperação da implantação de cidades

## Proteção dos dados

A implantação de cidades é aditiva: cadastros existentes recebem a cidade Lençóis Paulista, enquanto novas gravações recebem a cidade ativa do usuário. Fotografias, arquivos, IDs e vínculos não são apagados.

## Reversão rápida do aplicativo

Se a versão publicada apresentar problema:

1. No GitHub, reverta o merge da atualização de cidades ou publique novamente o último commit estável anterior à implantação.
2. Mantenha as migrações do Supabase aplicadas enquanto houver cadastros em mais de uma cidade.
3. Confirme o login de um operador e valide que ele continua limitado à cidade atribuída.

Manter as regras do banco durante a reversão do frontend evita que uma versão antiga exponha dados de outros municípios. As colunas de cidade e as atribuições são preservadas.

## Retorno completo à operação somente em Lençóis Paulista

Antes de qualquer retorno completo, confirme que nenhum cadastro foi criado fora de Lençóis Paulista e exporte uma cópia de segurança do banco e do Storage. Não remova colunas ou tabelas de cidade: isso apagaria a classificação municipal necessária para recuperar a separação.

Se for necessário desativar o isolamento municipal, prepare uma migração reversa específica que remova as políticas e funções de escopo, preservando os campos `city_id`, os vínculos e as atribuições. Execute-a primeiro em uma cópia de teste, com validação de permissões e relatórios. Não execute um rollback destrutivo automaticamente.

## Validação após recuperação

- Conferir a cidade ativa de cada conta comum.
- Conferir que indivíduos, veículos, fotos, vínculos, mandados e históricos mantiveram seu `city_id`.
- Testar leitura, criação e edição com uma conta por cidade.
- Confirmar que o operador não consegue consultar nem alterar registros de outra cidade.
