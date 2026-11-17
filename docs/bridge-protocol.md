# Protocolo da ponte, versão 1

Este é o contrato de comunicação comum à ponte Rust própria e aos clientes Node.js,
Python e PHP. É um protocolo NDJSON próprio, não JSON-RPC 2.0: não
acrescente a propriedade `jsonrpc`. O código-fonte canônico da ponte está em `native/` no
repositório Node; implementações em outras linguagens podem distribuir essa cópia do código próprio e os scripts de compilação, nunca
as DLLs CliSiTef proprietárias, arquivos INI, manuais, certificados ou rastros de execução.

Os alvos de produção são **Windows x64** e **Linux i686 (32 bits, glibc)**, em processo isolado.
No Linux, Node/Electron pode ser x64 ou ia32; a ponte i686 exige a biblioteca do fornecedor ELF32
Intel 386 e as dependências de execução de 32 bits. Outras arquiteturas, inclusive ponte Linux x64,
ficam restritas a testes sintéticos com `testMode` explícito. Os caminhos de bibliotecas são
absolutos e fornecidos pelo integrador: DLL de interface x64 no Windows, `libclisitef.so` ELF32 no Linux.
A ponte rejeita arquivos PE Win32/ARM64, bibliotecas CliSiTef internas e arquiteturas incompatíveis.

## Transportes

Sem argumentos de linha de comando, a ponte lê requisições de stdin e escreve
respostas em stdout. Node/Python normalmente usam esse transporte. Inicie o executável
diretamente, com argumentos separados e sem shell. No Windows, oculte a janela
da ponte. Consuma ambos os fluxos de saída sem copiar diagnósticos para logs.

PHP no Windows pode selecionar um socket de loopback autenticado para obter limites de tempo
no socket sem depender de canais não bloqueantes de `proc_open`:

```text
sitef-bridge.exe --connect 127.0.0.1:PORT --token-env SITEF_BRIDGE_TOKEN
```

O cliente vincula um receptor a `127.0.0.1` em uma porta efêmera **antes** de iniciar
a ponte. Gere um novo nonce criptograficamente aleatório de 32 bytes, representado
por 64 caracteres hexadecimais; passe-o somente no ambiente do processo filho, na
variável indicada, nunca como argumento de comando. A ponte remove essa variável
antes de conectar ou carregar qualquer biblioteca do fornecedor. A conexão tem limite
de 10 segundos. Só são aceitos o endereço IPv4 exato `127.0.0.1` e portas de 1 a 65535.
Nomes DNS, IPv6, outros IPs de loopback e endereços remotos são rejeitados.

A primeira linha nesse socket é uma autenticação inicial, não uma resposta:

```json
{"protocolVersion":1,"transport":"tcp-loopback","token":"<the nonce supplied by the client>"}
```

Antes de enviar requisições, o cliente deve limitar e ler essa linha, exigir a versão
1 do protocolo e o transporte `tcp-loopback`, e comparar o nonce em tempo constante.
Rejeite uma autenticação incorreta ou truncada; não a registre em logs. A ponte não mantém
um receptor de servidor, reconexão ou retomada de sessão. Os quadros subsequentes do socket usam exatamente
o mesmo contrato de requisição/resposta do stdio. O modo TCP não emite protocolo nem diagnósticos
de erro em stdout/stderr. Erros de argumentos de inicialização encerram com código 2; falhas de inicialização
ou de E/S do transporte encerram com código 1; EOF normal encerra com código 0. Esses
códigos de saída não descrevem um resultado financeiro.

## Enquadramento e envelopes

Cada quadro é um objeto JSON UTF-8 seguido de LF, sem BOM. Quebras de linha
embutidas em comprovantes devem ser escapadas pelo serializador JSON. Não formate os
quadros com indentação. A entrada aceita CRLF como espaço em branco final do JSON; a saída usa LF.
Os clientes serializam chamadas e mantêm no máximo uma requisição pendente por ponte.
A ponte carrega uma biblioteca durante sua vida e executa as chamadas nativas em ordem.

Esquema de requisição:

```json
{"id":1,"method":"capabilities","params":{}}
```

`id` é um inteiro não negativo; clientes comuns devem limitá-lo ao intervalo de
inteiros seguros do JavaScript, de 0 a 9007199254740991. O analisador nativo aceita `u64`, mas
IDs maiores não podem ser representados exatamente por todos os clientes. `method` é uma string.
`params` é um objeto; omita-o somente para usar `{}`. Propriedades externas diferentes de
`id`, `method` e `params` são rejeitadas. Objetos tipados de parâmetros rejeitam propriedades
desconhecidas em vez de descartá-las silenciosamente. Métodos sem parâmetros usam `{}`.

