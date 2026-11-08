# Cobertura do protocolo e limites de homologação

Referências auditadas: documentação fornecida pelo integrador, **Interface Simplificada VRS-258** e **Carteiras Digitais 1.43**. As páginas abaixo se referem à numeração impressa. A conferência posterior dos 444 IDs da seção 5.3.2 com VRS-260 e as consultas pontuais citadas nos guias não representam auditoria semântica completa dessa revisão. Os documentos, suas extrações e as bibliotecas do fornecedor não são distribuídos neste projeto.

**Os alvos de runtime são Windows x64 e Linux glibc i686, este último em preparação na 0.4.0.** A referência de protocolo continua sendo exclusivamente os dois PDFs do kit x86 já auditados. Os PDFs do pacote x64 foram apenas identificados no inventário do ZIP e não foram abertos, extraídos ou incorporados como fonte desta especificação. A convenção `stdcall` descrita na referência Windows x86 não significa pilha x86 no Windows x64: nesse alvo, a ponte usa a ABI de sistema Windows x64, com ponteiros de 64 bits, `short` de 16 e `int`/`long` de 32 bits. No Linux i686 usa ABI C e ponteiros/`int`/`long` de 32 bits; a biblioteca deve ser ELF32. Node x64 pode iniciar essa ponte isolada, mas uma ponte Linux x64 não substitui a i686. Consulte [distribuição](bridge-distribution.md) para requisitos e limites.

## Compatibilidade do simulador Windows x64

O inventário estático do kit `clisitef-7.0.117.111.r2-Simulado-Win64.zip` identifica a interface **`CliSiTef64I.dll`**, versão de recurso PE **7.0.117.111S**, e as companheiras `libcurl64.dll`, `libemv64.dll` e `QREncode64.dll`, todas AMD64/PE32+. A biblioteca `libemv64.dll` declara dependência de `MSVCR90.dll`; o pacote do integrador precisa fornecer os pré-requisitos de runtime apropriados. Esse inventário lê metadados de arquivo e tabelas PE, sem executar biblioteca, transação ou pinpad.

Todos os **24 símbolos** consultados atualmente pela ponte existem nesse kit x64, incluindo as variantes estendidas de configuração e de leitura de chip. Isso não comprova suporte a todo parâmetro, função transacional ou campo descrito pela documentação de referência, que é de outra revisão. A contagem total de exports da interface é 418; exports internos não são APIs liberadas pelo SDK.

`capabilities()` deve ser consultado em cada instalação. Se a configuração `Ex` faltar, o fallback só usa a variante básica com `additionalParameters` vazio; de outra forma devolve `MISSING_SYMBOL`. A mesma regra protege o fallback de leitura de chip: parâmetros extras não são descartados. Neste kit ambas as variantes `Ex` estão presentes, portanto o inventário não exercita ausência real. Símbolos, parâmetros e regras de produto precisam de testes de homologação próprios.

O arquivo [runtime-compatibility.json](./runtime-compatibility.json) registra versões, hashes, arquiteturas e cobertura estática por símbolo. Não contém bibliotecas, PDFs, código do fornecedor ou caminhos privados. A revisão x86 anterior serve apenas como referência documental e comparação histórica de nomes; ela não é runtime suportado.

Este SDK começou com a interface binária documentada, implementada de forma independente. **Não está homologado.** Preservar todos os códigos e parâmetros recebidos é parte do contrato; conhecer a semântica de todos os produtos e autorizadores exige documentação complementar e homologação. Um retorno desconhecido nunca é convertido silenciosamente em sucesso.

## Rotinas nativas

“Implementada” significa que há uma chamada com assinatura específica na ponte. Isso não comprova que o símbolo exista ou funcione em toda distribuição. Consulte `capabilities()` e execute os cenários do produto no ambiente de homologação. Métodos de início de fluxo nativos exigem conduzir o laço de continuidade: não basta chamá-los como utilitário direto.

