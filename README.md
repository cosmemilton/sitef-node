# SiTef para Node.js

Projeto inicial em TypeScript e Rust para integrar aplicativos Node.js com a
interface oficial CliSiTef fornecida pelo desenvolvedor da aplicação.

**Estado: desenvolvimento, sem homologação.** O runtime suportado é exclusivamente
Windows x64, com a biblioteca simulada x64 fornecida pelo integrador. O projeto
é desenvolvido no WSL. A referência documental são os PDFs mais recentes do kit
x86; nenhuma documentação do kit x64 é usada. O carregamento Linux real permanece
bloqueado até receber e conferir seu kit. Os testes próprios usam uma biblioteca
C sintética original em Linux x64.

O catálogo não representa tratamento completo de todos os produtos: as 124
funções do manual estão identificadas, mas seus fluxos não foram todos validados.
Da tabela com 444 códigos individuais de `TipoCampo`, 40 têm aliases individuais
no catálogo atual. O motor preserva os demais dados; faltam tratamentos específicos.
Consulte `docs/implementation-status.md` antes de habilitar uma modalidade.

## Pacotes

| Parte | Responsabilidade |
| --- | --- |
| `@cosmemilton/sitef` | Configuração, ciclo, callback, cancelamento, campos, journal e decisão explícita |
| `@cosmemilton/sitef-ui` | Modal React opcional; exige `cosmemilton-ui` 4.1 e React |
| `native/` | Executável Rust isolado, carregamento dinâmico, ABI e IPC privado |

A aplicação fornece o caminho absoluto da **biblioteca de interface**
(`CliSiTef64I.dll`/`CliSiTefI.dll`, conforme o nome efetivo do kit x64) e seu diretório operacional.
DLLs, SOs, INIs, chaves, certificados e PDFs do fabricante não acompanham os
pacotes. Não há download automático desses arquivos.

## Preparação

Node >=22.18, npm e Rust estável. No WSL:

```sh
cd sitef-node
npm ci --ignore-scripts
npm run check
cargo test --manifest-path native/Cargo.toml
python3 native/tests/smoke.py
npm run test:integration
```

Use Node/npm **Linux** no WSL. Se o shell estiver encontrando o npm Windows em
`/mnt/c`, carregue sua instalação nvm (`source ~/.nvm/nvm.sh; nvm use 24`) antes
dos comandos. O executável Linux detectado neste ambiente é Node 24.15.0.

Para Windows x64, compile `native` com o alvo `x86_64-pc-windows-msvc` e a toolchain
MSVC/Windows SDK x64. No WSL, use `bash scripts/build-windows-x64.sh`. O executável
da ponte é nosso; as bibliotecas do SiTef continuam externas. Node Windows x64 e
ponte x64 se comunicam por stdio. A ponte x86 foi retirada do suporte.

## Integração por callback

O atalho `createSitef({bridgeExecutable,bridgeDirectory,libraryPath,stateDirectory,
configuration,interaction})` faz carregamento, handshake e journal com chave fixa
por loja/terminal. O exemplo abaixo mostra as mesmas etapas explicitamente para
deixar visível a configuração de cada parte.