Envelope de sucesso:

```json
{"id":1,"result":{"status":0}}
```

Envelope de erro da ponte:

```json
{"id":1,"error":{"code":"MISSING_SYMBOL","message":"Requested function is not exported by this library version"}}
```

Uma resposta contém exatamente um entre `result` e `error`; seu ID deve corresponder à
requisição pendente. Requisições malformadas ou grandes demais podem receber `id:null`. O limite de alocação
da requisição é 2097152 bytes, incluindo enquadramento, verificado antes da análise JSON. Um quadro
excessivo encerra a ponte após a resposta de erro. Clientes também precisam de buffers de resposta
limitados, análise estrita de UTF-8/JSON, IDs esperados e limites de tempo. Um buffer nativo
pode aumentar ao ser codificado como UTF-8 mais base64; não suponha que sua capacidade em bytes
seja igual ao tamanho do quadro JSON resultante. A capacidade normal de continuação é 20000.

## Esquemas de parâmetros e resultados

Nomes e uso de maiúsculas/minúsculas são idênticos entre clientes de diferentes linguagens. Todas as entradas de texto nativo
rejeitam NUL embutido; entradas numéricas nativas são inteiros, nunca booleanos convertidos implicitamente.
`additionalParameters` é a string nativa sem alteração, padrão `""`, não uma lista fechada
de opções reconhecidas. Opções futuras do fornecedor devem continuar expressáveis.

| Método | Parâmetros | Resultado |
| --- | --- | --- |
| `load` | `libraryPath:string`; opcionais `workingDirectory:string`, `nativeEncoding`, `testMode:boolean=false` | Objeto de capacidades abaixo |
| `capabilities` | `{}` | Objeto de capacidades |
| `configure` | `server:string`, `storeId:string`, `terminalId:string`; `reserved:integer=0`, `additionalParameters:string=""` | `{status:integer}` |
| `start` | `functionId:int32`, `amount:string`, `fiscalDocument:string`, `fiscalDate:string`, `fiscalTime:string`, `operator:string`; `additionalParameters:string=""` | `{status:integer}` |
| `continue` | `continueFlag:integer`, `bufferSize:integer`; `buffer:string=""`, opcional `bufferBase64:string` | Resultado de continuação abaixo |
| `finish` | `confirm:0\|1`, `fiscalDocument:string`, `fiscalDate:string`, `fiscalTime:string`; `additionalParameters:string=""` | `{returned:true}` |
| `version` | `{}` | `{status,libraryVersion:NativeText,interfaceVersion:NativeText}` |
| `pendingCount` | `fiscalDocument:string`, `fiscalDate:string` | `{count:integer,status:integer}`; ambos preservam o mesmo retorno nativo |
| `flushMessages` | `{}` | `{status:integer}` |
| `pinpadPresent`, `pinpadKeepAlive`, `pinpadKey` | `{}` | `{status:integer}` |
| `pinpadPermanentMessage`, `pinpadMessage`, `pinpadYesNo` | `message:string` | `{status:integer}` |
| `validateBarcode` | `data:string` | `{status:integer,documentType:integer}` |
| `removeCard` | `{}` | `{status:integer}` |
| `startBanking` | `fiscalDocument:string`, `fiscalDate:string`, `fiscalTime:string`, `operator:string`; `additionalParameters:string=""` | `{status:integer}`; pode iniciar continuação |
| `readSecureCard`, `readTrack3` | `message:string` | `{status:integer}`; pode iniciar continuação |
| `readPassword` | `securityKey:string` | `{status:integer}`; pode iniciar continuação |
| `readPasswordDirect` | `securityKey:string` | `{status:integer,encryptedPassword:NativeText}` |
| `readChip` | `modality:int32`; `additionalParameters:string=""` | `{status:integer}`; pode iniciar continuação |
| `pinpadInfo` | `{}` | Sempre retorna erro da ponte `UNVERIFIED_OUTPUT_BOUND`; use em seu lugar o ID de função 775 pela continuação |

`configureEx` e `readChipEx` são entradas de capacidades para variantes de exportação, não
métodos separados. Seus valores `invocationMethod` são `configure` e `readChip`.
Esses métodos preferem a exportação estendida; podem usar a exportação básica somente
quando a estendida está ausente e nenhum parâmetro adicional seria descartado.