| Rotina da interface padrão | Método da ponte | Parâmetros representados | Situação | VRS-258 |
| --- | --- | --- | --- | --- |
| `ConfiguraIntSiTefInterativo` | `configure` com fallback | servidor, loja, terminal, reservado | Implementada; fallback somente com parâmetros adicionais vazios | 11–13 |
| `ConfiguraIntSiTefInterativoEx` | `configure` | todos os anteriores, parâmetros adicionais integrais | Implementada; preferida quando disponível | 11–15 |
| `IniciaFuncaoSiTefInterativo` | `start` | função, valor, cupom, data, hora, operador, parâmetros adicionais | Implementada; código de função aberto | 17–27 |
| `IniciaFuncaoAASiTefInterativo` | — | função, valor, cupom, data, hora, operador, parâmetros adicionais, **produtos** | Pendente; rotina obsoleta; parâmetro Produtos não deve ser perdido em uma futura adaptação | 17–18, 128 |
| `ContinuaFuncaoSiTefInterativo` | `continue` | comando, tipoCampo, mínimo e máximo mantidos na ponte; buffer textual ou bytes; tamanho; flag de continuidade | Implementada; variáveis iniciais zeradas e saídas preservadas | 28–30 |
| `FinalizaFuncaoSiTefInterativo` | `finish` | confirma, cupom, data, hora, parâmetros adicionais integrais | Implementada; retorno **void**, sem confirmação bancária no retorno | 55–60 |
| `ObtemQuantidadeTransacoesPendentes` | `pendingCount` | data, cupom | Implementada; retorno positivo é quantidade | 60–62 |
| `VerificaPresencaPinPad` | `pinpadPresent` | sem argumentos | Implementada | 63 |
| `KeepAlivePinPad` | `pinpadKeepAlive` | sem argumentos | Implementada | 63 |
| `EscreveMensagemPermanentePinPad` | `pinpadPermanentMessage` | mensagem | Implementada | 63–64 |
| `LeTrilha3` | `readTrack3` | mensagem | Implementada; inicia laço próprio | 64 |
| `LeCartaoSeguro` | `readSecureCard` | mensagem | Implementada; função 430 é alternativa pelo fluxo normal | 65–67 |
| `LeCartaoDiretoSeguro` | — | mensagem, tipoTrilha1, trilha1, tipoTrilha2, trilha2, timeout, callback de cancelamento | Pendente; exige confirmar assinatura exata do callback no header do fornecedor | 66–67 |
| `LeCartaoDiretoSeguroEx` | — | mensagem, saída TLV, tamanho da saída, timeout, callback de cancelamento | Pendente; tabela do PDF descreve tamanho da saída como `char*` mesmo na interface padrão; não adivinhar ABI | 68 |
| `LeTrilhaChipInterativo` | `readChip` com fallback | modalidade | Implementada; função 431 é alternativa | 68–69 |
| `LeTrilhaChipInterativoEx` | `readChip` | modalidade, parâmetros adicionais integrais | Implementada; fallback não descarta parâmetros adicionais | 68–69 |
| `LeSenhaInterativo` | `readPassword` | `securityKey`, com exatamente 64 bytes na codificação nativa | Implementada; inicia laço; uso exclusivo de senha de cartão proprietário documentado | 69–70 |
| `LeSenhaDireto` | `readPasswordDirect` | `securityKey` com 64 bytes, saída `encryptedPassword` de 20 bytes | Implementada; retorno preservado e senha criptografada não registrada automaticamente | 70 |
| `LeSimNaoPinPad` | `pinpadYesNo` | mensagem | Implementada; 0 cancela e 1 confirma; chamada bloqueante no processo auxiliar | 70–71 |
| `EscreveMensagemPinPad` | `pinpadMessage` | mensagem | Implementada | 71 |
| `LeTeclaPinPad` | `pinpadKey` | sem argumentos | Implementada; domínio de retorno próprio | 72 |
| `RemoveCartaoPinPad` | `removeCard` | dois ponteiros reservados enviados como NULL | Implementada conforme tabela do manual; callback não utilizado nesta versão | 73 |
| `CorrespondenteBancarioSiTefInterativo` | `startBanking` | cupom, data, hora, operador, parâmetros adicionais | Implementada; função 310 é alternativa pelo laço normal | 74 |
| `ValidaCampoCodigoEmBarras` | `validateBarcode` | dados, tipo do documento de saída | Implementada; domínio de retorno próprio | 75–76 |
| `ObtemVersao` | `version` | versões da biblioteca e interface de saída | Implementada | 77 |
| `DescarregaMensagens` | `flushMessages` | sem argumentos | Implementada; 0 significa que todas foram descarregadas | 78 |
| `ObtemInformacoesPinPad` | `pinpadInfo` | saída TLV | Chamada direta bloqueada com `UNVERIFIED_OUTPUT_BOUND`; função 775 pelo laço é alternativa; limite de saída não está explícito no manual | 78–79 |

