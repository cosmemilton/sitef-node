# @cosmemilton/sitef-bridge-win32-x64

Pacote opcional de plataforma para `@cosmemilton/sitef`. Contém somente a ponte Rust própria, não o SDK proprietário CliSiTef. O integrador deve fornecer sua biblioteca do fornecedor, licenciada separadamente, por caminho absoluto.

Exige Windows x64 e a biblioteca de interface do fornecedor em DLL Windows x64, como `CliSiTef64I.dll`. A DLL interna `CliSiTef.dll` não substitui essa interface.

A exportação CommonJS fornece o caminho absoluto do executável. Prefira a descoberta automática pelo SDK (`ClientSitef.create` ou `createSitef`). A opção manual `bridgeExecutable` continua disponível. Consulte o [guia de instalação e operação](https://github.com/cosmemilton/sitef-node/blob/main/docs/bridge-distribution.md) para configuração, dependências de execução e limites de validação. Testes sintéticos não equivalem a homologação financeira.

As dependências Rust incluídas mantêm suas licenças em `THIRD_PARTY_NOTICES.txt`.
