# @cosmemilton/sitef

SDK TypeScript/Node.js para a interface CliSiTef, com ponte Rust isolada e finalização explícita. **Windows x64; Node.js >=22.18.0; sem homologação financeira.** A versão 0.3.0 está preparada para publicação. Licença do código próprio: [MIT](LICENSE). A preparação não comprova publicação no npm.

## Instalação

Após a versão estar disponível no registro:

```sh
npm install @cosmemilton/sitef@0.3.0
```

```js
import { ClientSitef } from '@cosmemilton/sitef';
```

Esse import não configura nem carrega a DLL. A chamada a
`ClientSitef.create(options)` requer os caminhos e a configuração do seu ambiente.
A instalação npm não compila nem baixa a ponte ou o SDK proprietário.

## Começar

A referência executável principal é [examples/windows-simple.mjs](https://github.com/cosmemilton/sitef-node/blob/main/examples/windows-simple.mjs), no repositório. Ela carrega/configura a DLL uma vez, oferece um menu de operações, recebe os callbacks e separa processamento de confirmação/desfazimento. O exemplo depende dos auxiliares do checkout.

Importe `ClientSitef` de `@cosmemilton/sitef`. Configure os caminhos absolutos da ponte e da biblioteca, os diretórios e os dados de servidor/loja/terminal em `ClientSitef.create(options)`. Para cada operação:

1. `client.createTransaction(input)` cria uma tentativa independente.
2. `transaction.process(callbacks)` conduz a interação e devolve o resultado.
3. Consuma `result.data`, que preserva campos desconhecidos, repetidos e bytes originais; cumpra impressão, assinatura e obrigações fiscais aplicáveis.
4. Escolha explicitamente `transaction.confirm()`, `transaction.undo()` ou nenhuma decisão, mantendo a pendência.
5. `transaction.dispose()` libera referências. Reutilize o cliente; `client.close()` encerra o transporte ao terminar, sem confirmar ou desfazer.

Pendências anteriores não bloqueiam uma nova transação; operações simultâneas na mesma instância são proibidas. Não repita automaticamente operações após timeout ou crash. Retorno local da finalização não comprova confirmação bancária remota.

A API `SitefClient`/`createSitef` continua disponível; `client.advanced` expõe consultas, seletores e recuperação explícita. O subpath `@cosmemilton/sitef/fields` fornece validação compartilhada compatível com navegador, sem carregar a ponte.

## Provisionamento e segurança

O pacote não inclui `sitef-bridge.exe`, DLL, INI, certificados ou manuais proprietários. Compile e provisione a ponte Windows x64 separadamente. O integrador fornece seu kit autorizado e os caminhos de execução. Não há runtime SiTef de produção Linux.

O exemplo mostra comprovantes como impressão simulada e tem entradas de teclado visíveis. Não substitui impressão física, assinatura, interface de QR, reconciliação ou homologação. Não registre PIN, PAN, trilhas, chaves, campos livres, comprovantes ou o resultado completo em logs.

Consulte a documentação no [repositório](https://github.com/cosmemilton/sitef-node): README, `docs/client-transactions.md`, `docs/field-results.md`, `docs/application-state.md` e `native/README.md`. O modal React é opcional e distribuído separadamente como `@cosmemilton/sitef-ui`.

## Licença e origem

O SDK e a ponte Rust próprios são MIT, copyright 2026 cosmemilton.
Dependências mantêm suas próprias licenças; nenhum direito sobre o kit
proprietário CliSiTef é concedido por esta licença.
A base semântica registra VRS-258 e Carteiras Digitais 1.43 do kit x86.
A conferência dos 444 IDs da seção 5.3.2 com VRS-260 não é auditoria semântica
completa nem homologação. Veja a [proveniência dos campos](https://github.com/cosmemilton/sitef-node/blob/main/docs/field-results.md).