As variantes **ASCII com sufixo `A`** são interfaces alternativas documentadas e permanecem **pendentes de exposição direta**. A ponte utiliza as variantes binárias equivalentes e representa seus argumentos explicitamente; ela não depende de strings numéricas de tamanho fixo da interface ASCII. Variantes explicitamente mostradas no manual: `ConfiguraIntSiTefInterativoA`, `ConfiguraIntSiTefInterativoExA`, `IniciaFuncaoSiTefInterativoA`, `IniciaFuncaoAASiTefInterativoA`, `ContinuaFuncaoSiTefInterativoA`, `FinalizaFuncaoSiTefInterativoA`, `ObtemQuantidadeTransacoesPendentesA`, `EscreveMensagemPermanentePinPadA`, `LeCartaoSeguroA`, `LeCartaoDiretoSeguroA`, `LeCartaoDiretoSeguroExA`, `LeTrilhaChipInterativoA`, `LeSenhaInterativoA`, `LeSenhaDiretoA`, `LeSimNaoPinPadA`, `CorrespondenteBancarioSiTefInterativoA`, `ValidaCampoCodigoEmBarrasA` e `ObtemVersaoA`. As versões diretas ASCII de leitura de cartão não recebem callback segundo as tabelas; não assumir paridade binária de assinatura.

As rotinas históricas `LeCartaoInterativo[A]`, `LeCartaoDireto[A]`, `LeCartaoDiretoEx[A]` e `FinalizaTransacaoSiTefInterativo` foram descontinuadas pelo fornecedor e não são expostas. A rotina moderna de finalização adicionou `ParamAdic`; não substituí-la por um alias de assinatura antiga. Fonte: VRS-258 p. 128.

## Entradas e configuração

