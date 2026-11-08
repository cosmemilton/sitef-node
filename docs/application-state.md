# Estado da aplicação e migração

Contrato atualizado em 2026-11-07. O componente comunica com o SiTef, preserva
resultados e expõe consulta/finalização. Persistência, avisos de pendência,
restauração e coordenação de processos/PDVs são responsabilidades da automação.

## Cliente reutilizável

A integração nova usa `ClientSitef.create(config)` uma vez no início da aplicação,
seguido de quantos `client.createTransaction(input)` forem necessários, em série.
Cada objeto executa `tx.process(callbacks)` e devolve seu próprio resultado;
`tx.confirm()`/`tx.undo()` selecionam seu ID, sem depender da última transação.
`tx.dispose()` não decide nem apaga o snapshot. `client.close()` encerra a conexão
somente quando não há operação ativa. Consulte [o contrato completo](client-transactions.md).

`ClientSitef.create` aceita a mesma persistência opcional descrita abaixo. A
fachada usa por padrão `fields.finalizationResponsibility:'automation'` e
`receiptStoragePolicy:'explicit-return'`. A aplicação entrega/imprime os
comprovantes e coleta assinatura em papel quando exigida antes de confirmar.
`createSitef` e `SitefClient.connect` conservam os padrões anteriores `'sdk'` e
`'persist'`; os exemplos avançados deste guia usam essa API anterior.

Os métodos de consulta e recuperação continuam explícitos em `client.advanced`:
por exemplo, `client.advanced.queryPendingTransactions()` e
`client.advanced.finalizeRecovery(...)`. Não são disparados por `create`,
`createTransaction`, `dispose` ou `close`. `client.recovery` mantém acesso à
cópia dos metadados. Uma nova conexão não reconcilia a transação antiga.

## Conexão sem persistência obrigatória

`SitefClient.connect` e `createSitef` aceitam:

- `fields.finalizationResponsibility?: 'sdk' | 'automation'`: política explícita
  para as obrigações anteriores à confirmação; o padrão é `'sdk'`.
- `journal?: Journal`: adaptador opcional de persistência e lock.
- `initialState?: JournalRecord`: registro selecionado explicitamente para
  restauração. Não pode ser combinado com `journal`.
- `onStateChange?(snapshot)`: callback aguardado, com uma cópia isolada dos
  metadados V2 (`Readonly<GroupJournalRecord>`).
- `client.recovery`: getter com uma cópia do estado atual ou `undefined`.
  Apesar do nome histórico, também permite obter metadados de uma sessão normal.

Sem adaptador nem callback de persistência, o componente mantém estado somente
em memória e não cria arquivos. Em `createSitef`, `stateDirectory` é opt-in do
`FileJournal` legado; não pode ser combinado com `journal` ou `initialState`.
Ausência de estado em disco do SDK não impede arquivos internos da DLL do fornecedor.

Exemplo de integração, com armazenamento implementado pela aplicação:

```ts
const client = await SitefClient.connect({
  transport,
  configuration,
  interaction,
  initialState: registroSelecionado, // undefined em uma sessão nova
  onStateChange: async snapshot => {
    await meuArmazenamento.gravarAtomicamente(snapshot);
  },
  fields: { hooks: meusHooksReais },
});

const result = await client.transact(input);
await minhaAutomacao.consumir(result); // contém dados sensíveis, não é um log
if (result.status === 0 && result.requiresFinalization) {
  const decision = await minhaAutomacao.decidir(result);
  if (decision === 'confirm' || decision === 'undo') {
    await client.finalizeTransaction(decision === 'confirm', result.transactionId);
  }
}
// Sem decisão explícita, nenhuma Finaliza é enviada.
await client.close();
```

O callback deve resolver somente depois de cumprir a persistência prometida pela
aplicação; não disparar gravação sem aguardá-la. Falha antes de iniciar a chamada
nativa impede o início. Falha após um retorno terminal pode gerar
`JOURNAL_UNCERTAIN`; `getPartialTransaction(error)` preserva os dados/código
conhecidos em memória. Falha de armazenamento não autoriza repetir uma cobrança
nem enviar decisão compensatória. Se nenhum callback foi fornecido, a atualização
é apenas de memória: não existe garantia de durabilidade.