Identificadores de loja/terminal têm exatamente 8 **bytes codificados**. Documento fiscal e
operador têm no máximo 20 bytes codificados. Datas/horas fiscais usam `AAAAMMDD`/`HHMMSS`;
os SDKs validam valores de calendário e horário. Valores de transação são strings decimais com
vírgula e duas casas decimais, ou vazias quando o valor será coletado depois. Outras
quantidades coletadas podem ter precisão própria; preserve o texto nativo. Chaves de segurança
para a API de senha de cartão proprietário contêm exatamente 64 bytes codificados.
Essas APIs não autorizam coletar PINs de cartões de pagamento comuns em um formulário HTML.

`nativeEncoding` aceita `windows-1252` (padrão explícito atual), `utf-8` ou
`ascii`. O integrador deve verificar a codificação da distribuição de seu fornecedor.
`NativeText` é `{text:string,rawBase64:string,decodingError:boolean}`. Decodificação de saída
com perda é sinalizada e os bytes originais são preservados; ela não reescreve o status.

Resultado de continuação:

```json
{"status":10000,"command":30,"fieldType":999123,"minLength":1,"maxLength":4,"buffer":"Collect","bufferBase64":"Q29sbGVjdA==","decodingError":false}
```

Esse campo é um exemplo sintético, não um campo documentado do produto. O
`fieldType` nativo continua sendo um ID numérico de campo sem restrição a uma lista. `bufferSize` vai de 20000
a 1048576; a entrada e o NUL terminador devem caber. Se `bufferBase64` for
fornecido, esses bytes têm precedência sobre a codificação de texto. Bytes brutos não podem conter
NUL. No comando 0, devolva os bytes nativos originais exatos, preferencialmente o base64
retornado, até que navegação/cancelamento altere o fluxo. A ponte preserva
internamente o último comando, tipo, mínimo e máximo entre chamadas de continuação.

Continue enquanto o status nativo for 10000. Os sinalizadores de continuação são `0` para avançar, `1` para voltar,
`2` para cancelar a conta atual nos contextos documentados de pagamento de contas, `10000` para
entrada previamente coletada e confirmada e `-1` para cancelamento cooperativo.
Não presuma aceitação de 2 ou 10000 em toda solicitação. Limites de bytes de campos
simples são aplicados aos comandos 29/30/34/41 ao enviar um valor. Prefixos e dados de cancelamento
de cheque e código de barras têm semânticas próprias no nível da aplicação.

Interprete os comandos retornados somente quando o status for 10000. Campos desconhecidos podem ser
armazenados/encaminhados enquanto seu comando é executado; comandos interativos desconhecidos
exigem um tratador explícito ou cancelamento cooperativo, nunca sucesso implícito.
Impressão de comprovantes e decisão da aplicação/fiscal continuam sendo obrigações do cliente.

## Capacidades e ciclo de vida

O objeto de capacidades contém `protocolVersion`, `bridgeVersion`, `platform`,
`architecture`, `runtimeTarget`, `nativeEncoding`, `fieldTypeBytes`, `testMode`,
`minimumBufferSize` e `functions`. No Windows de produção, os valores incluem plataforma `windows`,
arquitetura `x86_64` e alvo `windows-x64`; no Linux i686, incluem plataforma `linux`,
arquitetura `x86` e alvo `linux-ia32`. Ambos usam tipo de campo de 4 bytes.

Cada entrada de `functions` contém `{symbol,available,callable,invocationMethod}`.
`available` significa que a exportação nomeada existe. `callable` significa que seu método pode ser
chamado; restrições de estado continuam aplicáveis. Variantes de exportação e funções
bloqueadas deliberadamente têm `callable:false`. `configure`/`readChip` podem ser chamáveis por uma
exportação estendida mesmo que `available` de sua exportação básica seja false. A presença de uma exportação
não comprova suporte a toda operação ou campo documentado mais recente.

Após carregar, configure antes de iniciar uma operação. Só uma operação iterativa
nativa fica ativa por vez. Configuração, novas inicializações, finalização e chamadas auxiliares
comuns são rejeitadas enquanto houver uma ativa; os auxiliares de coleta direta
especificamente documentados não iniciam um segundo laço. Um resultado terminal do laço e
a decisão fiscal final são distintos. `finish` encapsula uma função nativa void:
`returned:true` comprova retorno local, não confirmação ou entrega remota.

