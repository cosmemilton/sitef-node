# Processo nativo

Executável Rust que usa linhas JSON em stdin/stdout. Os alvos de ABI do fornecedor compatíveis
são **Windows x64** e **Linux i686 (32 bits, glibc)**, em um processo isolado de
Node/Electron. Um processo Node/Electron Linux x64 inicia o executável i686;
a arquitetura da ponte deve corresponder à biblioteca do fornecedor, não ao processo pai.

O integrador fornece um caminho absoluto para sua própria biblioteca: no Windows, use a
DLL de **interface** (por exemplo, `CliSiTef64I.dll`), nunca a interna `CliSiTef.dll`.
Os cabeçalhos PE devem identificar AMD64 PE32+. No Linux, use `libclisitef.so` do kit Linux32.
Os cabeçalhos ELF devem identificar um objeto compartilhado Intel 386 ELF32 little-endian.
Nenhuma biblioteca, configuração, certificado ou manual do fornecedor é incluído.

Stdio continua sendo o padrão. Um transporte opcional autenticado por loopback está
disponível para clientes como PHP no Windows:
`--connect 127.0.0.1:PORT --token-env SITEF_BRIDGE_TOKEN`. O cliente cria primeiro o
receptor e fornece um novo nonce de 64 caracteres hexadecimais no ambiente do
processo filho. A ponte o remove, conecta em até 10 segundos e envia
`{protocolVersion:1,transport:"tcp-loopback",token:nonce}` antes das mesmas
requisições/respostas NDJSON. Só são aceitos o endereço IPv4 de loopback exato e uma porta
não zero. O modo TCP deixa stdout/stderr vazios. Consulte [o protocolo compartilhado](../docs/bridge-protocol.md)
para o contrato completo independente de linguagem e a semântica de erros e estados.

Outras arquiteturas de execução, inclusive pontes Linux x64, continuam restritas a testes sintéticos
com `testMode: true` explícito. Nunca use testMode para contornar verificações de ABI do fornecedor.
Linux i686 tem `sizeof(long) == 4`; Linux x64 tem `sizeof(long) == 8` e não pode
substituir com segurança a biblioteca Linux32 fornecida. No Linux, usa-se a ABI C.

A base semântica original é VRS-258 e Carteiras Digitais 1.43 do kit Win32.
Verificações posteriores compararam os 444 IDs de campos da seção 5.3.2 com VRS-260; guias específicos citam consultas adicionais direcionadas. Isso não é uma
auditoria semântica completa de VRS-260. Os PDFs do kit x64 não foram lidos nem usados.
O binário x64 fornecido é anterior a esses documentos. Por isso, as capacidades
informam os símbolos efetivamente presentes, e os métodos opcionais falham explicitamente quando
um ponto de entrada está ausente; recursos documentados mais recentes ainda exigem testes com o fornecedor.

No WSL, com as ferramentas Visual Studio C++ x64 e o Windows SDK instalados, execute
`rustup target add x86_64-pc-windows-msvc` uma vez e depois
`bash scripts/build-windows-x64.sh` na raiz do projeto. O script usa o
`rust-lld` incluído no Rust e as bibliotecas de importação Windows existentes, com CRT estático. Defina
`SITEF_MSVC_LIB_DIR`, `SITEF_UCRT_LIB_DIR` e `SITEF_WINDOWS_UM_LIB_DIR` para substituir
as pastas de bibliotecas x64 detectadas automaticamente; `SITEF_PROGRAMFILES_X86` substitui o ponto de montagem
padrão do WSL `/mnt/c/Program Files (x86)`. Não baixa bibliotecas do fornecedor nem copia
bibliotecas do compilador para os pacotes. Avisos de ausência de Microsoft PDB afetam apenas as
informações de depuração e não comprovam falha em execução.

Para uma compilação nativa de distribuição no Windows, execute o seguinte no PowerShell, na
raiz do repositório, após instalar o alvo Rust, MSVC e Windows SDK:

```powershell
$repo = (Resolve-Path .).Path
$env:CARGO_ENCODED_RUSTFLAGS = @(
  '-Ctarget-feature=+crt-static'
  "--remap-path-prefix=$repo=/sitef"
  "--remap-path-prefix=$env:USERPROFILE=/build-home"
) -join [char]31
cargo build --locked --release --target x86_64-pc-windows-msvc --manifest-path native/Cargo.toml
```

O separador ASCII 31 preserva caminhos com espaços. Essas opções usam
CRT estático e remapeiam caminhos do repositório e do perfil para que o executável não exponha
diretórios pessoais de compilação. Acrescente outro remapeamento para um CARGO_HOME personalizado fora
dessas raízes. A verificação de empacotamento rejeita caminhos pessoais incorporados; uma compilação cargo
release simples sem remapeamento pode, portanto, ser inadequada para distribuição.
Os scripts de compilação Windows pelo WSL e Linux aplicam o remapeamento por conta própria.
Prepare para empacotamento somente um artefato recém-compilado para o alvo pretendido.

Parâmetros de `load`:

