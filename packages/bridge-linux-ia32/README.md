# @cosmemilton/sitef-bridge-linux-ia32

Pacote opcional de plataforma para `@cosmemilton/sitef`. Contém somente a ponte Rust própria, não o SDK proprietário CliSiTef. O integrador deve fornecer sua biblioteca do fornecedor, licenciada separadamente, por caminho absoluto.

Executa um processo i686/ELF32 em sistemas Linux glibc x64 ou ia32. O Node/Electron pode permanecer x64. A biblioteca do fornecedor deve ser de 32 bits (`libclisitef.so` ELF32). Instale o carregador e as dependências de 32 bits exigidos pelo seu SDK; este pacote não instala bibliotecas do sistema. Alpine/musl e ARM não são suportados.

A exportação CommonJS fornece o caminho absoluto do executável. Prefira a descoberta automática pelo SDK (`ClientSitef.create` ou `createSitef`). A opção manual `bridgeExecutable` continua disponível. Consulte o [guia de instalação e operação](https://github.com/cosmemilton/sitef-node/blob/main/docs/bridge-distribution.md) para configuração, dependências de execução e limites de validação. Testes sintéticos não equivalem a homologação financeira.

As dependências Rust incluídas mantêm suas licenças em `THIRD_PARTY_NOTICES.txt`.
