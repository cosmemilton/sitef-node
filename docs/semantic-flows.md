# Contrato semântico e migração 0.2

`fieldDefinition(id, context?)` e `functionDefinition(id)` consultam o catálogo
completo dos documentos recebidos. `result.details` contém campos interpretados,
campos brutos preservados, contas, comprovantes e avaliação. Esses dados podem ser
sensíveis e não devem ser registrados automaticamente. O subpath
`@cosmemilton/sitef/fields` funciona também no frontend, sem dependências Node.

## Fachada nova e compatibilidade

`ClientSitef.create` e os objetos `Transaction` usam este mesmo motor semântico.
`tx.process(callbacks)` devolve o `TransactionResult` integral; `tx.confirm()` e
`tx.undo()` finalizam por ID, respeitando as guardas de escopo. A conexão é criada
uma vez e reutilizada entre transações. Consultas, seletores fiscais e recuperação
continuam disponíveis em `client.advanced` e nunca são automáticos.

Os padrões de `ClientSitef.create` são responsabilidade `'automation'` e
armazenamento `'explicit-return'`. Os padrões `'sdk'` e `'persist'` descritos
para a API anterior continuam em `createSitef` e `SitefClient.connect`. A nova
fachada também aceita esses valores explicitamente e preserva os hooks reais
fornecidos. Nenhuma modalidade cria atestados fictícios de impressão/assinatura.
Veja [cliente e transações](client-transactions.md).

## Coletas

`request.semantic` informa formato, precisão, escolhas, sensibilidade e permissão
de cancelamento parcial. A resposta continua `{buffer, continueFlag}`. Menu `Mc`
exige também `confirmed:true` após confirmação humana adicional. Formato `S`
fora do comando 20 precisa de `yesNoValues` explícito ou resolução da aplicação;
não presumimos os códigos aceitos. `AN` aceita texto encodável, sem inventar uma
restrição de alfabeto que o manual não especifica.

`resolveApplicationData(request, context)` resolve comando 29 sem formulário humano.
Na ausência desse hook, o callback da aplicação recebe o comando. O modal exige um
resolver de sistema. Campos desconhecidos mantêm números e buffers; comandos novos
exigem tratamento explícito.

Valores usam `{unscaled,scale}`, sem float. Quando 109/137/138 não têm escala
definida, configure `monetaryFormats` por campo (`decimal-comma` ou `minor-units`)
ou `resolveField`. A mesma regra vale para precisões de combustível não informadas.

## Obrigações externas

Configure `fields.hooks`. Os hooks recebem contexto com identidade do pagamento/grupo,
função, entrada original, sinal de cancelamento e flag de recovery. Na API
anterior, o padrão `fields.finalizationResponsibility:'sdk'` gerencia as obrigações anteriores à
confirmação pelos hooks; a alternativa explícita `'automation'` está descrita abaixo.

| Hook | Contrato |
| --- | --- |
| `storeReceipt` | Salvar o corpo por ID; true após persistir |
| `loadReceipt` | Recuperar o corpo por referência para comparação de hash |
| `onReceipt` | Observação aguardada com cópia imutável, antes da impressão; não a atesta |
| `printReceipt` | true somente após impressão/entrega exigida pelo produto |
| `captureSignature` | Atestar assinatura em papel exigida por 5074, depois da impressão |
| `lockResources` / `unlockResources` | Coordenar recursos compartilhados e confirmar operação |
| `resolveField` | Resolver dado/formato sem definição suficiente no manual |
| `validateTransaction` | Validar regras de produto e avaliação efetivamente |
| `acceptFallback` | Aceitar fallback de Carnê para transação à vista |
| `resolveConfirmationNetwork` | Resolver rede sem inferir relação entre 131 e 158 |
| `storeFinalizationPayload` | Persistir parâmetros NFPAG fora do journal, por ID/hash |
| `loadFinalizationPayload` | Restaurar os parâmetros exatos do plano NFPAG |
| `attestLegacyObligations` | Certificar recibos, assinatura e regras que V1 não registrava |

`receiptStoragePolicy:'persist'` (padrão da API anterior) exige salvar comprovantes.
`'explicit-return'` transfere essa responsabilidade à aplicação; impressão e
assinatura continuam exigidas. O snapshot de estado armazena referência/hash/estado, nunca
os corpos de comprovantes ou NFPAG. Não inclua segredos nos parâmetros livres.