```ts
import {BridgeTransport, FileJournal, SitefClient, classifyReturn} from '@cosmemilton/sitef';

const transport = new BridgeTransport({
  executable: 'C:\\meu-pdv\\bridge\\sitef-bridge.exe',
  cwd: 'C:\\meu-pdv\\bridge',
});
await transport.call('load', {
  libraryPath: 'C:\\meu-pdv\\sitef\\CliSiTef64I.dll',
  workingDirectory: 'C:\\meu-pdv\\sitef',
  nativeEncoding: 'windows-1252', // confirmar o encoding no kit utilizado
});
const client = await SitefClient.connect({
  transport,
  configuration: {
    server: '127.0.0.1', storeId: '00000000', terminalId: 'AA000001',
    reserved: 0,
    additionalParameters: '[ParametrosDoFornecedor=valor]',
  },
  // Sempre o mesmo arquivo para o mesmo terminal, em disco local persistente.
  journal: new FileJournal('C:\\meu-pdv\\estado\\00000000-AA000001.journal.json'),
  interaction: async (request, {signal}) => {
    // Sua tela recebe comando, TipoCampo, mínimo, máximo e buffer integral.
    // Implemente também o fallback explícito para novos comandos.
    return minhaTela.interagir(request, {signal});
  },
});
const result = await client.transact({
  functionId: 0, amount: '10,00', fiscalDocument: '123456',
  fiscalDate: '20261030', fiscalTime: '120000', operator: 'Operador',
  additionalParameters: '',
});
console.log(classifyReturn(result.status).message); // nunca registrar campos/recibos
if (result.requiresFinalization) {
  // Esta é uma decisão da aplicação, depois de gravar seu fechamento fiscal.
  const fiscalGravado = await meuPDV.gravarFechamento(result.transactionId);
  await client.finalize(fiscalGravado);
}
await client.close();
```

O exemplo contém pontos de integração `minhaTela` e `meuPDV`, não uma aplicação
pronta. `examples/synthetic.mjs` é executável sem SiTef para demonstrar o ciclo.
Não usar os parâmetros fictícios acima como configuração de produção.

`amount` é texto decimal com duas casas; pode ser vazio quando o produto coleta
o valor durante a operação. Nunca convertemos valores financeiros por float.
`additionalParameters` é repassado integralmente na configuração, início e
finalização. Parâmetros adicionais não usam uma lista fechada.

## Integração pelo nosso modal

Use o mesmo contrato com `createSitefModal()` e `<SitefModal controller={...} />`
de `@cosmemilton/sitef-ui`. O pacote exige `cosmemilton-ui`; o núcleo não exige
React nem biblioteca visual. Consulte `packages/ui/README.md`.

Node não possui DOM: o modal roda no frontend/Electron. Em aplicação web, o
integrador fornece um canal autenticado, com autorização por sessão. Em Electron,
use IPC restrito no preload e mantenha o bridge no processo principal. Não exponha
`transport.call`, `libraryPath`, `nativeStart` nem objetos Node ao navegador.

Erros e avisos visuais usam `CmToastNotice`, sem deslocar o conteúdo da página.
As mensagens de operação e coletas permanecem no modal porque fazem parte da
interação requerida pelo protocolo. Dados de pagamento sensíveis pertencem ao
pinpad e às rotinas específicas do fabricante.

## Ciclo e recuperação

- O retorno `10000` mantém o ciclo. O SDK preserva status, comando, TipoCampo,
  mínimo, máximo e bytes originais; o comando 0 é ecoado sem alterar os bytes.
- Comando 23 é polling e não espera a tela. `onExchange` observa inclusive dados e
  polling; observadores de polling devem ser rápidos e não recebem backpressure.
- O callback pode retornar `buffer`, `bufferBase64` e `continueFlag`
  `-1 | 0 | 1 | 2 | 10000`. `10000` exige o procedimento de coleta prévia
  documentado, com exibição e confirmação pelo operador; não é confirmação padrão.
- Comando desconhecido chega ao callback. O modal exige `onUnsupported` explícito
  ou o SDK solicita cancelamento cooperativo. Não há aceitação silenciosa.
- `cancel()`/`AbortSignal` enviam `Continua=-1` e continuam até o retorno terminal.
  Fechar o modal ou matar um processo não comprova desfazimento financeiro.
- Retorno zero do ciclo e decisão fiscal são etapas separadas. Por padrão o
  `transact` aguarda `finalize(true|false)`. Consultas não financeiras podem usar
  `requiresFinalization:false` conscientemente, conforme a modalidade do fabricante.
- `FinalizaFuncaoSiTefInterativo` é `void`: `returned:true` atesta só que a chamada
  local retornou. A API não inventa confirmação bancária remota.
- Antes da operação e da decisão, o SDK grava um journal mínimo com cupom/data/hora
  originais. O journal não contém os campos coletados nem recibos. O escopo adicional
  da finalização é persistido para impedir retomada com escopo diferente; não inclua
  segredos nesse parâmetro. Desfazimentos seletivos usam os parâmetros do fabricante.
