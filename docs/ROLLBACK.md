# Como reverter esta atualização

## Ponto de restauração

- Branch de segurança: `backup/pre-cadastro-inteligente-20261028`
- Commit estável registrado: `b8550734bb9178b388f39319000cf207f4d90a41`
- Branch de implementação: `feat/cadastro-inteligente-revisao-manutencao`

A branch de segurança contém o código estável anterior à atualização. Ela deve ser mantida até a validação e publicação da nova versão.

## Antes da publicação

Feche o pull request de implementação ou descarte a branch `feat/cadastro-inteligente-revisao-manutencao`. A branch `main` e o aplicativo publicado continuam no ponto de restauração.

## Depois de uma eventual publicação

Para reverter sem reescrever o histórico compartilhado, crie um pull request que reverta o merge da atualização para `main). Não apague nem force a branch principal. Se uma versão publicada estiver com falha, restaure o commit estável da branch `backup/pre-cadastro-inteligente-20261028` por um novo commit de reversão.

## Dados e Supabase

Esta atualização não executa migrações, gravações, exclusões nem alterações de políticas no Supabase. Assim, a reversão do código não exige restaurar tabelas ou fotografias. A nova revisão consulta os dados existentes em modo somente leitura.