## Responsabilidade pela confirmação

No padrão `fields.finalizationResponsibility:'sdk'`, revisão de produto,
impressão posterior ao ciclo e assinatura obrigatória são geridas pelos hooks.
Com `'automation'`, a aplicação assume essas obrigações e só deve chamar
`finalizeTransaction(true, id)` ou outra finalização positiva depois de cumpri-las.
A chamada expressa sua decisão; não exige um segundo prompt nem hooks que retornem
`true` sem realizar impressão ou captura. `receiptStoragePolicy` é independente:
`'explicit-return'` não escolhe a política de finalização.

Revisão genérica, ambiguidades de interpretação, pagamento parcial, saldo/troco e
fallback de Carnê ficam para a decisão da automação nesse modo explícito.
Violações objetivas, recusa PBM, falha de interação, revisão gerencial, resultado
inválido/incerto e guardas de escopo/sincronização não são dispensados. Obrigações
de impressão imediata durante o ciclo continuam exigindo hooks reais.

`confirmationAllowed` preserva a avaliação SDK e pode continuar `false` no
resultado ainda não decidido, mesmo em automation. A finalização explícita pode
resolver as revisões permitidas nesse modo e só então registra `true` junto do
plano. Restaurar um resultado sem decisão com o padrão SDK não herda aprovação
automática da configuração anterior.

`PaymentRecord.finalizationResponsibility` registra a responsabilidade junto da
decisão/plano. Não é prova de impressão ou assinatura: `printed` e
`signatureCaptured` não passam a `true` só porque a automação confirmou. Não altere
essas flags manualmente. Um plano de recuperação já gravado mantém sua política,
decisão e escopo; reconectar sem opt-in não provoca nova impressão desse plano.
Planos V2 antigos já iniciados, sem esse metadado, conservam a política SDK;
reconectar em automation não os converte nem dispensa suas obrigações. A política
é capturada na conexão: alterar depois o objeto de configuração não muda uma
decisão em andamento.
A opção não restaura, confirma ou desfaz nenhuma pendência automaticamente.

## O que o snapshot preserva

O estado registra loja/terminal, IDs, identidades fiscais originais, pagamentos,
estados, obrigações externas, referências/hashes de comprovantes e o plano/decisão
de finalização quando existentes. Não contém PAN, PIN, trilhas, a coleção bruta de
campos ou os corpos completos de comprovantes. Payloads NFPAG são tratados pelos
hooks específicos de armazenamento externo, fora do registro financeiro.

`result.data`, `result.fields`, `result.details` e os dados parciais têm outro
contrato: entregam conteúdo sensível por acesso explícito. Não serialize o
resultado em logs, telemetria ou diagnósticos. A aplicação deve definir acesso,
retenção e armazenamento apropriados para os dados que realmente precisar
consumir. Não coloque segredos nos parâmetros livres ou metadados fornecidos
pela própria aplicação. Veja [ocorrências de campos](field-results.md).

O snapshot acumula os metadados da instância e do registro restaurado. Não descarta
automaticamente pagamentos concluídos e não descobre o histórico de outras
execuções que não foram restauradas. Cabe à automação definir retenção,
arquivamento e seleção de estado sem perder pendências, obrigações ou decisões
incertas. O `FileJournal` opcional tem seus próprios limites de tamanho; não são
um teto de persistência do core em memória nem uma promessa de histórico ilimitado.

## Cancelamento enquanto a automação grava

Se o snapshot `started` foi gravado e o operador cancelou antes da chamada
nativa, o SDK registra a tentativa como `ended`, sem inventar um código nativo,
e inclui `ABORTED_BEFORE_START` em `assessmentIssues`. O callback recebe essa
correção; o erro continua `ABORTED` e `getPartialTransaction(error).started` é
`false`. Nenhum `start` nem `finish` foi enviado ao SiTef.