- Toda chamada de configuração inclui servidor, loja, terminal, reservado e string adicional integral. A string adicional não é filtrada por chaves conhecidas.
- Toda transação mantém função numérica aberta, valor **textual**, identificadores fiscais, operador e string adicional integral. Cupom e operador têm até 20 bytes; loja e terminal têm 8; datas usam `AAAAMMDD`, horas `HHMMSS`. O valor nativo usa vírgula e duas casas, ou vazio quando a função não tem valor prévio.
- Toda finalização mantém cupom, data, hora, decisão explícita e `ParamAdic`. O padrão atua sobre **todos** os pagamentos do mesmo cupom e data. `finalizePayment`, `finalizeNetwork` e `finalizeWithPayments` compõem os seletores reservados e atualizam somente os pagamentos alcançados. Extensões adicionais continuam abertas. NFPAG finaliza todos os pagamentos do mesmo cupom/data, mesmo quando anexa dados apenas ao índice selecionado.
- `CliSiTef.ini` pertence ao integrador. Seu conteúdo deve ser mantido junto à biblioteca, conforme o fornecedor, e não reescrito a partir de uma whitelist. `workingDirectory` permite definir o diretório de trabalho do auxiliar. Isso não altera a regra do fornecedor para localização do INI junto à DLL.
- A lista `DOCUMENTED_ADDITIONAL_PARAMETERS` e o catálogo `DOCUMENTED_INI_KEYS` são dicas dos dois documentos consultados. O SDK continua aceitando parâmetros não catalogados.
- `TamBuffer` é `int` de 32 bits na ABI. A ponte aloca de 20.000 a 1.048.576 bytes; o limite superior de 1 MiB é uma política do processo auxiliar, não um limite declarado pelo fornecedor. Campos maiores exigem ampliar esse limite e o limite de frame IPC juntos.
- As áreas de string são terminadas em NUL; NUL interno é inválido. O limite de coleta é contado em **bytes da codificação nativa**, não em caracteres JavaScript. Há opção de encoding e preservação dos bytes por Base64, que é transporte e não criptografia.

## Comandos, campos e retornos

Os **25 comandos** explicitamente enumerados nos dois PDFs estão classificados no catálogo: `0`, `1–4`, `11–16`, `20–23`, `29–31`, `34–35`, `41–42`, `50–52`. Fontes: VRS-258 pp. 32–36; Carteiras Digitais p. 34.

O comando é o que determina a ação; `TipoCampo` explica o dado. Um tipo de campo desconhecido continua sendo atendido pelo comando conhecido. Para comando desconhecido, o integrador deve fornecer tratamento explícito; não se fabrica uma resposta vazia como sucesso. Campo retornado no comando `0` deve ser ecoado **com os mesmos bytes** na próxima chamada. Toda ocorrência é preservada em sequência, inclusive campos repetidos, comprovantes e tipos não catalogados.

`FIELD_IDS` mantém aliases de conveniência por compatibilidade. O catálogo completo da referência recebida está em `protocol/fields.json`, acessível por `fieldDefinition(id, context)`: 444 códigos individuais da seção 5.3.2, 64 eventos e extensões, totalizando 536 entradas e sete faixas. `functionDefinition(id)` expõe as 131 funções (124 base e sete de carteiras). A auditoria independente em `protocol/coverage-audit.json` registra zero IDs ausentes nas tabelas consultadas. Os tipos numéricos continuam abertos; uma definição completa dos documentos recebidos não define todos os produtos futuros. O contexto de leitura segura impede confundir a faixa de hashes com os significados transacionais dos campos 2053–2056.

Os códigos de configuração das pp. 11–12 e de transação da p. 20 estão catalogados. Carteiras Digitais acrescenta `-22` e `-23`. Outros positivos no contexto de transação indicam recusa do autorizador; negativos desconhecidos continuam sendo falhas com o código original. O catálogo não inventa uma descrição de autorizador para um número não documentado.

As funções auxiliares usam domínios diferentes: quantidade de pendências, presença, SIM/NÃO no pinpad, teclas, validação de barras, leitura segura e status zero. Use `classifyReturn(code, context)` com o contexto adequado. Por exemplo, `1` significa pendência, presença ou confirmação em três funções diferentes; não é uma recusa universal.

Para o início de leitura segura, use o contexto `secure-transaction`: ele preserva o laço `10000` e reconhece o retorno positivo `12` como modo seguro inativo, pré-requisito específico da VRS-258 p. 65. Para a leitura segura direta, `secure-read` reconhece os códigos específicos das pp. 65–67. Não aplicar o domínio de recusa de pagamentos indiscriminadamente a essas funções.

O laço termina somente quando o **retorno da função** é diferente de `10000`. Evento `5005` não substitui esse retorno. O parâmetro de entrada `Continua` admite `-1`, `0`, `1`, `2` e `10000`. O último permite dado pré-coletado e confirmado pelo operador conforme as condições da p. 29; não deve ser habilitado automaticamente. Cancelar precisa retornar `-1` ao protocolo. Encerrar modal ou rejeitar callback não comprova cancelamento financeiro.

