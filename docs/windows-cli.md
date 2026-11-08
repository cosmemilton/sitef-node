# CLI de desenvolvimento no Windows

Exemplo sobre o componente TypeScript e a ponte Rust, com uma biblioteca
Windows x64 fornecida pelo integrador. Use o checkout deste repositório. Por padrao, a ponte, o runtime e o estado ficam em
%USERPROFILE%\Documents\SiTefDevelopment; --runtime permite outra pasta de DLLs.
O processo Node, a ponte e o pinpad rodam no Windows, sem USB compartilhado com WSL.
O checkout pode estar em uma pasta Windows ou UNC do WSL; a operacao usa Node Windows. Execute os comandos abaixo na raiz do checkout.

A CLI não garante modo simulado nem homologação. Trate a execução como
potencialmente produtiva, conferindo biblioteca, configuração e autorização
operacional. Esta mudança de arquitetura não executou DLL, pinpad, transação ou
consulta real e não leu nem alterou journals operacionais. O histórico datado
abaixo descreve versões anteriores, não novas validações.

## Executar neste computador

Abra PowerShell ou Windows Terminal e execute:

~~~powershell
node .\examples\windows-cli.mjs
~~~

Diagnostico de presenca do pinpad (carrega a DLL e configura a sessao, sem venda):

~~~powershell
node .\examples\windows-cli.mjs --diagnostico
~~~

O fluxo interativo exige entrada e saída TTY. Redirecionamento de stdin/stdout é
recusado por `terminalIO`: use um terminal Windows, não capture a saída em arquivo.
Os comprovantes podem conter dados sensíveis; não grave a sessão do terminal.

A CLI abre diretamente o menu de funções: 0, 2, 3, 110, 111, 122 e 123.
Não pede TESTE nem confirmação artificial antes da operação. Enter no primeiro
menu sai sem carregar a DLL. Depois de cada operação/decisão, volta ao menu com o
mesmo `ClientSitef`: uma carga/configuração por execução, não por transação.
Enter no menu seguinte encerra esse cliente. `--funcao N` mantém o modo de uma
única operação: pula o menu inicial, usa uma das sete funções e encerra ao final.

- 0: escolha de pagamento pelos menus do SiTef (pagamento genérico).
- 2: débito; 3: crédito.
- 110: menu gerencial; 111: teste de comunicação.
- 122: venda via carteira digital; 123: cancelamento via carteira digital.

Somente 2, 3 e 122 pedem valor antes de iniciar. Use 10,00 ou 10.00, sem milhares.
As demais iniciam com valor vazio, não zero fictício; o SiTef solicita os dados
que a operação escolhida exigir. Não são criados prompts locais de NSU, data,
carteira, senha ou confirmação de cancelamento. As solicitações nativas continuam
sendo apresentadas e respondidas conforme seus comandos.
Configuração deste exemplo de desenvolvimento (não do componente):
- Servidor 127.0.0.1.
- Loja 00000000.
- Terminal SR000001.
- Pinpad configurado no INI do runtime pelo integrador; a CLI nao valida seu conteudo.
- Pasta padrao: runtime\7.0.117.123.r2-win64 sob a raiz de desenvolvimento.
  O nome antigo foi mantido por compatibilidade, nao como restricao de versao.

No componente, IP, loja e terminal continuam parâmetros de Configuration.
CNPJs e demais opções do integrador continuam em additionalParameters; nenhum
CNPJ foi fixado. Apenas este exemplo isolado usa os valores de teste solicitados.

Menus, mensagens, confirmações e coletas chegam do SiTef durante a execução.
Digite o ID exibido, não a posição da opção. Todas as entradas de teclado ficam visíveis, inclusive supervisor e comando41.
Use /voltar para voltar e /cancelar, Esc ou Ctrl+C para cancelar cooperativamente.
Aguarde o retorno terminal. Comando 23 não aguarda teclado. QR no pinpad depende
do equipamento e da carteira. Se o SiTef solicitar QR na tela pelo comando50,
a CLI interrompe explicitamente: ainda não tem renderizador, e imprimir a string
não cumpre a apresentação do QR. O payload não é exposto no terminal.

## Segurança e limites

- Sem lista de hashes de DLLs, versao obrigatoria, comparacao estrita do INI ou
  lista fixa de dependencias. A verificacao local exige apenas CliSiTef64I.dll
  e sitef-bridge.exe. O integrador deve fornecer as dependencias e a configuracao
  adequadas ao runtime; o carregamento pode falhar se elas estiverem ausentes.
- Não finaliza automaticamente. Depois de retorno0 de um resultado financeiro
  que exige decisão, o menu oferece confirmar, desfazer ou manter pendente (padrão).
  A escolha usa `tx.confirm()` ou `tx.undo()` no objeto selecionado, sem dispensar
  validação de produto, impressão ou assinatura. Desfazer também exige escolha
  explícita; isso não promete reverter ações gerenciais já processadas.
  Função110 continua com revisão separada.
