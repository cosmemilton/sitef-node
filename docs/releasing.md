# Preparação de releases npm

A versão 0.3.0 está preparada para publicação. Este guia não registra uma publicação concluída. O workspace raiz é privado; os artefatos candidatos são `@cosmemilton/sitef` e `@cosmemilton/sitef-ui`.

## Antes de publicar

1. Confira as versões no registro npm, a disponibilidade dos nomes e as permissões da conta/organização. Não tente sobrescrever uma versão existente.
2. Confirme a versão dos dois pacotes, a dependência peer da UI e o lockfile. A ponte nativa possui versionamento próprio de protocolo e binário, não precisa assumir a versão npm.
3. Revise licença e direitos de distribuição. A licença permanece `UNLICENSED`; não há licença open source implícita. Confirme conscientemente o nível de acesso pretendido para os pacotes scoped.
4. Execute `npm ci --ignore-scripts`, `npm run check`, `cargo test --manifest-path native/Cargo.toml`, `python3 native/tests/smoke.py` e `npm run test:integration`. Os testes usam fixtures próprias, sem carregar a DLL proprietária.
5. Inspecione os candidatos com os comandos abaixo. Verifique entrypoints ESM, declarações TypeScript, subpath `fields`, README e dependências peer. O pacote não deve conter DLLs, binários compilados da ponte, arquivos de configuração operacionais, chaves, certificados, manuais, registros, dumps ou fixtures privadas.

```sh
npm run pack:check
npm pack --dry-run --workspace @cosmemilton/sitef
npm pack --dry-run --workspace @cosmemilton/sitef-ui
npm publish --dry-run --workspace @cosmemilton/sitef
npm publish --dry-run --workspace @cosmemilton/sitef-ui
```

`--dry-run` não publica. Empacotamento aprovado também não comprova homologação, licença adequada ou credenciais válidas. Teste a instalação dos tarballs gerados em um diretório temporário separado, sem executar fluxos financeiros. O consumidor deve conseguir importar os entrypoints publicados; a aplicação ainda precisa provisionar a ponte e o kit autorizado do fornecedor.

## Publicação efetiva

A publicação é uma etapa separada, somente após autorização explícita do responsável pelos pacotes e revisão dos nomes, versões, acesso e conteúdo. Não há publicação automática configurada neste projeto. Não salve tokens npm no repositório nem os inclua em comandos ou logs compartilhados.

Publique primeiro o core e depois a UI dependente, com o acesso aprovado. Em seguida, consulte o registro para verificar nome, versão, integridade e conteúdo publicado. Registre o commit correspondente e atualize o changelog apenas com o que foi efetivamente entregue. Push Git e publicação npm são operações distintas.

## Runtime distribuído separadamente

O pacote npm contém o SDK JavaScript/TypeScript, não uma instalação pronta de SiTef. Compile `sitef-bridge.exe` para Windows x64 seguindo `native/README.md` e distribua esse executável somente pelo processo autorizado da aplicação. A DLL de interface, seus INIs, certificados e demais componentes proprietários são fornecidos pelo integrador conforme os direitos do fornecedor.