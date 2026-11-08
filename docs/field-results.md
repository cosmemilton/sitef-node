# Catálogo público e ocorrências de campos

`TransactionResult.data` é uma coleção `TransactionFields`. Ela preserva a ordem
observada, códigos repetidos, códigos desconhecidos, texto bruto e bytes quando
fornecidos pela ponte. Não funciona como whitelist. `result.fields` e `details`
continuam existindo para compatibilidade; a coleção não muda seus contratos.

`const result = await tx.process(callbacks)` na fachada `ClientSitef` retorna
o mesmo contrato completo de `client.transact(input)` na API anterior. Depois
de processar, `tx.result` guarda o resultado; em falha, `tx.partialResult`
expõe o parcial quando disponível. Não há resumo que descarte campos novos.
Veja [cliente e transações](client-transactions.md).

```ts
import { FIELD_CATALOG, type KnownFieldId } from '@cosmemilton/sitef';

const code: KnownFieldId = 134;
const description = FIELD_CATALOG[code].description;
const occurrences = result.data.getAll(code);
const last = result.data.getLast(code);
// last?.fieldType tem tipo 134; last?.raw continua string, inclusive para NSU.
// Campos novos do fornecedor continuam acessíveis por qualquer número.
const futureOccurrences = result.data.getAll(999999);
```

- `occurrences`: snapshot readonly de todas as ocorrências, na ordem original.
- `getAll(code)`: todas as ocorrências do código, sem descartar repetições.
- `getLast(code)`: última ocorrência ou `undefined`.
- Cada ocorrência contém `sequence`, `fieldType`, `command`, `direction`, `raw`
  e `sensitive` (`true`, `false` ou `'unknown'`). `sequence` identifica a ordem
  registrada; a coleção não reordena nem renumera entradas recebidas.
- `bufferBase64` e `decodingError`, quando presentes, preservam os bytes e o
  diagnóstico da decodificação. Não reconstrua bytes originais a partir de `raw`
  quando houve perda na decodificação.
- Entradas podem trazer `continueFlag`, `minLength`, `maxLength`, `validation` e `submission`.
  `not-submitted` significa que o envio ainda não foi tentado; `attempted`, que
  foi tentado; `returned`, que a chamada retornou. Isso não prova aceitação do
  dado pelo produto, autorização financeira ou confirmação da transação.
- `known`, `definition` e `context` descrevem reconhecimento no catálogo. A
  definição é metadado documental, não validação do valor retornado.

## Catálogo e tipos

`FIELD_CATALOG` contém as 536 definições individuais de `protocol/fields.json`,
com `code`, `name`, `description`, `dataType`, `origin` e demais metadados
canônicos. `FIELD_CATALOG_RANGES` contém as faixas detalhadas. O export legado
`FIELD_RANGES` permanece inalterado. `lookupFieldCatalog(code, context?)` resolve
as definições individuais e faixas, com o mesmo contexto usado pela camada
semântica. O contexto padrão é `transaction`; por exemplo, a faixa 800–849 é
reservada a `gerpdv`, e as faixas de leitura segura têm seu contexto próprio.
Definições individuais prevalecem no contexto de transação.

`ExplicitFieldId` é a união literal das 536 entradas individuais. `KnownFieldId`
inclui também os IDs de todas as faixas documentadas, inclusive as contextuais.
Um ID conhecido pode não ter definição no contexto consultado. Não é um enum de
valores: o campo 170, por exemplo, não implica um booleano nem os valores 0/1.
Os overloads numéricos sempre aceitam extensões desconhecidas do fornecedor.

Os tipos são gerados durante `scripts/sync-semantic-data.mjs`. Edite somente a
fonte canônica, não `field-ids.generated.ts`. Metadados de origem mantêm a revisão
VRS-258 e Carteiras Digitais 1.43 já registrada. A conferência dos 444 IDs da
seção 5.3.2 com VRS-260 não equivale à auditoria semântica completa dessa revisão,
nem a homologação. Nenhum PDF do fornecedor acompanha o pacote.