- A CLI não transforma uma operação em teste nem controla o ambiente do servidor.
  O uso de dados de teste depende da configuração apropriada do integrador.
- Nenhum Agente, serviço, certificado ou alteração de segurança é instalado.
- Não grava valores de campos, PAN, PIN, trilhas ou comprovantes em logs,
  diagnóstico ou snapshot financeiro. A visualização local dos comprovantes
  121/122 é intencional e restrita ao terminal interativo. A DLL do fornecedor
  pode criar seus próprios arquivos de controle/diagnóstico na pasta runtime.
- Comprovantes retornados ficam em memória e as vias 121/122 são apresentadas,
  sem impressão física nem captura de assinatura. A CLI assume explicitamente
  `finalizationResponsibility:'automation'`; o operador cumpre as obrigações
  antes de confirmar. A impressão imediata usa a política simulada descrita abaixo;
não simula assinatura nem dados de aplicação (comando29).
- Campos/comandos sem implementação ou mapeamento inequívoco falham explicitamente,
  com cancelamento cooperativo. Nem toda função/produto possui integração nesta CLI.
- A automação da CLI grava snapshots por execução em
  %USERPROFILE%\Documents\SiTefDevelopment\state\automation\<UUID>.journal.json.
  Registros/locks antigos geram avisos, não bloqueio de nova venda. Nunca são
  removidos, regravados ou restaurados automaticamente. Após timeout/crash,
  não repetir a operação incerta; reconciliar é uma etapa explícita.
  Encerrar processo não prova desfazimento. A finalização nativa só informa retorno local.
- Não executar simultaneamente com outro PDV/SiTef no mesmo terminal.
- Use biblioteca de origem confiável e configuração apropriada. --verificar não
  comprova origem, assinatura, compatibilidade ou modo simulado. A CLI não ativa
  simulação, não certifica homologação e não impede por hash trocar a biblioteca.

## Preparar novamente após mudanças

1. No checkout WSL, executar npm run build e bash scripts/build-windows-x64.sh.
2. Opcional: no Windows, executar scripts/prepare-windows-cli.ps1 desse checkout.
   Aceita -Kit e -Bridge com caminhos locais/UNC explicitos. Esse helper continua
   sendo um extrator do kit simulado antigo, nao um atualizador de runtime.
   Nao precisa instalar o Agente. Preserva arquivos identicos e recusa sobrescrever
   arquivos diferentes. Essa protecao do extrator nao e um bloqueio da CLI.
3. Quando a preparacao for autorizada e concluida, executar o launcher local
   %USERPROFILE%\Documents\SiTefDevelopment\sitef-cli.cmd.
   A copia gerada dispensa o WSL durante a operacao. Mudancas de codigo exigem
   atualizar essa copia; executar diretamente o checkout usa os fontes atuais.

Para atualizar as bibliotecas, use o procedimento do integrador na pasta de
runtime ou escolha outra pasta absoluta com --runtime. Nao e preciso alterar
hashes no programa. Preserve a raiz original de --diretorio, os registros e locks anteriores.

Registro historico da preparacao de 2026-11-06: neste computador, a politica de
assinatura bloqueou o helper PowerShell em caminho UNC. Naquela tentativa, sua
execucao nao foi concluida e o launcher local nao foi criado. A politica nao foi
alterada nem contornada; foi utilizado o comando Node direto acima. Esse registro
nao afirma o estado atual da instalacao nem uma nova validacao do helper.

As bibliotecas, INI, documentos e licenças do fabricante continuam fora do Git.
Não publicar esses arquivos com o componente.

## Historico de verificacoes em 2026-11-06

Os registros abaixo pertencem a versao anterior a simplificacao da CLI. Nao
validam esta versao nem uma biblioteca substituida. Nesta atualizacao documental,
nenhuma DLL, transacao, consulta de recovery ou teste fisico foi executado.

- Node Windows v24.18.0 x64; pinpad Windows Gertec PIN Pad PPC, COM4.
- Diagnóstico nativo: configuração aceita e pinpadPresent=1 via AUTO_USB.
- Ciclo Windows real com DLL simulada: valor 1,00, conexão, menu de meios de
  pagamento, cancelamento no menu e retorno -2 (cancelado pelo operador).
- Não inserido cartão e não percorrido pagamento completo do fornecedor.
- Naquela versao, testes sinteticos cobriam menus, confirmacoes, campos mascarados,
  precisao, navegacao, cancelamento, finalizacao negativa e bloqueio por hash.
  O bloqueio por hash de DLL foi removido da versao atual.
- Testes sintéticos não equivalem à homologação do SiTef.

## Diagnosticar arquivos ausentes