- Crash, timeout ou falha de persistência após entrar na DLL mantêm o estado incerto.
  Não há repetição automática de cobrança. Consulte `pendingCount`, modalidades
  130/131 e os procedimentos do produto antes de uma decisão de recuperação.
- `finalizeRecovery` exige o id persistido, preserva decisão/escopo já gravados e
  pressupõe reconciliação feita pela aplicação. Não é um mecanismo de consulta.

O lock é por arquivo: configure um caminho único e fixo por loja/terminal e não
execute outro processo que acesse o mesmo terminal por fora do SDK. Após crash,
não removemos um lock automaticamente. Verifique que o processo anterior acabou,
inspecione o journal e consulte pendências antes de liberar o lock. `close()` não
fecha sessão em execução ou aguardando decisão; cancele/decida primeiro.

Nesta versão, o cliente simplificado gerencia uma operação pendente por vez.
A coordenação de vários pagamentos TEF pendentes no mesmo cupom ainda exige um
journal de lote e está fora do suporte de alto nível atual. Não confirme cada
pagamento antes do fechamento fiscal para contornar esse limite.

## API avançada e cobertura

`client.capabilities()` enumera os símbolos disponíveis no kit. `callNative()`
permite rotinas auxiliares tipadas, preservando seus domínios de retorno.
`pendingCount` recebe `{fiscalDate,fiscalDocument}`; retorno positivo é quantidade,
não negação. `validateBarcode(data)` pode ser chamado durante a coleta.

Rotinas que iniciam outro ciclo usam `transact(input, {nativeStart:{method,params}})`:
`startBanking`, `readSecureCard`, `readTrack3`, `readPassword` e `readChip`.
Nos leitores, a finalização fiscal é desativada por padrão. `readPassword` recebe
`{securityKey}` conforme contrato proprietário, não uma senha digitada em HTML.
As mesmas regras de cancelamento, serialização e journal são aplicadas. Em
`startBanking`, identificadores fiscais são sempre os de `input`.

O catálogo cobre os comandos e retornos enumerados nos manuais VRS-258 e carteiras
1.43 do kit x86 recebido, por serem mais recentes. O binário usado é o do kit x64;
as capacidades são verificadas no runtime, sem supor paridade entre versões.
Não é a lista universal de produtos/versões do SiTef: os documentos
remetem a manuais adicionais ausentes. Campos, modalidades e códigos permanecem
abertos. Confira a matriz em `docs/protocol-coverage.md` e o protocolo nativo em
`native/README.md`; rotinas ainda não verificadas são identificadas explicitamente.

## Fontes e origem

Implementação original baseada nos manuais fornecidos e na documentação oficial:

- [Interface CliSiTefI e restrições de acesso](https://dev.softwareexpress.com.br/docs/sitef-interface-simplificada/introducao/)
- [Rotinas e ABI](https://dev.softwareexpress.com.br/en/docs/clisitef/api_rotinas_disponiveis/)
- [Configuração](https://dev.softwareexpress.com.br/docs/clisitef/configuracao_biblioteca/)
- [Arquivos de controle](https://dev.softwareexpress.com.br/docs/clisitef/arquivos_de_controle/)
- [Interoperabilidade Windows x86/x64](https://learn.microsoft.com/en-us/windows/win32/winprog64/process-interoperability)

O [node-sitef indicado](https://github.com/ddanielcruz/node-sitef) foi estudado como
referência arquitetural. Nenhum arquivo ou código dele foi reutilizado. Nenhum
código Delphi foi incorporado. A licença deste novo projeto está a definir;
pacotes marcados `UNLICENSED` não devem ser publicados até essa definição.

Clientes da mesma família: [Python](https://github.com/cosmemilton/sitef-python)
e [PHP](https://github.com/cosmemilton/sitef-php). A fonte canônica da ponte Rust é
este repositório. Cada cliente conserva uma cópia dos fontes para build independente,
com versão e hash registrados; as bibliotecas do fornecedor continuam externas.