Erro de hook solicita cancelamento cooperativo e drena o ciclo. Se a DLL ainda
retornar aprovação, o pagamento permanece pendente e sua confirmação é bloqueada;
`finalizeTransaction(false, id)` permite a decisão explícita de desfazer, sem dispensar seleção segura do escopo. Falha de impressão não vira impressão aceita.

## Responsabilidade explícita pela finalização

`fields.finalizationResponsibility` aceita `'sdk'` ou `'automation'`. O padrão
é `'sdk'` na API anterior e `'automation'` em `ClientSitef.create`.
Não é uma opção de finalização automática nem muda a política de armazenamento.

- `'sdk'`: mantém revisão de produto e hooks de impressão posterior ao ciclo e
  captura de assinatura antes de confirmar. Uma revisão não resolvida pode
  manter `confirmationAllowed:false`.
- `'automation'`: a automação recebe resultado, comprovantes e obrigações, cumpre
  impressão/entrega, assinatura em papel e regras do produto por seus próprios
  meios e envia sua decisão explícita por `finalize(true)` ou pelo seletor
  apropriado. Revisão genérica, ambiguidades monetárias, parcial/saldo/troco e
  fallback de Carnê não vetam essa decisão nem exigem hooks fictícios. A avaliação
  permanece disponível para a automação, sem tornar revisão em prova de validação.

O modo automation não dispensa violações objetivas, `PBM_DECLINED`, falhas de
interação, revisão gerencial ou guardas de status, escopo, recuperação e conexão
sincronizada. Um hook configurado que rejeita a validação ou falha não é tratado
como simples ausência de revisão; a decisão posterior não apaga seu veto.
Comprovantes administrativos/CB que exigem impressão imediata
continuam exigindo `printReceipt` durante o ciclo. Campo/comando sem tratamento
continua falhando explicitamente. Erro não autoriza retry ou desfazimento automático.

`confirmationAllowed` conserva o parecer da avaliação SDK e pode permanecer
`false` antes da decisão mesmo em automation. Não é um veto absoluto nesse modo:
a finalização positiva explícita pode resolver somente as revisões permitidas
acima. Ao preparar o plano autorizado, o SDK persiste `confirmationAllowed:true`
e a responsabilidade assumida. Assim, restaurar um resultado ainda não decidido
com o padrão SDK não herda aprovação genérica do modo automation anterior.

A decisão/plano registra `PaymentRecord.finalizationResponsibility`. O SDK não
marca recibos `printed:true` nem `signatureCaptured:true` sem ter observado os
hooks reais. Ausência dessas marcas no modo automation não significa que o SDK
atestou ou executou as obrigações. A aplicação é responsável pelo cumprimento.
Um plano já persistido conserva a responsabilidade original ao ser retomado,
mesmo que a nova conexão use outro padrão. V1 continua exigindo
`attestLegacyObligations`; escolher automation não certifica o estado antigo.

Base documental: VRS-260, p.8, atribui impressão e decisão à automação; p.38
descreve as vias 121/122; p.54 exige assinatura em papel no campo 5074; p.55
descreve `FinalizaFuncaoSiTefInterativo`, sem retorno. Essa opção não substitui
homologação nem confirma retrospectivamente operações pendentes.

## Estado da automação e decisão

O componente não exige journal nem cria arquivos por padrão. `onStateChange`
recebe uma cópia dos metadados e é aguardado; a automação implementa persistência,
alertas, seleção de registros e restauração por `initialState`. `client.recovery`
expõe uma cópia do estado atual. O adaptador `journal` permanece opcional; não pode
ser combinado com `initialState`. Uma conexão com pagamento pendente restaurado
começa com estado agregado `uncertain`, para revisão, sem tornar a conexão nativa
dessincronizada nem bloquear só por isso uma transação nova.
Detalhes em [estado da aplicação](application-state.md).

Uma transação anterior aguardando decisão não bloqueia um novo `transact`, mesmo
com outro cupom. `appendPayment:true` permanece compatível, mas não é necessário.
A identidade e as obrigações de cada pagamento são preservadas. Não se permite
sobreposição de operações na mesma instância nem chamadas inseguras em conexão
dessincronizada após resultado nativo incerto. Coordenação entre processos e
pinpads é responsabilidade do integrador, sem mutex global embutido.

Escolha o alcance da decisão:

