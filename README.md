# SiTef para Node.js

SDK TypeScript para integrar uma automação Node.js à interface CliSiTef, com uma ponte Rust em processo separado e decisões financeiras explícitas.

**Runtime: Windows x64. Sem homologação financeira.** A versão 0.3.0 está preparada para publicação no npm. Esta documentação não comprova publicação nem aprovação para uso em produção. O código próprio é distribuído sob a licença [MIT](LICENSE); os dois pacotes npm têm acesso público configurado.

## Componentes e requisitos

- `@cosmemilton/sitef`: cliente, transações, callbacks, campos e snapshots, sem dependência de React.
- `@cosmemilton/sitef-ui`: modal React opcional, integrado a `cosmemilton-ui`. Veja [a documentação do modal](packages/ui/README.md).
- `native/`: fontes da ponte Rust `sitef-bridge.exe`. O executável deve ser compilado e provisionado separadamente; não acompanha o pacote npm.

Use Node.js **>=22.18.0**, Windows x64, a ponte x64 e a **biblioteca de interface x64** fornecida pelo integrador, como `CliSiTef64I.dll`. A DLL interna `CliSiTef.dll` não substitui essa interface. Caminhos da ponte, biblioteca e diretórios operacionais são explícitos.

DLLs, INIs, certificados, chaves e manuais proprietários não são distribuídos nem baixados automaticamente. WSL/Linux serve ao desenvolvimento e aos testes sintéticos, não à execução de uma biblioteca SiTef de produção.

## Instalação npm

Após a versão estar disponível no registro, instale o core na aplicação Node:

```sh
npm install @cosmemilton/sitef@0.3.0
```

```js
import { ClientSitef } from '@cosmemilton/sitef';
```

