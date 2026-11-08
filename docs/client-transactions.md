# ClientSitef e Transaction

A fachada separa a duração da conexão da duração de uma transação:

1. `await ClientSitef.create(config)` no início da aplicação/cliente.
2. `client.createTransaction(input)` para cada operação.
3. `await tx.process(callbacks)` para executar o ciclo e receber o resultado.
4. `await tx.confirm()` ou `await tx.undo()` somente depois da decisão explícita.
   Não escolher nenhuma das duas mantém a decisão pendente.
5. `tx.dispose()` quando a aplicação não precisar mais daquele objeto.
6. `await client.close()` no encerramento da aplicação, sem operação ativa.

`create` cria uma ponte, carrega a biblioteca e configura a sessão uma vez. Não
é singleton global: cada chamada cria outra conexão. `createTransaction` não
carrega/configura novamente e `dispose` não fecha o cliente. Reutilize o mesmo
cliente em operações sequenciais; não crie uma conexão por cartão nem use duas
conexões concorrentes para a mesma loja/terminal. Veja a [base documental e os
limites de concorrência](architecture.md#uma-conexão-várias-transações).

## Configuração e padrões

Importe `ClientSitef`, `Operations`, `TransactionControl` e os tipos
`ClientSitefOptions`, `ClientTransactionInput`, `TransactionCallbacks` e
`TransactionState` de `@cosmemilton/sitef`.

`ClientSitefOptions` conserva as opções de `createSitef`, substituindo
`interaction` por `callbacks?: TransactionCallbacks`:

- `bridgeExecutable`, `bridgeDirectory`, `libraryPath` e `workingDirectory`
  selecionam os executáveis e o diretório operacional do integrador.
- `configuration` recebe `server`, `storeId`, `terminalId`, `reserved` e
  `additionalParameters`. Não há IP, loja, terminal ou CNPJ fixo no SDK.
- `callbacks` define handlers padrão. `tx.process(callbacks)` substitui os
  handlers fornecidos somente para aquela transação, sem alterar os demais.
- `initialPinpadMessage` é opcional. Quando fornecida, chama a mensagem permanente
  do pinpad depois de configurar; exige retorno local 0. Não é chamada a cada
  transação nem comprova o que apareceu fisicamente no equipamento.
- `await client.escreverMensagemPinpad(mensagem)` escreve a mesma mensagem
  permanente depois da inicialização e devolve `{ status: number }`, preservando
  inclusive retornos não zero do fornecedor. A aplicação deve verificar o status;
  retorno local 0 não comprova o conteúdo exibido fisicamente.
  Aceita texto sem NUL, usa a codificação nativa configurada e rejeita status
  inválido. Não pode rodar durante uma operação ou em sessão fechada/dessincronizada.
  Também rejeita estado uncertain por falha de persistência após retorno conhecido,
  preservando os dados de recuperação até a reconciliação.
  Não confirma, desfaz nem altera uma transação pendente.
- `fields` aceita os hooks e políticas existentes. A fachada usa por padrão
  `finalizationResponsibility:'automation'` e `receiptStoragePolicy:'explicit-return'`.
  Valores explicitamente fornecidos, inclusive `'sdk'`/`'persist'`, prevalecem.
- `onStateChange`, `initialState`, `journal` e `stateDirectory` mantêm os contratos
  de [persistência opcional](application-state.md). O SDK não cria arquivos por
  padrão; a DLL do fornecedor pode criar seus próprios arquivos operacionais.
- `transportFactory` permite fornecer um `Transport` ou uma promessa dele, a
  partir das opções da ponte. É uma extensão para testes e adaptadores; não
  muda as etapas de carga, handshake e configuração.

`createSitef` e `SitefClient.connect` continuam disponíveis, com seus padrões
anteriores `'sdk'` e `'persist'`. Migrar para a fachada é uma escolha explícita
sobre quem cumpre as obrigações externas. Nenhuma API oferece autoFinalize.

## Entrada e operações

O [exemplo do README](../README.md#cliente-reutilizável-e-transações) mostra a
conexão e uma decisão completa. Cada transação aceita `functionId` ou seu alias
`operation`, nunca os dois no mesmo objeto. Os demais campos são os de
`TransactionInput`: `amount`, `fiscalDocument`, `fiscalDate`, `fiscalTime`,
`operator` e `additionalParameters` opcional.

| Atalho | Função | Uso |
| --- | --- | --- |
| `Operations.Payment` | 0 | Pagamento genérico, guiado pelo SiTef |
| `Operations.Debit` | 2 | Débito |
| `Operations.Credit` | 3 | Crédito |
| `Operations.Administrative` | 110 | Menu gerencial |
| `Operations.CommunicationTest` | 111 | Teste de comunicação |
| `Operations.WalletPayment` | 122 | Venda via carteira digital |
| `Operations.WalletCancellation` | 123 | Cancelamento via carteira digital |

Os atalhos não são uma whitelist: outros números nativos continuam aceitos.
`createTransaction(input, options?)` recebe `TransactionOptions`, incluindo
`signal`, `requiresFinalization` e `nativeStart`. Uma função conhecida conserva
sua política de finalização; funções sem política conhecida exigem escolha
explícita. Para 110, a CLI escolhe `requiresFinalization:'review-receipts'` e
mantém revisão separada, sem tratar recibos gerenciais como novo pagamento.

`amount` é texto decimal, nunca float. Pode ser vazio quando o próprio produto
coleta o valor. Identidade fiscal e parâmetros são responsabilidade da aplicação;
os parâmetros adicionais não são filtrados por uma lista fechada.

## Callbacks por responsabilidade

Os callbacks de comandos recebem `(request, {signal})` e podem ser síncronos ou
assíncronos. `request` mantém comando, TipoCampo, limites, texto, bytes e semântica
quando disponíveis. O objeto não esconde campos novos do protocolo.

| Callback | Comandos | Resposta |
| --- | --- | --- |
| `display` | 1–4, 11–16 | `void` ou `UiResponse`; recebe `target` e `action` |
| `menu` | 21, 42 | ID nativo como string ou `UiResponse` |
| `collect` | 30, 31, 34, 35, 41 | Texto ou `UiResponse`; recebe `secret` |
| `confirm` | 20 | Booleano ou `UiResponse`; true envia 0, false envia 1 |
| `event` | 0, 23 | Observação, sem resposta enviada ao protocolo |
| `receipt` | 0, campos 120/121/122/625 | `(receipt, {signal})`, observação aguardada; não confirma impressão |
| `application` | 29 | Dado da aplicação como texto ou `UiResponse` |
| `acknowledge` | 22 | `void` ou `UiResponse`, após a tecla exigida |
| `qr` | 50, 51, 52 | `void` ou `UiResponse`, após tratar exibição/remoção |
| `raw` | Fallback | `UiResponse`, para protocolo/interface próprios |

`display.target` distingue `operator`, `customer`, `both`, `menu-title` e
`header`; `action` distingue `show` e `clear`. `collect.secret` é verdadeiro
para comando 41 ou campo explicitamente sensível. Isso não substitui a política
de privacidade da aplicação: metadado desconhecido não torna o dado público.
O PIN de cartão pertence ao pinpad, não a uma coleta comum no computador.

O callback `confirm` responde uma pergunta dentro do ciclo. **Não confirma a
transação financeira.** A decisão financeira é `tx.confirm()` depois do retorno.
`menu` devolve o ID recebido, não posição visual nem rótulo. Menu com formato
`Mc` continua exigindo confirmação humana adicional e `confirmed:true` em
`UiResponse`; não retorne apenas a string nesse caso.

Para navegação/cancelamento, callbacks aceitam `TransactionControl.BACK` e
`TransactionControl.CANCEL`. `UiResponse` também mantém `buffer`, `bufferBase64`,
`continueFlag` e `confirmed`. Não presuma que `continueFlag:10000` seja confirmação:
ele tem o procedimento específico de coleta prévia descrito pelo protocolo.

`event` é opcional. Observação de polling não deve esperar interação nem bloquear
o ciclo; não use comando 23 para pedir Enter. O callback `qr` deve retornar
após apresentar/remover o QR, sem aguardar o pagamento terminar. Imprimir seu
payload como texto não implementa apresentação de QR.

`fields.hooks.resolveApplicationData`, quando fornecido, precede `application`
no comando 29. Sem handler especializado, `raw` recebe a interação; sem ambos,
o SDK falha explicitamente e aplica cancelamento cooperativo quando cabível.
Não inventa respostas nem trata um comando desconhecido como sucesso.

### Comprovantes durante o ciclo

`receipt` recebe uma cópia somente leitura do comprovante (texto, bytes, tipo,
via e `timing`). O callback é aguardado antes do próximo passo nativo e antes do
hook de impressão. `fields.hooks.onReceipt`, quando fornecido, tem precedência
sobre o callback `receipt`. Retornar `true` ou outro valor no observador não
significa impressão correta e não altera o Buffer nem `printed`.
Cancelar interrompe a espera do observador e impede iniciar impressão/armazenamento.
Isso não desfaz trabalho externo iniciado pelo callback: ele também deve observar
`signal` antes de seus próprios efeitos. Uma rejeição tardia não causa retry.

Para `timing:'immediate'`, forneça `fields.hooks.printReceipt`: retorne `true`
somente após a impressão exigida; `false` ou erro interrompe cooperativamente o
ciclo. Isso vale também para `finalizationResponsibility:'automation'`. Pelo
VRS-260 p.37, Continua=0 informa impressão correta e -1 informa que não ocorreu.
Exibir o texto não satisfaz esse contrato. Comprovantes são retidos antes dos
hooks; se houver erro, as ocorrências originais continuam em `tx.partialResult.data`,
sem dump automático nem uma nova tentativa. Os metadados preservam `printed:false`
quando não houve confirmação real pelo hook.

Comando20 responde a uma pergunta nativa pelo Buffer (0/1); a impressão usa
Continua (0/-1); a decisão financeira usa Finaliza. São contratos separados.
Tipo123=04/05 significa gerencial/Correspondente Bancário, não reimpressão.
Funções112–114 têm política não financeira no catálogo. Não extrapole essa
política para todo menu110, nem trate revisão local como pendência comprovada
no servidor.

## Resultado e estado

`process` é uma tentativa única por objeto. Não repita `process` para tentar
recuperar uma falha: ele recusa reutilização. Uma nova tentativa comercial deve
usar outro objeto, depois de tratar qualquer incerteza da tentativa anterior.

O retorno é o `TransactionResult` completo da API anterior:

- `status`: código nativo terminal, inclusive negativo ou desconhecido.
- `transactionId`, `groupId` quando presente e `requiresFinalization`.
- `data.occurrences`, `data.getAll(code)` e `data.getLast(code)`: saídas e entradas
  registradas, repetidas/desconhecidas, com texto e bytes preservados.
- `fields` e `details`: dados legados, comprovantes e avaliação semântica.

`tx.result` conserva esse resultado até `dispose`. Em erro, `tx.partialResult`
expõe o mesmo parcial de `getPartialTransaction(error)`, quando disponível;
`tx.status` só contém um código terminal conhecido, nunca um código inventado.
Um erro local com retorno nativo 0 continua sendo erro da aplicação. O resultado
original não é substituído por um resumo de confirmação posterior.

`tx.state` descreve o objeto/pagamento: `created`, `running`, `completed`,
`awaiting-finalization`, `finalizing`, `finalized-local`, `failed`, `uncertain`
ou `disposed`. `client.state` é agregado e pode refletir uma pendência antiga.
Use o resultado e o ID da transação selecionada, não o estado global, para decidir.

Os resultados são sensíveis. Não serializar em logs, telemetria ou diagnóstico.
A proteção contra inspeção acidental de `data` não protege acessos deliberados nem
os objetos legados. `onStateChange` recebe metadados, não esses valores nem os
corpos dos comprovantes. Veja [campos e dados parciais](field-results.md).

## Decisão, cancelamento e encerramento

`tx.confirm(extras?)` e `tx.undo(extras?)` usam o ID interno exato daquela
transação. Não selecionam a última operação do cliente e não ampliam a decisão
silenciosamente para outro pagamento. Sem índice 161 inequívoco e com vários
pagamentos do mesmo cupom/data, a guarda de escopo pode exigir uma decisão fiscal
explícita pela API avançada. A aplicação deve avaliar todo o alcance nativo.

No padrão automation, a aplicação deve avaliar o produto, entregar/imprimir os
comprovantes, coletar assinatura em papel quando 5074 exigir e concluir seu
fechamento antes de confirmar. Comprovantes 121/122 podem conter uma via, ambas,
nenhuma ou repetições; não criar vias ausentes nem deduplicar. Mostrar texto em
TTY não é impressão, entrega nem captura de assinatura.

Impressão imediata durante o ciclo continua exigindo um hook real. Violações
objetivas, recusa PBM, falhas de interação, revisão gerencial e guardas de status,
escopo, recuperação e sincronização continuam ativas. O modo automation não
fabrica flags `printed`/`signatureCaptured` nem exige hooks fictícios que retornem
sucesso. Veja [as responsabilidades completas](semantic-flows.md).

O resultado de finalização informa `returned:true` e
`remoteConfirmation:'not-reported'`: a chamada nativa `void` retornou localmente,
sem confirmação bancária remota. Não confirmar/desfazer em `finally`, ao perder
conexão ou como compensação automática de erro.

`tx.cancel()` pede cancelamento cooperativo somente do próprio ciclo ativo.
Aguarde `process` terminar antes de decidir o próximo passo. Não cancela outro
objeto, não é `undo` após o ciclo e não prova desfazimento remoto.

`tx.dispose()` rejeita ciclo/finalização ativa; fora deles, libera referências
do objeto e é idempotente. Não chama `Finaliza`, não apaga pagamentos do estado,
não libera a conexão e não promete apagar todas as cópias de dados da memória.
Resultados já guardados pela aplicação continuam referenciáveis; obrigações e
metadados pendentes continuam no cliente. Depois de `dispose`, os getters de
resultado/status deixam de fornecer o conteúdo do objeto descartado.

`client.close()` rejeita operação ativa e é idempotente depois de encerrar.
Com pendências e sem atividade, fecha o transporte sem decisão financeira nem
apagamento do snapshot entregue. Preservar estado local não comprova o estado
remoto nem impede efeitos próprios da DLL. Não existe `free` financeiro implícito.

## Consultas, recuperação e migração

`client.advanced` expõe o `SitefClient` completo. Por exemplo:

```ts
// Chamadas explícitas; não executar concorrentemente com process/confirm/undo.
const pending = await client.advanced.queryPendingTransactions({
  fiscalDocument: cupomSelecionado,
  fiscalDate: dataSelecionada,
});
// Sem o filtro, queryPendingTransactions() usa a função 130; com filtro, 131.
// Dados da consulta são sensíveis e não escolhem uma decisão financeira.
```

`finalizeTransaction`, `finalizeFiscal`, `finalizePayment`, `finalizeNetwork`,
`finalizeWithPayments` e `finalizeRecovery` conservam seus contratos em
`client.advanced`. Callbacks padrão de `ClientSitef.create({callbacks, ...})`
atendem as operações avançadas; callbacks de um `process` anterior não se tornam
os defaults das consultas seguintes. `client.capabilities`, `callNative`,
`validateBarcode` e `recovery` também estão disponíveis diretamente.

Uma pendência antiga não impede novo ciclo. Continua proibido sobrepor chamadas
ou usar uma conexão dessincronizada. Em `RECONNECT_REQUIRED`, feche e reabra
explicitamente antes de consultar/decidir, sem repetir a operação incerta.
`initialState` restaura somente o registro que a aplicação escolheu;
`finalizeRecovery` pressupõe reconciliação e conserva decisão/escopo já gravados.
Não altera nem importa journals antigos automaticamente.

Para migrar, mantenha o cliente durante a vida da aplicação, mova a interação
para callbacks e troque `transact` por `createTransaction`/`process`. Troque a
decisão por ID por `tx.confirm()`/`tx.undo()` enquanto o objeto existir; use a API
avançada para estado restaurado ou decisão de escopo fiscal. Preserve os registros
anteriores e escolha conscientemente os novos padrões de responsabilidade.
O [guia de estado e migração](application-state.md) detalha V1/V2, persistência,
obrigações e recuperação. Testes sintéticos não equivalem a homologação.

### Política do simulador de PDV em linha de comando

A CLI Windows adota explicitamente impressão simulada por tela: seu handler
`printReceipt` aguarda a apresentação e retorna true, sem perguntar ao operador.
Esse comportamento pertence ao exemplo, não ao componente. Uma automação real
fornece seu próprio handler e o resultado da impressão exigida pelo produto.
A confirmação de pagamento continua separada; esta simulação de impressão não
configura servidor de homologação nem transforma operações reais em testes.