Use o mesmo comando Node com --verificar. Esse modo imprime a raiz e a pasta de
runtime e confere apenas a existencia de CliSiTef64I.dll e sitef-bridge.exe como
arquivos. Termina sem carregar a DLL, acessar o pinpad, criar lock ou alterar o
journal. Nao le nem compara o INI, dependencias, hashes ou assinaturas. Encontrar
os arquivos nao comprova compatibilidade, origem confiavel ou ambiente simulado.
Se um arquivo estiver ausente, a CLI mostra seu caminho completo e informa que
a falha ocorreu antes da operacao. Nao imprime buffers nativos.

Caso o terminal tenha USERPROFILE diferente, use --diretorio com a pasta de
desenvolvimento já preparada. Esse parâmetro não extrai arquivos, não migra estado
e não é configuração global do componente. A pasta original deve ser preservada
para consulta das evidências anteriores; mudar a raiz não resolve uma pendência.

--runtime CAMINHO escolhe uma pasta absoluta contendo CliSiTef64I.dll, suas
dependencias e o INI apropriado. Exemplo apenas de verificacao de arquivos:

~~~powershell
node .\examples\windows-cli.mjs --runtime "C:\SiTef\runtime-atual" --verificar
~~~

Sem --runtime, permanece a pasta runtime\7.0.117.123.r2-win64 sob --diretorio.
Escolher outro runtime não muda a ponte em --diretorio\sitef-bridge.exe nem os
registros em --diretorio\state. O journal legado tem nome derivado de loja/terminal;
as execuções novas usam UUID sob state\automation. Esses nomes e os hashes das
evidências de reconciliação não restringem a versão da biblioteca.

## Correção de caminho Windows

O AppData do processo empacotado foi virtualizado pelo Windows. Por isso os arquivos existiam no contexto de execução, mas o PowerShell normal não via a ponte. O ambiente passou para Documents\SiTefDevelopment, validado também pelo Explorador do usuário. O journal anterior estava encerrado (-2), sem lock; foi copiado com hash idêntico e o original foi preservado. A CLI não usa mais AppData por padrão.

## Reconciliacao separada e consulta protegida

Use o programa separado; ele nao executa o fluxo de venda da CLI:

~~~powershell
node .\examples\windows-reconcile.mjs
~~~

O modo padrão apenas lê o journal legado e seu lock. Não carrega DLL, cria
pastas, adquire lock nem altera o registro. Mostra grupo, identidade fiscal,
estado, SHA-256 e presença do lock. Um PID pode ter sido reutilizado pelo SO:
não comprova que o processo original segue ativo nem que houve cancelamento.

Para selecionar um registro novo, use explicitamente --registro CAMINHO_ABSOLUTO:

~~~powershell
node .\examples\windows-reconcile.mjs --inspecionar --registro "C:\caminho\SiTefDevelopment\state\automation\UUID.journal.json"
~~~

O caminho é ilustrativo: substitua pelo arquivo exibido na execução desejada.
Sem --registro, o comportamento legado é preservado; não há seleção automática
do arquivo mais recente. A flag não importa estado para a CLI de venda, não
altera arquivos e não autoriza consulta nativa ou finalização por si só.

A copia opcional de evidencias exige --preservar-evidencias, --grupo ID,
--hash SHA256 e --evidencias PASTA_ABSOLUTA_NOVA. A pasta pai precisa existir.
Copia os bytes originais, verifica hashes e grava manifest.json ao concluir.
Nao sobrescreve destinos. Se a captura falhar, uma pasta parcial pode permanecer,
sem manifest.json de conclusao; preserve-a para inspecao.

A consulta opcional exige --consultar com os mesmos tres argumentos. Nao a execute
junto com outro PDV/Agente/SiTef no mesmo terminal. Se houver lock do registro
selecionado, ela para antes de criar a ponte, carregar DLL ou copiar evidências.
Essa guarda do reconciliador é diferente dos avisos não bloqueantes da CLI de
venda. Não há opção de remover ou arquivar um lock existente. Essa ação requer
revisão explícita de exclusividade, evidência preservada e autorização separada.

Quando nao ha lock, a consulta preserva evidencias, cria seu proprio lock exclusivo
e carrega a DLL da pasta escolhida com --runtime, ou da pasta padrao de runtime
sob --diretorio quando essa opcao nao for informada, sem comparacao de hash,
INI ou versão. --runtime recebe caminho absoluto e não muda o journal/lock
selecionado por --registro, ou o legado sob --diretorio. Inspeção e cópia de
evidências continuam sem DLL e não usam esse
caminho. Use uma biblioteca confiavel e a configuracao correta do integrador.
--consultar usa pendingCount e a função131 para o cupom/data do registro, sem
valor de venda. --consultar-terminal usa a função130 para listar pendências do
terminal, sem escolher decisão. Ambos exigem --grupo, --hash e --evidencias,
aceitam --registro e preservam as mesmas guardas de evidência/lock.

O transporte de consulta recusa finish, venda, flushMessages, leitores de cartão
e repetição automática. O modo131 não aceita outra identidade fiscal; o modo130
consulta o terminal explicitamente escolhido. Não fornece dados a solicitações
interativas inesperadas: falha e cancela a consulta. Apenas journal V2 com um
único pagamento pendente, sem plano de finalização, é aceito nessa implementação
dos dois modos. A lista130 pode conter outras pendências do terminal e é somente
evidência para revisão; nenhuma delas é finalizada. O componente continua genérico.