- `finalizeTransaction(confirm, transactionId)` seleciona o ID local, usando o
  índice 161 quando disponível. Sem índice, só é seguro quando não há outro
  pagamento pendente do mesmo cupom/data; do contrário, a API recusa o escopo.
- `finalizeFiscal(confirm, {fiscalDocument, fiscalDate})` seleciona explicitamente
  todos os pagamentos pendentes daquele cupom/data, preservando a hora original.
- `finalize(confirm)` é compatibilidade para um único cupom/data pendente. Vários
  escopos geram `FINALIZATION_SCOPE_REQUIRED`, sem chamada nativa.
- `finalizePayment(confirm,id)` exige índice 161 único naquele cupom/data.
- `finalizeNetwork(confirm,rede)` exige rede resolvida para todos os pendentes e
  rejeita seleção que atravesse mais de um cupom/data.

`confirmationNetworkField:131|158` é uma escolha explícita do integrador.
Seletores reservados não são aceitos na string livre de finalização. O plano
completo é registrado no estado antes da primeira chamada nativa; o callback de
persistência ou journal opcional deve concluir antes de avançar.

`finalizeWithPayments(confirm,id,methods,total)` compõe NFPAG conforme 730/731/732.
A presença de 730 é obrigatória ao montar NFPAG; ausente não significa ilimitado.
A soma é exata. Cada método usa `{type,amount,data}`, valor com vírgula e duas casas.
ID13 restringe a rede do ID03 e não é emitido como dado. O índice seleciona quem
recebe os dados, mas a chamada finaliza todos os pagamentos do mesmo cupom/data.
Os hooks externos de payload são obrigatórios para retomar esse plano sensível.
Se `methods` for `undefined`, `paymentData(requirements, context)` fornece os métodos;
o total permanece explícito e métodos fornecidos pelo chamador não são substituídos.

`queryPendingTransactions()` usa função 130; com `{fiscalDocument,fiscalDate}`, 131.
Não sobrescreve o estado financeiro. Uma conexão com chamada nativa incerta deve
ser fechada e reconectada explicitamente antes de consultar; um registro histórico
incerto não é por si só uma chamada em execução na nova conexão.
`finalizeRecovery(confirm,groupId,extras?,scope?)` exige reconciliação prévia da
aplicação. `scope` seleciona `{transactionId}` ou `{fiscalDocument,fiscalDate}`.
Um plano persistido aceita só decisão/escopo originais e retoma apenas partições
incertas. Se o alcance nativo da retomada incluir pagamentos acrescentados depois
e ausentes do plano, a API recusa `RECOVERY_SCOPE_MISMATCH`, sem ampliar a decisão.
Falha de preparação mantém estado incerto. Restaurar estado não atesta impressão,
assinatura, validação de produto nem aceitação remota; as guardas continuam.

Journals V1 são lidos e normalizados para V2; confirmar exige
`attestLegacyObligations` retornar true. `initialState` com NFPAG embutido em
`finalizationParameters` é recusado com `LEGACY_PAYLOAD_MIGRATION_REQUIRED`
antes de qualquer hook de migração ou callback de estado. A automação deve migrar
explicitamente o payload para referência/hash externos, sem descartar seu conteúdo.
O adaptador `journal` opt-in conserva a migração legada por
`storeFinalizationPayload` e pode regravar o registro normalizado. Preserve o
arquivo original antes da migração; restaure uma cópia conferida e grave novos
snapshots em destino separado.

A rotina nativa de finalização retorna void. `returned:true` comprova retorno
local, sem inventar confirmação remota. Recusas nativas mantêm seu código original.
Não repetimos cobranças ou decisões automaticamente. `close()` aceita pendência
sem operação ativa, fecha transporte e não chama `Finaliza`; conserva os metadados
locais, sem afirmar como o servidor ou a DLL irão tratar o encerramento.

## Saídas informativas sem enumeração conhecida

Quando comando0 devolve um indicador170/174/724–727/2974, não é necessário
resolver a semântica para continuar. O resultado mantém o texto bruto e o valor
{code:raw,label:undefined}. fields.hooks.resolveField permanece opcional para
quem conhece a codificação específica do produto; seu retorno não altera os
bytes enviados de volta à CliSiTef. O componente não transforma indicadores
em booleanos, não cria coleta na CLI e não os inclui no snapshot financeiro.