## Imutabilidade e privacidade

O construtor copia as ocorrências e protege profundamente os metadados.
Alterações futuras no array de origem não alteram o snapshot. A coleção guarda
os dados em campo privado; `JSON.stringify(data)` e `util.inspect(data)` exibem
somente `{ type: 'TransactionFields', count: n }`. Isso evita a exposição
acidental do conteúdo da coleção, inclusive quando anexada a outro objeto.

O acesso explícito por `occurrences`, `getAll` e `getLast` entrega os dados
integrais à automação. Esses resultados podem conter dados sensíveis, bytes,
comprovantes ou campos livres: não os registre automaticamente em logs. A
proteção da coleção **não** remove dados de `result.fields`, `result.details` ou
outros objetos legados; não imprima o resultado inteiro. A marca `sensitive`
não substitui política de acesso/retenção e `'unknown'` não significa seguro.

## Textos dos comprovantes 121 e 122

`result.details.receipts` contém os comprovantes recebidos. Cada ocorrência dos
campos 121 (via do cliente) e 122 (via da loja) traz seu texto em `buffer`.
Pode haver as duas vias, só uma, nenhuma ou ocorrências repetidas, conforme o
fluxo/configuração do SiTef. Não crie a via ausente nem trate repetição como erro.

A CLI apresenta somente essas ocorrências, na ordem do array, após receber o
resultado e antes da decisão. Identifica cada via/campo e conserva texto, espaços,
quebras de linha e repetições, removendo controles de terminal da apresentação.
Não altera `buffer`, bytes, `result.data`, `result.fields` ou o estado `printed`.
Não envia o texto à impressora e não atesta impressão/entrega ou assinatura.

Essa é uma visualização local intencional, não um log. `terminalIO` exige entrada
e saída TTY e rejeita redirecionamento. Não substitua esse IO por logger/arquivo
nem grave a sessão do terminal com dados reais. O resultado completo e seus
outros valores sensíveis continuam disponíveis apenas por acesso explícito; os
diagnósticos e snapshots financeiros não recebem os corpos dos comprovantes.

## Dados parciais, entradas e decisão financeira

```ts
import { getPartialTransaction } from '@cosmemilton/sitef';

try {
  const result = await tx.process(callbacks);
  const nsu = result.data.getLast(134)?.raw;
  // Entregue result à sua automação. Não registre result nem nsu em log.
  // Se status === 0 e result.requiresFinalization, decida depois.
  // await tx.confirm(); ou await tx.undo(); somente após a decisão explícita.
  // Não use um estado global para escolher qual resultado financeiro finalizar.
} catch (error) {
  const partial = tx.partialResult ?? getPartialTransaction(error);
  const occurrences = partial?.data.occurrences;
  // Disponível somente em memória; use explicitamente em sua aplicação.
  // Não envie a logs, telemetria ou arquivos de diagnóstico.
  throw error;
}
```

`data` está presente tanto em `TransactionResult` quanto em
`PendingTransactionsResult`. Saídas de comando0 são capturadas antes dos handlers
semânticos, inclusive a ocorrência que provocou uma falha e saídas recebidas
durante cancelamento cooperativo. Respostas textuais coletadas da automação são
registradas separadamente com `direction: 'input'`; o eco posterior da DLL é uma
nova ocorrência de saída. `result.fields` legado continua contendo apenas saídas.
Prompts de interface não são convertidos em valores de campo. Não são inventados
valores para campos que a DLL não enviou nem respostas que um callback não retornou.

`validation: 'accepted'` significa apenas que a resposta passou a validação local.
`rejected` conserva explicitamente a resposta inválida, sem enviá-la. A propriedade
`submission` distingue resposta não enviada, chamada tentada e chamada retornada.
Nem a validação nem a submissão comprovam aceitação do campo pelo SiTef. Respostas
de navegação/cancelamento não são apresentadas como um valor de campo submetido.
Um transporte interrompido não permite recuperar bytes que nunca chegaram à ponte.