O journal financeiro nunca e escrito por esse programa. Toda consulta preserva seu proprio lock, inclusive no sucesso.
O descritor e fechado, mas o arquivo permanece para revisao explicita. Nenhum
pathname de lock e removido automaticamente, evitando uma corrida de substituicao. Nem ausencia local de pendencia nem -13 (documento nao
encontrado) comprovam cancelamento remoto ou encerram o journal.
A biblioteca pode atualizar seus proprios arquivos internos mesmo numa consulta.
Nenhuma finalizacao/desfazimento e implementada aqui. A recuperacao financeira
continua sendo uma etapa posterior, explicita e delimitada por cupom/data.

Base: manual VRS-258 do kit x86, secoes 5.4 e 5.5 (paginas 55 e 60-62).
FinalizaFuncaoSiTefInterativo afeta todos os pagamentos do mesmo cupom/data e
retorna void. Nunca usar uma nova venda para tentar resolver pendencias.

### Estado observado no teste de credito

Em 2026-11-06, o teste simulado de 1,00 selecionou Cartao de Credito e alcancou
"Aproxime, insira ou passe o cartao na leitora". Nao foi fornecido cartao nem
comandada confirmacao. A exibicao fisica no pinpad ainda depende de confirmacao
do operador. Posteriormente, a sessao e os processos desapareceram sem retorno
terminal capturado; journal permaneceu started. Nao ha comprovacao de cancelamento.
O programa de inspecao foi executado no Windows sobre esse estado, com zero
chamadas nativas e journal/lock preservados. A consulta nativa de recuperacao nao
foi executada: existe lock e ele nao foi contornado.

Em seguida, com autorizacao do operador, a evidencia original foi copiada com
hash verificado e somente o lock orfao foi arquivado. A consulta do mesmo cupom/data
foi executada em 2026-11-06T20:02Z e terminou como RECOVERY_QUERY_INCONCLUSIVE.
O journal manteve o hash original. Nenhum processo de CLI/ponte continuou ativo,
e o lock criado pela consulta permaneceu preservado.

Nessa primeira consulta, o programa ainda nao imprimia o codigo numerico de um
resultado inconclusivo. O diagnostico foi corrigido e testado: agora preserva
query-result.json com fase, contagem/codigo de retorno quando disponiveis e estado
de preservacao, sem buffers, comprovantes ou dados de cartao. Essa melhoria nao
recupera retroativamente o codigo perdido. A consulta nao foi repetida.

A repeticao diagnostica autorizada, em 2026-11-06T20:05:59.999Z, retornou -13
na contagem e na consulta 131: documento fiscal nao encontrado. O resultado esta
preservado em recovery-query-repeat-20261106-2005/query-result.json no ambiente
de desenvolvimento. Nenhuma venda ou finalizacao foi executada, nenhum processo
SiTef permaneceu ativo e o journal conservou seu SHA-256. O novo lock foi
preservado para revisao. Documento ausente nao comprova cancelamento remoto;
nao executar novas vendas nem alterar o journal automaticamente.

Essa orientação pertence ao diagnóstico de 2026-11-06 e ao bloqueio local da
versão anterior. O contrato atual permite outra transação com pendência registrada,
sem resolver ou repetir a operação antiga. Não apaga nem reclassifica aquela
evidência. Reconciliação e qualquer decisão posterior continuam explícitas.

## Estrutura do exemplo

`main` é a primeira função em `examples/windows-cli.mjs`, depois dos imports e
da configuração do exemplo. Prepara arquivos, coleta a primeira opção e chama
`ClientSitef.create` uma vez. `examples/cli/connection.mjs` monta as opções e os
hooks de recursos reais. `examples/cli/session.mjs` contém `runSession`, o loop
de objetos `Transaction` e o encerramento único. Cada ciclo chama
`tx.process(createCallbacks(io))`, mostra o resultado e só então pede a decisão.
O objeto é descartado sem finalizar automaticamente; a conexão permanece aberta
para a próxima escolha. Erro encerra a sessão, sem retry financeiro.

`examples/cli/runtime.mjs` concentra argumentos, caminhos e verificação de
arquivos. `examples/cli/automation-state.mjs` controla snapshots e avisos de
registros anteriores. `examples/cli/diagnostics.mjs` formata erros sem dados de
campos. Interação, terminal, funções, pinpad e finalização continuam separados.
`connectClient`, `runSession`, `runSimulation` e os helpers antes exportados pelo
arquivo principal continuam exportados. `runSimulation` mantém o nome por
compatibilidade; não ativa nem comprova ambiente simulado e não toma decisão.