Esta ponte de baixo nível não tem registro financeiro durável nem política automática de repetição,
confirmação ou desfazimento. O SDK da linguagem/integrador deve persistir a identidade
e a decisão antes das chamadas financeiras, preservar parâmetros de finalização seletiva,
bloquear cada terminal e reconciliar resultados incertos. Tempo limite, EOF, quadros malformados,
processo filho interrompido e modal fechado não comprovam cancelamento. Nunca
repita automaticamente uma chamada financeira após perder a resposta. EOF normal descarrega
a ponte; não finaliza automaticamente uma transação pendente.

## Erros e domínios de retorno nativo

Erros da ponte são separados dos retornos nativos. Códigos atuais conhecidos da ponte:

| Categoria | Códigos |
| --- | --- |
| Requisição/despacho | `INVALID_REQUEST`, `INVALID_PARAMETER`, `FRAME_TOO_LARGE`, `UNSUPPORTED_METHOD` |
| Biblioteca/plataforma | `NOT_LOADED`, `ALREADY_LOADED`, `LIBRARY_NOT_FOUND`, `INVALID_LIBRARY_PATH`, `INVALID_LIBRARY_FORMAT`, `WRONG_LIBRARY_ARCHITECTURE`, `LIBRARY_LOAD_FAILED`, `INVALID_WORKING_DIRECTORY`, `UNSUPPORTED_PLATFORM`, `MISSING_SYMBOL` |
| Sessão | `NOT_CONFIGURED`, `TRANSACTION_ACTIVE`, `NO_ACTIVE_TRANSACTION` |
| Codificação/buffers | `ENCODING_ERROR`, `BUFFER_TOO_SMALL`, `INVALID_BUFFER_SIZE`, `INVALID_INPUT_LENGTH`, `INVALID_CONTINUE_FLAG`, `INVALID_NATIVE_LIMITS`, `DATA_ECHO_REQUIRED`, `UNTERMINATED_BUFFER` |
| Bloqueio explícito de implementação | `UNVERIFIED_OUTPUT_BOUND` |

As mensagens são destinadas a pessoas; programe usando os códigos e preserve códigos futuros desconhecidos.
Não interprete todo erro da ponte como prova de ausência de efeito nativo:
um erro de buffer de saída pode ser detectado após entrar na biblioteca. Tempos limite locais do cliente
e falhas de processo também exigem uma política explícita de estado incerto.

Valores nativos de `{status}` são preservados exatamente e interpretados em seu próprio domínio:
em transações, 0 indica sucesso, 10000 indica continuação, outros positivos indicam negação do autorizador,
e negativos indicam as condições documentadas de cancelamento, erro ou reserva.
Configuração, contagem de pendências, presença/teclas/confirmação no pinpad, validação de código de barras
e funções de leitura segura atribuem significados diferentes aos mesmos inteiros. Consulte
as tabelas e auxiliares contextuais; não classifique uma contagem positiva de pendências como negação.
Nunca registre conteúdo de campos, comprovantes, PAN/trilhas/PIN, chaves de segurança ou nonce em logs.

## Catálogo compartilhado e cobertura restante

`protocol/catalog.json` é gerado a partir de nossas constantes TypeScript próprias por
`node scripts/export-catalog.mjs`. `--check` verifica a cópia sem escrever.
Exige Node >=22.18, sem `dist` compilado nem biblioteca do fornecedor. A versão de seu esquema
é 1; mapas numéricos usam chaves JSON em string, `fieldIds` associa aliases legíveis a inteiros,
e `fieldRanges` é um vetor de `{from,to,kind}`. A soma de verificação do código-fonte vincula a
cópia ao código TypeScript UTF-8 com CRLF normalizado para LF, tornando-a estável
entre cópias de trabalho Windows/Linux. Python/PHP podem empacotar esse mesmo arquivo de dados.

A cópia inclui metadados, tabelas de retorno específicas por contexto, sinalizadores de
continuação, comandos, aliases e intervalos de campos, eventos, nomes de funções e orientações atuais de INI/
parâmetros adicionais. Essas listas não são listas de permissão. A auditoria campo a campo de
VRS-258 identificou 444 entradas de campos; cobertura completa do produto ainda exige documentação e validação adicionais do fornecedor. Aliases, símbolos exportados e testes sintéticos não comprovam implementação
completa nem homologação. A DLL real do fornecedor só foi verificada quanto a
carregamento, configuração e versão; nenhuma transação financeira ou operação de pinpad foi
validada com ela. Consulte `implementation-status.md` e `validation.md`.