`getPartialTransaction(error)` funciona para erros de `transact` e
`queryPendingTransactions` que tenham um snapshot associado. Retorna `undefined`
para erros não associados ou ocorridos antes de haver um ciclo. A associação usa
memória privada, sem adicionar os dados como propriedade do erro; desaparece se o
erro for serializado/reconstruído ou o processo terminar. Não há persistência dos
valores no snapshot financeiro. Um erro posterior de finalização não substitui o resultado já
entregue ao chamador: mantenha a referência original para tomar a decisão.

- `status`: código nativo terminal, somente quando conhecido; nunca inventa0/-2.
- `lastNativeStatus`: último retorno conhecido, que pode ser10000.
- `terminalKnown`: houve um retorno terminal, não que houve sucesso financeiro.
- `state`, `requiresFinalization` e `requiresRecovery`: estado local após o erro.
  Um retorno terminal0 seguido de falha em `onStateChange` ou no journal opcional pode exigir recuperação.
- `started`: a tentativa entrou na etapa nativa; não prova autorização da venda.

O retorno normal0 deixa uma operação financeira em `awaiting-finalization`.
A automação recebe os dados primeiro e decide confirmar ou desfazer; nenhuma
finalização negativa é feita por ausência de decisão. As exigências de impressão,
assinatura e avaliação do produto continuam ativas. No modo SDK, são geridas por
hooks; com `fields.finalizationResponsibility:'automation'`, a automação as cumpre
por seus próprios meios antes de confirmar. O modo explícito não transforma
visualização em impressão, não atesta assinatura e não ignora violações objetivas
ou falhas de interação. `FinalizaFuncaoSiTefInterativo`
não retorna confirmação remota; resultado local não prova o estado no servidor.
Consulte [o fluxo da CLI](windows-cli.md#decisão-da-automação-após-o-ciclo).

## Resultado sensível e snapshot de estado são contratos diferentes

`onStateChange(snapshot)` e `client.recovery` expõem metadados de pagamentos,
identidades fiscais, obrigações, referências/hashes e decisões. Não contêm a
coleção `data`, PAN, PIN, trilhas nem os corpos de comprovantes; não são um backup
dos valores retornados. NFPAG usa armazenamento externo específico. Não acrescente
segredos aos parâmetros livres ou aos objetos de persistência da aplicação.

O componente não cria arquivos por padrão. A automação escolhe sua persistência
e fornece `initialState` quando quiser restaurar um registro. Se o callback faz
persistência, deve resolver somente depois da gravação durável. Sem armazenamento
próprio, os dados de memória não sobrevivem ao fim do processo. O `journal`
opcional é compatibilidade explícita. Veja [estado da aplicação](application-state.md).

Pendências anteriores não impedem a próxima transação. Cada resultado mantém seu
`transactionId`; use esse ID ou `{fiscalDocument,fiscalDate}` para decidir depois.
`finalize(confirm)` rejeita múltiplos cupons/datas ambíguos. `client.state` é
agregado: pode continuar `uncertain` por um registro antigo enquanto o resultado
novo exige decisão. Inspecione o resultado e a pendência selecionada, não apenas
esse estado global. Operação simultânea ou conexão dessincronizada ainda impede
chamadas inseguras, sem retry automático.

`close()` não confirma nem desfaz, apenas encerra o transporte quando não há
operação ativa. O snapshot que a automação recebeu não é apagado por isso.
Preservar um registro local não comprova que a transação segue pendente no servidor
nem impede efeitos próprios da DLL. Restaurar metadados também não dispensa as
obrigações externas antes de confirmar. O modo SDK exige seus hooks; no modo
automation, a responsabilidade é assumida explicitamente pela aplicação.
V1 continua exigindo `attestLegacyObligations` e a recuperação permanece explícita.

A proteção contra inspeção acidental não é uma barreira contra acesso deliberado.
Por exemplo, `util.inspect` com `customInspect: false` e `getters: true` pode invocar
o getter `occurrences` e revelar os valores. Não configure loggers dessa forma;
não inspecione explicitamente as ocorrências ou os objetos legados com dados reais.