`--diagnostico` também cria um único cliente, consulta `pinpadPresent` pela API
avançada e fecha, sem iniciar venda. `--verificar` termina antes da criação do
cliente e do estado da automação. Nenhum dos modos é executado automaticamente
para validar uma atualização de código.

## Depuracao

O fluxo normal não usa pausas artificiais entre chamadas nem o antigo argumento
--passo-a-passo. Para depurar o código, use [o guia do VS Code Windows](vscode-windows-debug.md).

## Windows x64 e avisos de pendência

No Node, process.platform igual a win32 significa o sistema Windows, inclusive
quando o processo e de 64 bits. A arquitetura fica em process.arch: x64.
A ponte Windows x64 carrega CliSiTef64I.dll (PE AMD64/0x8664). Uma DLL x86/Win32
nao pode ser carregada por essa ponte. O nome win32 da plataforma nao exige DLL x86.

A CLI inspeciona o journal/lock legado e registros de execuções anteriores apenas
para aviso. Uma pendência não é bloqueio local de nova transação, inclusive com
outro cupom, e não dispara restauração, consulta, Finaliza ou retry. O SiTef mantém
seus próprios retornos e recusas. Não use nova venda para resolver uma anterior.

A automação reserva um novo caminho state\automation\<UUID>.journal.json por
execução iniciada e grava o arquivo quando recebe o primeiro snapshot em
onStateChange; o SDK não recebe journal. O loop inteiro compartilha esse
registro: transações seguintes acumulam seus metadados sem sobrescrever as
anteriores e sem reconfigurar o cliente. Nem toda execução produz snapshot:
--verificar e sair no menu não criam registro nem lock. O lock do novo caminho
pertence à automação e não coordena outros UUIDs, processos
ou PDVs. Não há mutex global. O integrador deve garantir uso não simultâneo do
terminal/pinpad. Dentro da mesma instância, operação ativa e conexão dessincronizada
continuam impedindo chamadas inseguras. Veja [estado da aplicação](application-state.md).

Use windows-reconcile.mjs --inspecionar para o legado, ou --registro com caminho
absoluto para o registro escolhido. Os arquivos anteriores ficam intactos.
Inspeção local não comprova o estado remoto; consultas nativas são explícitas e
continuam sujeitas às guardas do reconciliador.

## Falha de interacao e senha no pinpad

INTERACTION_FAILED e um erro do componente, separado do retorno numerico nativo.
Quando processamento de campo, callback ou validacao falha durante o ciclo, o
componente solicita cancelamento com Continua=-1 e aguarda o retorno terminal.
O retorno nativo -2 continua significando "Operacao cancelada pelo operador"
(VRS-258/260, secao 5.2.1), e nao "falha de interacao". Uma falha local tambem
pode ocorrer na limpeza ou avaliacao depois do retorno; por isso ambos os codigos
e a etapa devem ser examinados separadamente.

O diagnostico agora exibe apenas etapa, comando, TipoCampo e codigo de causa
permitido, alem do status nativo. Nao exibe causa.message, stack, buffers, respostas,
PAN, PIN, trilhas nem comprovantes. Metadados nao gravados em uma execucao antiga
nao podem ser recuperados retroativamente. Comandos desconhecidos continuam
falhando explicitamente; comando29 nao vira pergunta ao operador por suposicao.

Os eventos5001/5018,5039 e5051 geram mensagens fixas de espera/inicio/fim da coleta
no pinpad. O PIN do cartao nunca deve ser digitado no computador. A CLI nao chama
LeSenhaInterativo ou LeSenhaDireto para cartoes tradicionais. Comando23 continua
o polling sem Enter nem pausa. Nao depure pausando o processo nessa etapa: os
tempos limites do equipamento continuam correndo.

Os hooks5042/5043 reservam/liberam a posse do recurso dentro da sessão da CLI.
Identificam a sessão dona e impedem chamadas auxiliares/segundo início enquanto o
ciclo usa o pinpad. A reserva não depende mais de journal adquirido pelo SDK.
A limpeza libera somente essa posse; não arquiva arquivos antigos nem altera
configurações do dispositivo. O manual (p.54) exige bloquear/liberar recursos,
mas não especifica API de sistema operacional. Esta guarda não é mutex global
Windows nem comprova exclusividade física contra outro PDV/Agente/aplicativo ou
terminal. Não execute esses aplicativos no mesmo pinpad simultaneamente.

Em 2026-11-07, o teste do operador terminou com journal ended e status nativo -2,
sem lock ou processo CLI/ponte ativo na inspecao. O log anterior nao tinha
metadados da causa interna. Ausencia dos hooks5042/5043 reproduz INTERACTION_FAILED
em teste sintetico, mas isso nao prova que foi a causa daquele teste. O texto
"84 - Modo invalido, use Chip/Tarja" orienta nova forma de leitura; nao identifica
a causa da falha local posterior. Nenhum novo teste com cartao foi iniciado para
implementar estas correcoes. A validacao sintetica nao substitui homologacao.
## Menu gerencial e carteiras: limites verificados nos manuais

