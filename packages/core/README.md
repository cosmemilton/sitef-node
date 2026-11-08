# @cosmemilton/sitef

SDK TypeScript/Node.js para a interface CliSiTef, com ponte Rust isolada e finalização explícita. **Versão 0.4.0; Windows x64 e Linux glibc com ponte i686; Node.js >=22.18.0; sem homologação financeira.** A [versão 0.3.0](https://www.npmjs.com/package/@cosmemilton/sitef/v/0.3.0) foi publicada no npm em 2026-11-08, com acesso público. Licença do código próprio: [MIT](LICENSE).

## Instalação

Instale com dependências opcionais habilitadas; o npm seleciona a ponte da plataforma:

```sh
npm install @cosmemilton/sitef@0.4.0
```

```js
import { ClientSitef } from '@cosmemilton/sitef';
```

Esse import não configura nem carrega a DLL. A chamada a
`ClientSitef.create(options)` requer os caminhos e a configuração do seu ambiente.
A versão 0.4.0 inclui dependências opcionais para a ponte própria, sem compilação durante a instalação e sem baixar o SDK proprietário. Antes da disponibilidade no registro, o checkout permite testar os tarballs locais. Veja o [guia de instalação local e configuração](https://github.com/cosmemilton/sitef-node/blob/main/docs/bridge-distribution.md).

## Começar

A referência executável principal é [examples/windows-simple.mjs](https://github.com/cosmemilton/sitef-node/blob/main/examples/windows-simple.mjs), no repositório. Ela carrega/configura a DLL uma vez, oferece um menu de operações, recebe os callbacks e separa processamento de confirmação/desfazimento. O exemplo depende dos auxiliares do checkout.

Importe `ClientSitef` de `@cosmemilton/sitef`. Configure `libraryPath` e `workingDirectory` absolutos e os dados de servidor/loja/terminal em `ClientSitef.create(options)`. Na 0.4.0, omita `bridgeExecutable` para resolver o pacote opcional da plataforma. Para provisionamento manual, informe `bridgeExecutable` absoluto; `bridgeDirectory` é opcional e assume a pasta da ponte. Esses caminhos explícitos continuam compatíveis com a API anterior. Para cada operação:

1. `client.createTransaction(input)` cria uma tentativa independente.
2. `transaction.process(callbacks)` conduz a interação e devolve o resultado.
3. Consuma `result.data`, que preserva campos desconhecidos, repetidos e bytes originais; cumpra impressão, assinatura e obrigações fiscais aplicáveis.
4. Escolha explicitamente `transaction.confirm()`, `transaction.undo()` ou nenhuma decisão, mantendo a pendência.
5. `transaction.dispose()` libera referências. Reutilize o cliente; `client.close()` encerra o transporte ao terminar, sem confirmar ou desfazer.

Pendências anteriores não bloqueiam uma nova transação; operações simultâneas na mesma instância são proibidas. Não repita automaticamente operações após timeout ou crash. Retorno local da finalização não comprova confirmação bancária remota.

A API `SitefClient`/`createSitef` continua disponível; `client.advanced` expõe consultas, seletores e recuperação explícita. O subpath `@cosmemilton/sitef/fields` fornece validação compartilhada compatível com navegador, sem carregar a ponte.

## Mensagem permanente do pinpad

A opção de criação `initialPinpadMessage` envia a mensagem uma vez após configurar e exige status nativo 0. Para alterá-la depois, use `await client.escreverMensagemPinpad('CAIXA DISPONIVEL')`; o retorno é `{ status: number }`, preservando inclusive valores não zero. A chamada não confirma nem desfaz pagamentos e é recusada em sessão ativa, ocupada, fechada ou incerta. Retorno local não comprova visualmente a mensagem no equipamento.

## Provisionamento e segurança

O core não contém binários nativos. Na 0.4.0, `@cosmemilton/sitef-bridge-win32-x64` fornece a ponte Windows x64 e `@cosmemilton/sitef-bridge-linux-ia32` fornece a ponte Linux i686. São dependências opcionais, instaladas conforme o host; no Linux o pacote aceita Node x64 e ia32 porque a ponte é um processo separado. Desabilitar dependências opcionais exige instalação explícita do pacote correto ou caminho manual.

No Linux, use `libclisitef.so` ELF32 e runtime glibc de 32 bits. Não há suporte a biblioteca Linux x64, ARM ou musl/Alpine neste alvo. No Windows, use a interface x64, como `CliSiTef64I.dll`. DLLs, SOs, INIs, certificados e manuais proprietários continuam fora de todos os pacotes; o integrador fornece seu kit autorizado e diretórios graváveis. Essa disponibilidade técnica não equivale a homologação.

O exemplo mostra comprovantes como impressão simulada e tem entradas de teclado visíveis. Não substitui impressão física, assinatura, interface de QR, reconciliação ou homologação. Não registre PIN, PAN, trilhas, chaves, campos livres, comprovantes ou o resultado completo em logs.

Consulte a documentação no [repositório](https://github.com/cosmemilton/sitef-node): README, `docs/client-transactions.md`, `docs/field-results.md`, `docs/application-state.md` e `native/README.md`. O modal React é opcional e distribuído separadamente como `@cosmemilton/sitef-ui`.

## Licença e origem

O SDK e a ponte Rust próprios são MIT, copyright 2026 cosmemilton.
Dependências mantêm suas próprias licenças; nenhum direito sobre o kit
proprietário CliSiTef é concedido por esta licença.
A base semântica registra VRS-258 e Carteiras Digitais 1.43 do kit x86.
A conferência dos 444 IDs da seção 5.3.2 com VRS-260 não é auditoria semântica
completa nem homologação. Veja a [proveniência dos campos](https://github.com/cosmemilton/sitef-node/blob/main/docs/field-results.md).