## Interação e obrigações especiais

- Comando `23` verifica cancelamento durante acesso a periférico; o manual proíbe delays artificiais. Não abrir uma coleta humana a cada ocorrência.
- Comando `29` pede um dado da aplicação sem intervenção do operador. A aplicação precisa resolver esses dados, inclusive os opcionais definidos por produto. O modal não transforma esse comando silenciosamente em formulário humano.
- QR do comando `50` fica visível enquanto o laço continua; `51` remove; `52` atualiza rodapé opcional. Eles não esperam o usuário pressionar “OK”. Fonte: Carteiras Digitais pp. 34–38.
- Cheque (`31`) devolve prefixo `0:`, `1:` ou `2:` conforme primeira linha digitada, CMC-7 lido ou CMC-7 digitado. Barras (`35`) usa `0:` manual, `1:` leitor ou `2:` para cancelar somente a coleta corrente. Não intercambiar os códigos.
- Campo `2355` orienta a próxima coleta: A/AN/LN/N/Vx/S/M/Mc; Mc exige confirmação explícita adicional. Campo `2470` informa casas decimais e `1121`/`1126` as precisões de combustível. Datas, valores e tamanhos são validados antes de responder. Aritmética usa inteiros exatos; escala não documentada exige configuração/resolver.
- Comprovantes exigem armazenamento confirmado; os imediatos aguardam impressão no laço, e os adiados são impressos antes da confirmação. Assinatura 5074 é exigida depois da impressão; 5010 permanece notificação, sem captura inventada. Recursos 5042/5043 têm liberação também no caminho de cancelamento/falha.
- `Continua=2` é aceito para cancelamento parcial somente no contexto documentado de contas 600/601. Erro PBM, restrições de produto e fallback Carnê exigem decisão explícita da aplicação.
- **Impressão:** comprovantes administrativos e de correspondente bancário devem ser impressos quando disponibilizados no laço; continuar com `0` após sucesso e `-1` após falha, conforme VRS-258 p. 37. Acumular comprovantes e confirmar automaticamente não atende esse fluxo. A aplicação precisa implementar o ciclo de impressão.
- Dados de cartão, senha criptografada, documentos e buffers devem ser tratados como sensíveis. O journal de recuperação contém identidade fiscal e estado, sem dump automático dos buffers.
- Uma invocação `finish` concluída localmente não comprova entrega ao servidor. Recuperação inclui consulta de pendências, decisão fiscal explícita e eventual `flushMessages`; não repetir pagamento após timeout.

## Material necessário para completar a matriz de homologação

1. Headers oficiais Windows x64 e Linux i686 das versões fornecidas, para confirmar assinaturas e limites das rotinas auxiliares. Carga, configuração e versão do kit Linux32 foram verificadas; isso não comprova toda a ABI nem homologa os fluxos.
2. Lista de Parâmetros Adicionais atualizada, Tabela de Mensagens e documentos dos produtos contratados. Os manuais fornecidos fazem referência a esses documentos e não os incorporam integralmente.
3. Especificação de captura de senha proprietária, dados de produtos e Soft Descriptor, quando usados.
4. Headers Windows das funções diretas com callbacks e resolução da inconsistência de `TamDadosOut`.
5. Acesso ao ambiente de homologação com cenários de impressão, cancelamento, perda de energia, múltiplos pagamentos, múltiplos comprovantes, pendências e recuperação de falhas. Testes sintéticos não equivalem a homologação da CliSiTef.

Os fluxos de alto nível e os hooks exigidos estão descritos em [semantic-flows.md](semantic-flows.md). A matriz de obrigações e cenários está em [implementation-status.md](implementation-status.md).