Referências consultadas: VRS-260 comum, pp.8,17,21–22,32–38,55; Carteiras Digitais
1.53, pp.9–12,21,24–25,35–39. Não foram usados PDFs do kit x64.

A função110 mantém acompanhamento no snapshot desde antes do início. A opção
explícita review-receipts é restrita a110: sucesso sem saída de comprovante encerra
sem Finaliza. Saída120/121/122/625 exige revisão; pode ser autenticação, recibo,
comprovante administrativo ou reimpressão, não prova novo pagamento. Nesse caso
não há finalização automática nem confirmação positiva; o registro permanece
para classificação/reconciliação. Falha de impressão seguida de retorno0 também
permanece protegida. Essa política não muda o catálogo110 de explicit para financial.

Comprovantes administrativos/CB devem ser tratados quando chegam. Por escolha
explícita do usuário, este exemplo de PDV considera a exibição concluída como
impressão simulada: mostra cada ocorrência e devolve sucesso ao componente,
antes da próxima Continua. Não exige impressora nem pergunta adicional. Isso
não é impressão física e não altera a regra do manual para uma automação real.
Comando29 sem integração específica continua falhando: não vira coleta livre.

A função123 pode cancelar uma operação existente. Não garante cancelamento
integral de Pix Troco: o manual exige cancelamentos separados de venda e saque.
Não há chamada automática de DescarregaMensagens, pois pode enviar mensagens
pendentes de outras operações. Cancelamento cooperativo não prova desfazimento
remoto quando a comunicação falha.

A base semântica geral do componente continua VRS-258/Carteiras1.43; esta mudança
confere as sete funções contra os manuais fornecidos, não declara cobertura total
1.53. O histórico1.53 inclui diferenças como campo744,4249, eventos5087/5088,
TelaUnicaQRCode/Pix NFC e novas carteiras/filtros. Esses recursos não foram
ativados nem homologados nesta alteração. Campos brutos continuam preservados
pelo SDK e interações desconhecidas falham explicitamente.
## Correção do campo170 de saída

O diagnóstico de 2026-11-07 identificou MISSING_FIELD_HANDLER no comando0/campo170.
O catálogo exigia indevidamente interpretação da disponibilidade de parcelamento
antes de continuar. A falha local solicitava Continua=-1; o retorno nativo -2
permanece cancelamento pelo operador, não código de senha/interação.

A correção é no componente: saídas170/174/724–727/2974 preservam seu valor bruto
sem resolver obrigatório nem mapeamento inventado. A CLI não pede nem imprime
esses valores. O SiTef continua conduzindo os menus e coletas. Testes sintéticos
cobrem VISA→170→menu, bytes originais, repetição, resolver opcional, códigos nativos
e manutenção dos demais handlers obrigatórios. Não foi repetida operação física
para verificar esta correção; isso ainda não equivale a homologação completa.
## Entrada monetária do comando 34

VRS-260, §5.3.1 p.34, exige coletar um valor monetário com delimitador de
centavos e devolvê-lo no Buffer. A ocultação é exigência do comando41 (p.35),
não do comando34. O campo504 é Taxa de Serviço (p.40); o texto apresentado
pela DLL pode especificar taxa de embarque, serviço ou outra mensagem do fluxo.
O manual não exige uma máscara visual específica nem digitação por centavos.

A CLI apresenta comando34 de forma visível, com vírgula e casas
completadas durante a digitação. Exemplos: 0,01; 1 resulta em 1,00; 5.25 resulta
em 5,25. Digite a vírgula ou ponto para entrar na parte decimal; 525 significa
525,00, não 5,25. Não há separadores de milhares nem arredondamento automático.
Backspace remove o último caractere digitado, não os zeros de apresentação.
Enter envia a resposta; a indicação inicial 0,00 não é um valor padrão: Enter
sem digitar permanece inválido. /voltar, /cancelar, Esc e Ctrl+C continuam ativos.

A máscara é uma escolha de interface, separada do protocolo. Somente a resposta
digitada, normalizada por operações de texto, vai para o Buffer. A vírgula e
todas as casas decimais contam nos limites TamMinimo/TamMaximo em bytes; valores
fora deles são recusados sem truncar. A precisão recebida do componente é
respeitada, até seu limite de100 casas, e não inferida do texto da mensagem.
Em terminal estreito, < e > indicam trechos fora da janela visual; não entram
no valor enviado. O campo completo continua mantido e validado em memória.

Por escolha explícita do usuário, a CLI não oculta nenhuma entrada de teclado:
comando30, documentos como campo516, supervisor/comando41, cheques, barras e
campos com metadados sensitive são exibidos enquanto digitados. O renderizador
não tem modo secreto, nem mesmo quando um chamador antigo passa secret:true.
Isso é apresentação do exemplo, não criptografia. O componente conserva os
metadados de sensibilidade; Buffer, limites de bytes, validações e controles de
cancelamento não mudam. A senha de cartão permanece no pinpad.

