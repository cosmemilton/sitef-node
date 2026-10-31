# Contrato semântico e migração 0.2

`fieldDefinition(id, context?)` e `functionDefinition(id)` consultam o catálogo
completo dos documentos recebidos. `result.details` contém campos interpretados,
campos brutos preservados, contas, comprovantes e avaliação. Esses dados podem ser
sensíveis e não devem ser registrados automaticamente. O subpath
`@cosmemilton/sitef/fields` funciona também no frontend, sem dependências Node.

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
função, entrada original, sinal de cancelamento e flag de recovery.

| Hook | Contrato |
| --- | --- |
| `storeReceipt` | Salvar o corpo por ID; true após persistir |
| `loadReceipt` | Recuperar o corpo por referência para comparação de hash |
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

`receiptStoragePolicy:'persist'` (padrão) exige salvar comprovantes.
`'explicit-return'` transfere essa responsabilidade à aplicação; impressão e
assinatura continuam exigidas. O journal armazena referência/hash/estado, nunca
os corpos de comprovantes ou NFPAG. Não inclua segredos nos parâmetros livres.

Erro de hook solicita cancelamento cooperativo e drena o ciclo. Se a DLL ainda
retornar aprovação, o pagamento permanece pendente e sua confirmação é bloqueada;
`finalize(false)` continua disponível. Falha de impressão não vira impressão aceita.

## Grupo e decisão

`transact(input,{appendPayment:true})` acrescenta pagamento após o primeiro. No
mesmo dia, mantenha o cupom; após virar a data, o grupo pode conter nova identidade.
A finalização faz uma chamada por cupom/data e preserva a hora original. O plano
completo é salvo antes da primeira chamada nativa.

`finalize(confirm)` atua sobre todos os pendentes. `finalizePayment(confirm,id)`
exige índice 161 único. `finalizeNetwork(confirm,rede)` exige rede resolvida para
todos os pendentes. `confirmationNetworkField:131|158` é uma escolha explícita do
integrador. Seletores reservados não são aceitos na string livre de finalização.

`finalizeWithPayments(confirm,id,methods,total)` compõe NFPAG conforme 730/731/732.
A presença de 730 é obrigatória ao montar NFPAG; ausente não significa ilimitado.
A soma é exata. Cada método usa `{type,amount,data}`, valor com vírgula e duas casas.
ID13 restringe a rede do ID03 e não é emitido como dado. O índice seleciona quem
recebe os dados, mas a chamada finaliza todos os pagamentos do mesmo cupom/data.
Os hooks externos de payload são obrigatórios para retomar esse plano sensível.
Se `methods` for `undefined`, `paymentData(requirements, context)` fornece os métodos;
o total permanece explícito e métodos fornecidos pelo chamador não são substituídos.

`queryPendingTransactions()` usa função 130; com `{fiscalDocument,fiscalDate}`, 131.
Funciona em estado incerto sem escrever no journal financeiro.
`finalizeRecovery(confirm,groupId)` exige reconciliação prévia da aplicação. Um plano
persistido aceita só decisão/escopo originais e retoma apenas partições incertas.
Falha de preparação mantém estado incerto.

Journals V1 são lidos e convertidos para V2; confirmar exige
`attestLegacyObligations` retornar true. Um NFPAG legado é transferido por
`storeFinalizationPayload` antes de regravar o journal; sem esse hook, a conexão
informa a migração necessária e o arquivo original é preservado.

A rotina nativa de finalização retorna void. `returned:true` comprova retorno
local, sem inventar confirmação remota. Não repetimos cobranças automaticamente.