Se a gravação corretiva falhar, o erro é `STATE_PERSISTENCE_FAILED`, também com
`started: false`. `requiresRecovery: true` nesse parcial indica reparar o estado
externo da automação, não uma cobrança nativa de resultado desconhecido. Não há
repetição automática da gravação. Se a primeira gravação já falhou, não se tenta
uma segunda: a aplicação deve verificar eventual escrita parcial e usar os dados
do erro e de `client.recovery`, sem presumir que nada chegou ao armazenamento.

## Pendência não é operação em execução

Um retorno terminal 0 com finalização pendente não impede outro `tx.process`
na fachada, nem outro `transact` na API anterior,
inclusive com outro cupom/data. `appendPayment:true` continua aceito por
compatibilidade, mas não é exigido para acrescentar uma transação. O registro
anterior não é sobrescrito pela transação seguinte. Um snapshot restaurado com
pendência/incerteza histórica também não bloqueia por si só uma nova transação.
Ao conectar com qualquer pagamento pendente restaurado, `client.state` começa em
`uncertain` para revisão; isso é diferente da conexão nativa dessincronizada e
não cria, por si só, um bloqueio de novo `transact`.

A aplicação pode mostrar lembretes adequados ao seu fluxo. A recusa nativa do
SiTef continua sendo devolvida no código original, sem ser trocada por um bloqueio
local de pendência, repetida ou tratada como aprovação. Uma nova venda nunca é um
procedimento de resolução ou retry de uma venda anterior incerta.

As seguintes guardas permanecem:

- Não sobrepor ciclos, consultas ou finalizações na mesma instância.
- Não usar uma conexão que perdeu sincronização após chamada nativa incerta.
  `RECONNECT_REQUIRED` exige fechar e reconectar explicitamente antes de consultar
  ou decidir. Isso não recupera o resultado perdido nem reconcilia o servidor.
- Não confirmar sem concluir as obrigações de impressão, assinatura e produto.
- Não ampliar silenciosamente o alcance de uma finalização ambígua.

`client.state` é agregado. Pode continuar `uncertain` por uma pendência antiga
mesmo que o novo `TransactionResult` tenha status0 e exija decisão. Use
`transactionId`, `requiresFinalization` e o registro selecionado para decidir;
não tome o estado global como identidade da última transação.

## Seleção explícita para finalizar

- `finalizeTransaction(confirm, transactionId, extras?)` decide somente aquele ID
  local. Se existir índice161, usa o seletor correspondente. Sem índice, só aceita
  quando esse é o único pagamento pendente no cupom/data; caso contrário lança
  `PAYMENT_INDEX_REQUIRED`, sem ampliar para o cupom inteiro.
- `finalizeFiscal(confirm, {fiscalDocument,fiscalDate}, extras?)` decide todos os
  pagamentos pendentes do cupom/data escolhido. Considere o alcance fiscal da
  rotina nativa, inclusive o estado conhecido pela automação fora desta instância.
- `finalize(confirm, extras?)` permanece para um único cupom/data pendente.
  Mais de um escopo gera `FINALIZATION_SCOPE_REQUIRED`.
- `finalizePayment`, `finalizeNetwork` e `finalizeWithPayments` mantêm suas regras
  de índice, rede e NFPAG. Veja [contrato semântico](semantic-flows.md).

Restaurar metadados não cria evidência de impressão/assinatura nem valida produto.
A política de responsabilidade e as guardas continuam valendo: o modo SDK exige
os handlers; o modo automation exige que a aplicação cumpra as obrigações antes
de decidir. Um recibo por referência precisa ser recuperado e verificado quando
a etapa executada pelo SDK exigir seu corpo. Estado V1 tem
obrigações desconhecidas e exige `attestLegacyObligations` antes da confirmação.
Não modifique flags manualmente para contornar isso.