O manual descreve ocultação para comando41; esta CLI foi explicitamente ajustada
para exibi-lo. Essa escolha visual não deve ser confundida com uma comprovação
de conformidade do terminal com essa orientação. Não grave nem compartilhe a
tela do terminal: credenciais de supervisor e outros dados digitados ficarão
visíveis. Os valores não passam a ser registrados em journal, diagnóstico ou
telemetria. Testes usam somente dados e transportes sintéticos.
## Decisão da automação após o ciclo

runSimulation mantém o nome por compatibilidade, mas não desfaz automaticamente:
retorna o TransactionResult ao chamador. Em sucesso financeiro, o pagamento fica
aguardando decisão. O estado agregado pode continuar uncertain por outra pendência
restaurada; o helper usa o resultado/transactionId para selecionar a decisão.
result.data oferece occurrences, getAll e getLast; fields e
details legados permanecem disponíveis. Esses dados são sensíveis e não devem ser
serializados em logs. Além de status, contagem e IDs dos campos, o terminal
apresenta especificamente os comprovantes 121/122 descritos abaixo. Os demais
valores continuam no resultado, sem dump automático.

O exemplo interativo chama decideFinalization apenas depois desse retorno. O
operador escolhe 1 confirmar, 2 desfazer ou 3 manter pendente (padrão), sem prompt
extra. Antes do menu, a CLI avisa que o operador/automação deve cumprir as
obrigações do produto e que exibir texto não comprova impressão nem assinatura.
Se `details.signatureRequired` indicar o campo 5074, orienta coletar assinatura
em papel antes de confirmar. A escolha 1 é a decisão explícita da automação,
não um atestado fictício de impressora ou assinatura feito pelo SDK.

Uma automação pode injetar decide(result) retornando confirm, undo ou pending.
Sem callback ou decisão, mantém pendente. Enter, Esc, Ctrl+C ou /cancelar no menu
de finalização também mantêm pendente: não equivalem a desfazer. Esse menu
posterior não é a antiga confirmação TESTE antes da operação.

`cliConnection` configura `fields.finalizationResponsibility:'automation'` junto
com `receiptStoragePolicy:'explicit-return'`. O modo automation permite enviar a
decisão positiva sem veto de revisão genérica nem hooks de impressão posterior
ao ciclo/captureSignature, depois de a automação cumprir essas obrigações fora
deles. A CLI não possui impressora nem captura real de assinatura. Para recibos
imediatos, ela fornece um hook de impressão simulada por tela. Quando esse hook
conclui com true, o SDK registra `printed:true` como resultado informado pela
aplicação, sem verificar equipamento físico. A decisão financeira, por si só,
não muda `printed` ou `signatureCaptured` e continua explícita.

A nova fachada `ClientSitef` já tem padrão `'automation'`/`'explicit-return'`,
mas a CLI o declara explicitamente. `createSitef` e `SitefClient.connect`
conservam o padrão anterior `'sdk'`/`'persist'`, com seus hooks e revisão.
No modo automation, violações objetivas, recusa PBM, falhas de interação,
impressão imediata, revisão gerencial e guardas de status, escopo, sincronização
e recuperação continuam ativas. Se impedirem a confirmação, a CLI informa o
erro e preserva a pendência, sem desfazer como compensação. O modo não modifica
nem resolve pendências de execuções anteriores.

Exceção, timeout, retorno negativo/desconhecido e falha de callback não abrem o
menu de sucesso, não finalizam e não repetem a operação. getPartialTransaction(error)
permite à automação examinar dados parciais em memória sem imprimir o payload.
Retorno nativo0 acompanhado de erro local não é tratado como sucesso da aplicação.
O caso gerencial110 com comprovantes permanece separado para classificação.
runSimulation também devolve o resultado completo nesse caso, com fields/data e
details, apresenta somente as vias 121/122 recebidas e avisa sobre a revisão,
sem expor outros valores.
O helper de decisão não abre menu nem finaliza110. Devolver o resultado não
escolhe uma decisão: os metadados ficam no registro da automação.

Manter pendente e sair permite close() quando não há operação ativa. Ele fecha
o transporte sem chamar Finaliza e sem apagar o snapshot persistido. A automação
libera o lock que ela adquiriu para o arquivo novo; registros/locks anteriores
não são alterados. Isso não comprova estado remoto nem impede comportamento
próprio da DLL ao encerrar. Não repita uma operação incerta para tentar resolvê-la.
Decisão posterior exige estado selecionado/restaurado pela automação e, quando
incerto, reconciliação explícita. Impressão, assinatura e produto continuam
obrigatórios antes de confirmar.

A separação original foi verificada com transporte/journal em memória e testes
sintéticos. A mudança de estado da automação usa também arquivos de fixtures em
testes, sem ler/alterar journals operacionais. Nenhuma DLL do fornecedor, pinpad
ou operação física foi executada nesta alteração.