O pacote fornece a API JavaScript/TypeScript, não um runtime SiTef pronto.
Provisione a ponte própria e o kit autorizado do fornecedor separadamente.
Para a UI React opcional e suas dependências peer, veja o
[quickstart do modal](packages/ui/README.md#instalação).
Os comandos acima descrevem o consumo da release, não comprovam sua publicação.

## Referência principal: exemplo simples Windows

Comece por **[examples/windows-simple.mjs](examples/windows-simple.mjs)**. A função `main` mostra diretamente o fluxo:

1. Preparar os callbacks e o registro de metadados da execução.
2. Criar um `ClientSitef`, carregando e configurando a DLL **antes do primeiro menu**.
3. Escolher uma operação, criar uma `Transaction` e executar `process(callbacks)`.
4. Receber os dados, apresentar os comprovantes e escolher confirmar, desfazer ou manter pendente.
5. Reutilizar o cliente para outras operações e chamar `close()` ao encerrar.

O arquivo usa auxiliares em `examples/cli/` para terminal, configuração, callbacks, comprovantes e persistência. Não é um arquivo autossuficiente para copiar isoladamente. O [guia do exemplo](docs/windows-simple.md) descreve configuração, entradas e limitações; o [guia de depuração](docs/vscode-windows-debug.md) explica o VS Code local do Windows.

### Preparar o checkout

No ambiente de desenvolvimento, instale as dependências e compile os pacotes:

```sh
npm ci --ignore-scripts
npm run build
```

Compile a ponte conforme [native/README.md](native/README.md). No layout padrão do exemplo:

```text
%USERPROFILE%\Documents\SiTefDevelopment\
  sitef-bridge.exe
  runtime\7.0.117.123.r2-win64\
    CliSiTef64I.dll
    [demais arquivos autorizados do kit do integrador]
```

`SITEF_ROOT` e `SITEF_RUNTIME` permitem escolher outros diretórios. Edite o objeto `configuration` no início de `examples/windows-simple.mjs` para definir servidor, loja, terminal e parâmetros do ambiente autorizado antes de executar. Os valores padrão são ilustrativos e não garantem um ambiente financeiro simulado.

No PowerShell, na raiz do checkout, usando **Node Windows x64**:

```powershell
node .\examples\windows-simple.mjs
```

O exemplo simples **não aceita opções**: não há `--help`, `--verificar`, `--diagnostico` ou `--funcao`. Executá-lo carrega a DLL. Para verificações e modos avançados, use a [CLI completa opcional](docs/windows-cli.md), em `examples/windows-cli.mjs`. A ferramenta `examples/windows-reconcile.mjs` continua disponível para reconciliação explícita, não automática.

### Inicialização, uma vez

Trecho literal do exemplo:

```js
connection = cliConnection({ root, directory, configuration, io,
  createTransport, onStateChange: state.onStateChange });
// A DLL e carregada/configurada aqui, uma vez, antes do primeiro menu.
client = await ClientSitef.create({ ...connection.options,
  initialPinpadMessage: env.SITEF_PINPAD_MESSAGE });
```

`cliConnection` monta os caminhos absolutos, a configuração e os hooks usados pelo exemplo. `createCallbacks(io)` implementa a interação de terminal. Na sua aplicação, forneça essas opções diretamente a `ClientSitef.create` e substitua os callbacks pela sua interface. Importe a API pública de `@cosmemilton/sitef`; o exemplo importa `packages/core/dist/index.js` porque roda dentro do checkout.

### Uma transação por operação

Trecho literal do laço principal:

```js
const selection = await collectFunctionInput(io, undefined, { signal });
if (!selection) break;
const input = transactionInput(selection, env, documents);
transaction = client.createTransaction(input, { signal,
  ...(input.functionId === 110 ? { requiresFinalization: 'review-receipts' } : {}) });
result = await transaction.process(callbacks);
io.write('Retorno ' + result.status + ': ' + classifyReturn(result.status).message);
```

`transactionInput` gera dados fiscais ilustrativos. Um PDV deve usar cupom, data, hora, operador e valor da venda real. Valores monetários são strings decimais, nunca floats. A API aceita `operation: Operations.Credit`, por exemplo, ou `functionId`, sem limitar funções futuras a uma lista fechada.

`result.data` preserva os campos recebidos, inclusive desconhecidos, repetições e bytes originais. `result.fields` e `result.details` oferecem visões compatíveis e semânticas. Falhas podem disponibilizar dados parciais, sem fabricar um resultado completo. Veja [campos e resultados](docs/field-results.md).

### Decisão explícita

Entre o processamento e este trecho, o exemplo apresenta `result.details.receipts` usando `displayReceipt`. A apresentação concluída conta como **impressão simulada em tela**, não como impressão física. O bloco de decisão é:

```js
if (result.status === 0 && result.requiresFinalization && input.functionId !== 110 && !signal.aborted) {
  const decision = await interactiveFinalizationDecision(io, signal)(result);
  if (!signal.aborted && decision === 'confirm') {
    await transaction.confirm();
    io.write('Confirmacao retornou localmente.');
  } else if (!signal.aborted && decision === 'undo') {
    await transaction.undo();
    io.write('Desfazimento retornou localmente.');
  } else io.write('Mantida pendente; nenhuma finalizacao enviada.');
}
transaction.dispose(); // Libera referencias, sem decidir pendencias.
```

O menu gerencial 110 exige revisão específica e não recebe finalização genérica por ter devolvido comprovantes. Na fachada `ClientSitef`, os padrões são `finalizationResponsibility: 'automation'` e `receiptStoragePolicy: 'explicit-return'`: a automação deve cumprir as obrigações do produto antes de confirmar. As guardas de status, alcance, sincronização, impressão imediata e revisão gerencial continuam válidas.

A função nativa de finalização é `void`: retorno local não comprova confirmação bancária remota. Não confirme em `finally`, não repita operações incertas e não transforme um retorno desconhecido em sucesso.

### Encerramento e pendências

No bloco de limpeza, o exemplo contém:

```js
if (client) await client.close();
else if (failure?.cleanupFailed) await connection?.closeTransport();
```

Esse trecho está dentro de tratamento de erro; a implementação completa também libera referências, fecha o registro de metadados e remove o listener de Ctrl+C. Consulte o arquivo antes de adaptar sua limpeza. **Não há confirmação nem desfazimento no encerramento.**

`dispose()` libera a transação; não fecha o cliente nem decide pagamentos. `close()` fecha o transporte quando não há operação em execução e é permitido com pendências. Pendência anterior não bloqueia uma nova operação, mas duas operações não podem se sobrepor na mesma instância. Uma conexão dessincronizada deve ser fechada e reaberta antes de consultar ou decidir, sem repetir a operação incerta.

A aplicação controla persistência durável, restauração e reconciliação. O exemplo grava somente metadados desta execução em `state/automation`, sem recuperar ou alterar registros anteriores. Não apague registros ou locks para contornar pendências. Veja [estado e recuperação](docs/application-state.md).

## Limites e segurança

- Os callbacks recebem as solicitações nativas. Comandos sem implementação falham explicitamente. O exemplo de terminal não implementa todos os fluxos de QR; uma interface apropriada precisa tratar esses comandos.
- Todas as entradas de teclado do exemplo simples são visíveis. PIN de cartão pertence ao pinpad. Não grave nem compartilhe a sessão do terminal.
- Exibir comprovantes não imprime fisicamente, captura assinatura ou homologa um fluxo. Impressora, assinatura em papel quando exigida, fechamento fiscal e entrega pertencem à automação.
- Nunca registre PIN, PAN, trilhas, chaves, campos livres, comprovantes ou um dump de `result.data` em logs. Snapshots não substituem armazenamento protegido dos dados que o produto exigir.
- Ctrl+C solicita cancelamento cooperativo. Timeout, crash, modal fechado ou processo encerrado não comprovam cancelamento financeiro.
- O modal React roda no frontend; o SDK e a ponte ficam no host Node. Use IPC restrito no Electron ou transporte autenticado em uma integração web. Não exponha chamadas nativas genéricas ao navegador.

## Documentação técnica

- [Cliente, transações, callbacks e migração](docs/client-transactions.md)
- [Campos tipados, dados completos e resultados parciais](docs/field-results.md)
- [Estado da aplicação e recuperação](docs/application-state.md)
- [Semântica e obrigações por produto](docs/semantic-flows.md)
- [Arquitetura](docs/architecture.md) e [protocolo da ponte](docs/bridge-protocol.md)
- [Cobertura do protocolo](docs/protocol-coverage.md) e [estado da implementação](docs/implementation-status.md)
- [Validação](docs/validation.md), [preparação da publicação](docs/releasing.md) e [changelog](CHANGELOG.md)

A API anterior `SitefClient`/`createSitef` permanece disponível. Consultas, seletores fiscais e recuperação explícita também podem ser acessados por `client.advanced`; consulte os guias antes de migrar suas políticas de persistência e finalização.

## Verificação local

Na raiz, usando Node/npm e Rust do ambiente escolhido:

```sh
npm run check
cargo test --manifest-path native/Cargo.toml
python3 native/tests/smoke.py
npm run test:integration
```

Os testes nativos usam fixtures C próprias. Não são homologação, não validam uma ABI Linux de produção e não autorizam executar uma operação financeira. O template em [ci/](ci/README.md) não significa que uma execução de CI tenha ocorrido.

## Origem e licença

Implementação original baseada na documentação do fornecedor: [introdução](https://dev.softwareexpress.com.br/docs/sitef-interface-simplificada/introducao/), [rotinas](https://dev.softwareexpress.com.br/en/docs/clisitef/api_rotinas_disponiveis/) e [configuração](https://dev.softwareexpress.com.br/docs/clisitef/configuracao_biblioteca/). A base semântica e os metadados de origem usam VRS-258 e Carteiras Digitais 1.43 do kit documental x86. Os 444 IDs da seção 5.3.2 foram conferidos com VRS-260, e guias específicos registram consultas pontuais a essa revisão. Isso não equivale a uma auditoria semântica completa da VRS-260. As capacidades do binário x64 devem ser verificadas em runtime. Não há promessa de cobertura universal de produtos ou versões.

[node-sitef](https://github.com/ddanielcruz/node-sitef) foi referência arquitetural; nenhum código dele ou código Delphi foi incorporado. A ponte Rust tem este repositório como fonte canônica. Clientes relacionados: [Python](https://github.com/cosmemilton/sitef-python) e [PHP](https://github.com/cosmemilton/sitef-php).

**Licença: [MIT](LICENSE), copyright 2026 cosmemilton, para o código próprio deste repositório**, incluindo o SDK TypeScript, a UI e a ponte Rust. Dependências de terceiros mantêm suas próprias licenças. A licença não concede direitos sobre CliSiTef, DLLs, INIs, certificados, manuais ou outros materiais proprietários do fornecedor, que não acompanham os pacotes. O integrador deve obter e usar seu kit conforme os direitos e requisitos do fornecedor.