```json
{"id":1,"method":"load","params":{"libraryPath":"C:\\vendor\\CliSiTef64I.dll","nativeEncoding":"windows-1252"}}
```

O parâmetro opcional `workingDirectory` deve ser absoluto, assume por padrão o diretório da biblioteca
e só é aplicado dentro do processo da ponte. `nativeEncoding` aceita
`windows-1252` (padrão inicial explícito), `utf-8` ou `ascii`. A codificação efetiva do fornecedor
deve ser conferida em testes com simulador antes da produção. Perda na codificação da entrada
e NUL embutido são rejeitados. Os dados nativos retornados preservam os bytes originais em base64
e um marcador explícito `decodingError`; texto nativo malformado nunca substitui silenciosamente
o status financeiro. `continue.bufferBase64` dispensa a codificação de texto;
o campo de resposta tem o mesmo nome.

`load` e `capabilities` retornam:

```json
{
  "protocolVersion": 1,
  "bridgeVersion": "0.1.0",
  "platform": "windows",
  "architecture": "x86_64",
  "runtimeTarget": "windows-x64",
  "nativeEncoding": "windows-1252",
  "fieldTypeBytes": 4,
  "testMode": false,
  "minimumBufferSize": 20000,
  "functions": {
    "start": {"symbol": "IniciaFuncaoSiTefInterativo", "available": true, "callable": true}
  }
}
```

Erros têm `{id,error:{code,message}}`; os retornos nativos preservam seus números
originais em `result`, sem mapeamento de sucesso/negação fora de contexto. Mensagens de erro
nunca interpolam buffers nativos, resultados de coleta ou caminhos do carregador nativo.
O processo carrega uma única biblioteca durante sua vida e serializa todas as chamadas.

Métodos implementados:

| Método | Parâmetros | Resultado |
| --- | --- | --- |
| configure | server, storeId, terminalId, reserved=0, additionalParameters | status |
| start | functionId, amount, fiscalDocument, fiscalDate, fiscalTime, operator, additionalParameters | status |
| continue | buffer, bufferBase64?, continueFlag, bufferSize (20000–1048576) | status, command, fieldType, minLength, maxLength, buffer, bufferBase64, decodingError |
| finish | confirm (0 ou 1), fiscalDocument, fiscalDate, fiscalTime, additionalParameters | returned:true (retorno nativo void) |
| version | nenhum | status, libraryVersion, interfaceVersion |
| pendingCount | fiscalDate, fiscalDocument | count, status (mesmo retorno nativo) |
| flushMessages | nenhum | status |
| pinpadPresent / pinpadKeepAlive / pinpadKey | nenhum | status |
| pinpadPermanentMessage / pinpadMessage / pinpadYesNo | message | status |
| pinpadInfo | nenhum | UNVERIFIED_OUTPUT_BOUND; use start functionId 775 |
| validateBarcode | data | status, documentType |
| removeCard | nenhum | status |
| startBanking | fiscalDocument, fiscalDate, fiscalTime, operator, additionalParameters | status |
| readSecureCard / readTrack3 | message | status (depois, laço de continuação) |
| readPassword | securityKey (exatamente 64 bytes nativos) | status (depois, laço de continuação) |
| readPasswordDirect | securityKey (exatamente 64 bytes nativos) | status, encryptedPassword |
| readChip | modality, additionalParameters | status (depois, laço de continuação) |

As strings de saída da versão são objetos `{text,rawBase64,decodingError}`. Nas
capacidades, `available` informa um símbolo exportado, e `callable` exige adicionalmente
um método de chamada habilitado. `configureEx` e `readChipEx` descrevem
variantes de exportação, não métodos separados: seus valores `invocationMethod` apontam para
`configure` e `readChip`, que selecionam a exportação estendida quando presente. Essas
duas variantes de metadados têm `callable:false`. `pinpadInfo` é bloqueado porque sua
ABI direta não tem argumento de capacidade, e o manual informa uma alocação mínima sem
um limite máximo de saída verificado. A função 775 usa, em seu lugar, continuação com limite definido.
`readPassword` é uma função de cartão proprietário da loja, não um meio de coletar PINs de
cartões de pagamento; material criptografado nunca deve entrar em logs ou campos genéricos da interface.

A continuação preserva as saídas nativas de comando, tipo e tamanho entre chamadas, conforme exige VRS-258.
A primeira chamada começa com as saídas zeradas. O chamador deve devolver os
bytes originais no comando 0 e fornecer respostas de coleta nos demais comandos.
`AbortSignal`, tempo limite, encerramento do processo e fechamento do modal não comprovam
cancelamento financeiro. Envie `continueFlag:-1` e processe o resultado terminal.
Não há repetição automática, confirmação, desfazimento ou registro durável neste
processo de baixo nível; decisões persistentes e recuperação cabem ao SDK/integrador.