## Visualização dos comprovantes retornados

Depois do retorno normal de `tx.process`, o fluxo compartilhado pelo loop e por
`runSimulation` usa
`displayResultReceipts` em `examples/cli/interaction.mjs` para percorrer
`result.details.receipts`. Mostra o texto de cada campo 121 (via do cliente) ou
122 (via da loja), com rótulo da via e do campo, na ordem recebida. Pode vir só
uma via, ambas, nenhuma ou repetições; não cria uma via ausente, não agrupa por
tipo nem elimina repetições. Outros tipos de recibo não entram nessa apresentação.

Espaços, linhas, barras invertidas e texto vazio são conservados. Caracteres de
controle do terminal são removidos somente da apresentação, incluindo ESC, CR e
controles C0/C1, preservando LF e tabulação. Os buffers, bytes e coleções do
resultado original não mudam. O helper não marca `printed`, não chama impressora,
não captura assinatura e não finaliza nada. O resultado não é serializado em log.
Essa visualização não deve ser reutilizada com IO que grave os textos em arquivo.

Uma exceção não faz dump de comprovantes parciais: a automação pode acessar
`getPartialTransaction(error)` em memória sob sua política de dados. Nada é
recuperado retroativamente de uma execução anterior. Os snapshots continuam
armazenando só referências/hashes e obrigações, sem texto dos comprovantes.

A separação segue o VRS-260: p.8, impressão e decisão cabem à automação; p.38,
campos 121/122; p.54, assinatura em papel no campo 5074; p.55, rotina de
finalização void. Mensagem de retorno local não comprova que o relatório remoto
já mudou de estado. Não se faz consulta, retry ou finalização de pendência antiga
automaticamente para tentar comprovar isso.

### Reimpressão e contrato da impressora

O VRS-260 §5.3.2 p.37 exige que comprovantes administrativos/CB sejam impressos
quando chegam. A próxima Continua=0 sinaliza impressão correta; -1 informa
falha. Campos121/122 (p.38) são as vias do cliente/caixa; campo123 (p.39) descreve
os comprovantes seguintes e os tipos04/05 são gerencial/CB, não identificadores
de reimpressão. A resposta SIM no comando20 usa Buffer=0 e não substitui esse
resultado de impressão, nem é chamada a Finaliza.

A política padrão deste exemplo considera a exibição concluída do comprovante
como impressão simulada. A CLI mostra cada comprovante imediato durante
`process`, aguarda a saída e devolve `true` pelo hook `printReceipt`; o componente
pode então continuar com Continua=0. Não há pergunta extra, impressora física,
confirmação financeira nem mudança no componente para reconhecer esta política.
O terminal identifica a simulação. Ela não ativa homologação no SiTef nem torna
uma operação financeira simulada.

São aceitas as vias121/122 recebidas, inclusive uma só, ambas, vazias e repetidas,
e os demais recibos imediatos reconhecidos pelo componente (120/625), com rótulos
próprios. Cada ocorrência é mostrada uma vez; não se inventam vias ausentes.
Buffer e bytes originais permanecem no resultado. Falha síncrona/assíncrona na
exibição não devolve sucesso: o ciclo solicita cancelamento com Continua=-1.
Cancelar durante a espera também não autoriza uma confirmação tardia ou retry.

O argumento `printReceipt` de `main(args, { printReceipt })` ou `cliConnection`
substitui a política padrão. Seu false/erro não é compensado por sucesso simulado.
Em produção, integre o resultado real da impressão exigida pelo produto, conforme
a regra da p.37 acima. O SDK apenas recebe a resposta do callback: neste exemplo,
`printed:true` significa impressão simulada em tela, não comprovação física.
A apresentação diferida das vendas e sua decisão financeira explícita não mudam.

Se a impressão/observação falhar, os campos recebidos continuam em
`getPartialTransaction(error).data`. O diagnóstico não imprime esse parcial.
O -2 retornado pelo fornecedor continua significando operação cancelada pelo
operador, separado do erro local INTERACTION_FAILED. Nenhuma decisão financeira
é enviada para compensar a falha de impressão.

O menu110 continua pedindo classificação local quando retorna recibo; isso não
prova uma pendência no SiTef e não adiciona confirmação financeira à reimpressão.
As funções dedicadas112–114 já têm política não financeira no componente, mas
isso não autoriza generalizar para todos os caminhos do menu110. Nenhum teste
desta correção executou reimpressão nativa ou examinou conteúdo operacional.
## Exemplo simples na cópia preparada

O helper `scripts/prepare-windows-cli.ps1` também copia `examples/windows-simple.mjs` e seus auxiliares. O launcher `sitef-cli.cmd` continua abrindo a CLI completa. Para o exemplo simples, execute `node cli/examples/windows-simple.mjs` a partir da raiz preparada; configure o objeto `configuration` nessa cópia antes de iniciar. Não há opções de linha de comando no exemplo simples. Alterações no checkout exigem atualizar a cópia preparada.
