# Validação inicial

Em 30/10/2026, a ponte Rust foi compilada no WSL para Windows x64
(`x86_64-pc-windows-msvc`) com `rust-lld` e as bibliotecas de importação do Visual
Studio/Windows SDK já instalados. O processo Windows carregou a biblioteca
**simulada** fornecida para análise e respondeu por IPC stdio.

O teste real executou somente `load`, `capabilities`, `version` e `configure`.
`ObtemVersao` retornou status 0 e versão `7.0.117.111S.r2`, com versão da interface
vazia. A configuração retornou 0. Os 24 entrypoints previstos pela ponte estavam
exportados. O processo encerrou com código 0. Um teste com Node no Windows também
confirmou resposta IPC antes de fechar stdin. Os resultados públicos estão em
`validation-simulator.json`; não contêm caminhos pessoais nem dados financeiros.

A API pública `createSitef()` também foi executada em Node Windows x64 com essa
DLL: carregamento, configuração, journal exclusivo, estado `idle` e encerramento
normal aprovados. Esse teste não iniciou nenhuma transação financeira.

Windows x64 é o único runtime de produção. Uma tentativa de fornecer a DLL Win32
foi rejeitada antes do carregamento, com `WRONG_LIBRARY_ARCHITECTURE`. A ponte
valida AMD64/PE32+ e a compilação Windows para outra arquitetura falha.

A referência de API permanece exclusivamente nos PDFs VRS-258 e Carteiras
Digitais 1.43 do ZIP Win32 original, mais recentes. Nenhum PDF do ZIP x64 foi
consultado. A versão do binário x64 é anterior à documentação: a existência dos
24 símbolos usados pelo SDK não comprova todas as funcionalidades mais recentes.
As capacidades distinguem 24 símbolos exportados de 21 métodos habilitados:
`configureEx` e `readChipEx` são variantes com `invocationMethod`, e `pinpadInfo`
permanece bloqueado pelo limite de saída não comprovado.

O wrapper direto `pinpadInfo` está bloqueado com `UNVERIFIED_OUTPUT_BOUND`: seu
ABI não recebe capacidade de saída e o manual informa um mínimo de buffer, sem
máximo total verificado. A alternativa é a função 775 pelo ciclo limitado de
continuação. Em capacidades, `available` indica símbolo exportado e `callable`
indica se a chamada está habilitada.

Não foram executadas transações financeiras nem operações de pinpad no teste com
a biblioteca do fornecedor. Aprovação, negação, cancelamento, desfazimento,
finalização fiscal, queda de energia e recuperação real permanecem como cenários
de homologação. O teste sintético abaixo verifica nosso contrato ABI/IPC; ele não
substitui esses testes.

## Reproduzir os testes próprios

No WSL, dentro de `native`:

```sh
cargo test --locked
python3 tests/smoke.py
```

O smoke compila uma biblioteca C sintética, criada neste projeto, em diretório
temporário. Ele verifica argumentos, preservação dos metadados da continuação,
eco dos bytes no comando 0, acentos Windows-1252, coleta com limites, cancelamento
cooperativo, retornos desconhecidos, finalização void, capacidade ausente e erros
do protocolo IPC. Nenhuma DLL proprietária é necessária nesses testes.

## Reproduzir a compilação Windows x64 no WSL

É necessário ter as bibliotecas x64 do Visual Studio C++ e Windows SDK acessíveis
no computador. O script não instala uma toolchain Microsoft nem baixa CliSiTef.

```sh
rustup target add x86_64-pc-windows-msvc
bash scripts/build-windows-x64.sh
```

O executável fica em
`native/target/x86_64-pc-windows-msvc/release/sitef-bridge.exe`. O script identifica
pastas padrão no Windows montado em `/mnt/c`; instalações diferentes podem definir
`SITEF_MSVC_LIB_DIR`, `SITEF_UCRT_LIB_DIR` e `SITEF_WINDOWS_UM_LIB_DIR` com as pastas
de importação x64. `SITEF_PROGRAMFILES_X86` muda o ponto de descoberta padrão.
As referências locais em `.build` e os binários em `native/target` são artefatos
ignorados, que não integram o pacote de fontes.

Avisos `LNK4099` sobre PDBs Microsoft ausentes ocorreram nesta compilação. Eles
referem-se a informações de depuração externas; o executável foi produzido e
executado no teste descrito acima.

Para testar o kit real, o integrador deve manter suas DLLs e `CliSiTef.ini` fora do
repositório/pacote, fornecer caminho absoluto para a biblioteca de **interface**
e usar uma pasta local persistente em `[SalvaEstado] DiretorioBase`. Bibliotecas,
manuais e configurações proprietárias não acompanham este projeto.