Lacunas explícitas de cobertura pendentes de verificação: pontos de entrada diretos de leitura segura de cartão/trilha
com callbacks nativos e variantes de interface ASCII não são expostos
como FFI genérica arbitrária. Eles exigem assinaturas verificadas, cancelamento e
testes de limites de buffers. Todas as modalidades padrão de transação permanecem acessíveis por
`start.functionId`, inclusive modalidades de leitor seguro 430/431, e por
`additionalParameters` bruto sem restrição de opções. A ponte inicial não deve ser descrita como cobertura
completa ou homologada enquanto essas lacunas e os testes com simulador do fornecedor não forem concluídos.

Execute os testes dos contratos próprios com `cargo test` e `python3 tests/smoke.py`. Este último
compila uma biblioteca C compartilhada sintética original e testa a comunicação real entre processos;
nunca carrega binários do fornecedor.
`python3 tests/smoke_tcp.py` também verifica a autenticação inicial do socket opcional,
a remoção do nonce antes da FFI e o mesmo laço com nossa biblioteca sintética.

## Compilação e execução no Linux

Em um ambiente de desenvolvimento Linux glibc, instale o alvo Rust
`rustup target add i686-unknown-linux-gnu` e o pacote de desenvolvimento GCC multilib
da distribuição (Debian/Ubuntu: `gcc-multilib`). Em seguida, execute
`bash scripts/build-linux-ia32.sh` na raiz do repositório. A saída é
`native/target/i686-unknown-linux-gnu/release/sitef-bridge`.
`SITEF_LINUX_SYSROOT` seleciona opcionalmente uma raiz de sistema multilib local existente;
a compilação não baixa nem inclui um ambiente de execução e não incorpora rpath dessa raiz.

A implantação exige kernel capaz de executar binários i386, o carregador
glibc de 32 bits (`/lib/ld-linux.so.2`), libc/libgcc e quaisquer dependências de 32 bits
exigidas pelo kit do fornecedor usado pelo integrador. No Debian/Ubuntu, isso normalmente
inclui `libc6-i386` e `lib32gcc-s1`; inspecione as dependências do kit específico.
Compile com a versão-base de glibc mais antiga que pretende suportar e confira
`readelf --version-info` no executável. Uma compilação em distribuição mais recente não é
automaticamente compatível com glibc mais antiga. Alpine/musl e Linux ARM não são
compatíveis com esses artefatos. Instalação no sistema e acesso USB são etapas separadas
de configuração pelo integrador, não executadas pelo pacote.

O fornecedor pode depender de bibliotecas auxiliares ao lado de `libclisitef.so`.
Defina `LD_LIBRARY_PATH` no **ambiente de inicialização da ponte** para o diretório confiável
do fornecedor e os diretórios necessários do ambiente de execução de 32 bits, usando a opção de ambiente
da ponte no SDK ou um script de inicialização manual. Alterar apenas workingDirectory não
muda os caminhos de busca do carregador dinâmico Linux. Não acrescente diretórios não confiáveis
nem componentes de caminho vazios. O usuário deve fornecer INI/certificados separadamente
e configurar o dispositivo pinpad Linux real. Nomes COM do Windows não são caminhos de dispositivos
Linux. Nunca conecte USB, altere permissões de dispositivos ou execute pagamentos como
teste de instalação.

As capacidades Linux informam `platform: "linux"`, `architecture: "x86"`,
`runtimeTarget: "linux-ia32"`, `fieldTypeBytes: 4`. Suporte a Linux não é homologação
do fornecedor. Testes locais anteriores de comunicação com simulador não comprovam
cobertura de pinpad, pagamento, cancelamento ou reconciliação.

Para cobertura completa dos testes básicos de comunicação entre processos dos contratos próprios em um processo i686:
`SITEF_SMOKE_TARGET=i686-unknown-linux-gnu SITEF_SMOKE_CC="gcc -m32" python3 native/tests/smoke.py`.
Isso carrega uma biblioteca ELF32 sintética original com a verificação real de carregamento i686
(testMode false), não uma biblioteca do fornecedor. `SITEF_SMOKE_RUNNER` pode especificar um carregador
local de 32 bits para uma raiz de sistema fornecida pelo usuário. Os testes básicos padrão no ambiente de desenvolvimento continuam
usando testMode true. Nenhum deles comprova a ABI completa do fornecedor.

## Distribuição

Pacotes npm específicos de plataforma contêm apenas o executável da ponte própria e
metadados/licenças. Arquivos proprietários de execução devem ser fornecidos separadamente.
Caminhos manuais em `bridgeExecutable` continuam compatíveis. A versão própria da ponte é
independente da versão npm; a negociação do protocolo e as capacidades efetivas
continuam sendo a referência autoritativa. Compilar pacotes não implica publicação, homologação
financeira nem suporte a biblioteca Linux64 do fornecedor. Consulte a
[preparação de publicação](../docs/releasing.md).

## Licença

O código original da ponte Rust está sob a licença [MIT](../LICENSE), copyright
2026 cosmemilton. Dependências mantêm suas próprias licenças. Esta licença não
concede direitos sobre o SDK CliSiTef proprietário, DLLs, arquivos de configuração,
certificados ou manuais. Obtenha-os separadamente por meio de um integrador autorizado.