`finalizeRecovery(confirm, groupId, extras?, scope?)` é recuperação explícita
depois da reconciliação pela aplicação; `scope` pode ser `{transactionId}` ou
`{fiscalDocument,fiscalDate}`. Um plano já registrado conserva decisão e escopo,
incluindo as partes que retornaram localmente. Se uma decisão fiscal, por rede ou
NFPAG alcançaria outros pagamentos adicionados depois e ausentes do plano
registrado, a retomada recusa `RECOVERY_SCOPE_MISMATCH`; não amplia o plano.
Nenhuma consulta escolhe confirmar ou desfazer. A rotina nativa é void: `returned:true` e
`remoteConfirmation:'not-reported'` atestam retorno local, não confirmação bancária.

## Encerrar não decide

`close()` pode fechar o transporte com pendências quando não há operação ativa.
Não chama `Finaliza`, não escolhe confirmar/desfazer e não apaga o snapshot já
entregue à aplicação. Se a aplicação quer retomar depois de encerrar o processo,
deve ter persistido seu estado. O fechamento não comprova que o servidor mantém
uma pendência nem impede efeitos próprios da DLL. Não confirmar em `finally`.

Os hooks5042/5043 e a serialização local não são mutex global. O integrador
coordena processos, instâncias, PDVs e o pinpad. Optar por `FileJournal` dá lock
apenas por arquivo, não exclusividade física de todo o terminal. Arquivos
diferentes podem coexistir; isso não autoriza uso simultâneo do equipamento.

## Migração sem apagar estado anterior

1. Preserve journals, locks e evidências anteriores. Não renomeie, remova, recrie
   ou regrave arquivos operacionais para desbloquear uma venda.
2. Escolha explicitamente a evidência a importar, conferindo loja, terminal,
   cupom/data, IDs, estado e plano. A existência ou ausência de lock/PID não
   comprova conclusão remota nem exclusividade do terminal.
3. Reconcilie operações incertas pelos procedimentos do produto e, quando
   autorizado, pelas consultas130/131. Documento não encontrado (-13) e ausência
   de pendência local não comprovam cancelamento remoto.
4. Passe uma cópia conferida em `initialState` e persista novos snapshots em
   destino separado por `onStateChange`. Não passe simultaneamente `journal`.
   A normalização V1/V2 não dispensa as obrigações. Se `initialState` ainda
   contiver NFPAG embutido em `finalizationParameters`, a conexão recusa com
   `LEGACY_PAYLOAD_MIGRATION_REQUIRED` antes de chamar `storeFinalizationPayload`
   ou `onStateChange`. A automação precisa migrar explicitamente o payload para
   armazenamento externo com referência/hash; não apague dados para contornar o
   erro. O `journal` opt-in conserva sua migração legada e pode regravar o registro,
   portanto preserve primeiro a evidência original.
5. Substitua decisões genéricas por ID/escopo fiscal. Mantenha os avisos ao operador
   e a coordenação de recursos na automação. Não implemente retry financeiro
   automático em falhas de transporte, callback, impressão ou persistência.

A CLI escolhe um caminho novo por execução iniciada e grava seus snapshots em
`root/state/automation/<UUID>.journal.json` quando eles existirem. Todas as
transações do loop da mesma execução compartilham esse estado acumulado, sem
recriar o cliente ou restaurar automaticamente registros anteriores. --verificar e
sair no menu não criam registro nem lock. Registros/locks legados e execuções
anteriores são consultados somente para aviso, sem restauração ou alteração
automática. O reconciliador aceita `--registro CAMINHO_ABSOLUTO` para escolher
explicitamente um registro; sem essa opção usa o caminho legado. Selecionar um
arquivo não autoriza consulta nativa nem enfraquece exigências de grupo, hash,
evidências e lock. Ele não finaliza nem arquiva locks automaticamente.
Veja [o guia Windows](windows-cli.md).

Esta mudança foi preparada sem executar DLL, pinpad, transação ou consulta real e
sem ler ou alterar journals operacionais. Testes sintéticos não são homologação.
A CLI não ativa nem comprova simulação: trate sua execução como potencialmente
produtiva e confira a configuração do integrador.
